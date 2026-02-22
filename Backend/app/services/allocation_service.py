import math
import logging
import googlemaps
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timedelta
from geoalchemy2.shape import to_shape

from app.core.kafka import kafka_producer
from sqlalchemy.orm import Session
from app.models.driver import Driver
from app.models.order import Order
from app.models.zone import Zone, DemandForecast
from app.models.analytics import Demand
from app.schemas.driver import DriverStatus, DutyStatus
from app.schemas.order import OrderStatus
from app.core.config import settings
from app.services.forecasting_service import ForecastingService
from app.core.socket_manager import socket_manager, emit_sync

logger = logging.getLogger(__name__)

class AllocationService:
    MIN_DRIVERS_PER_ZONE = 1
    SURGE_PENDING_RATIO = 3.0
    IDLE_DRIVER_THRESHOLD = 2
    DRIVER_CAPACITY = 1.5 # Average number of orders a driver can handle (batching factor)
    
    def __init__(self, db: Session):
        self.db = db
        self.forecasting_service = ForecastingService(db)
        self._gmaps : Optional[googlemaps.Client] = None

    @property
    def gmaps(self):
        if self._gmaps is None and settings.GOOGLE_MAPS_API_KEY:
            try:
                self._gmaps = googlemaps.Client(key=settings.GOOGLE_MAPS_API_KEY)
            except Exception as e:
                logger.error(f"Failed to initialize Google Maps client: {e}")
        return self._gmaps
    
    
    def initial_allocation(self) -> Dict[str, Any]:
        allocatable_drivers = self.db.query(Driver).filter(
            Driver.duty_status == DutyStatus.ON_DUTY.value,
            Driver.status == DriverStatus.AVAILABLE.value
        ).all()

        if not allocatable_drivers:
            return {"status": "skipped", "message": "No allocatable drivers found"}
        
        zones = self.db.query(Zone).all()
        if not zones:
            return {"status": "skipped", "message": "No zones found"}
        
        zone_demand = self._get_forecast_demand(zones)
        total_demand = sum(zone_demand.values()) or 1.0

        driver_budget = self._compute_driver_budget(
            zones,
            zone_demand,
            total_demand,
            len(allocatable_drivers)
        )

        assignments = self._assign_drivers_to_zones(
            allocatable_drivers,
            zones,
            driver_budget,
            zone_demand
        )

        self._apply_assignments(assignments)

        return {
            "status" : "ok",
            "drivers_allocated" : len(assignments),
            "zones_covered" : len(set(z for _, z in assignments)),
            "allocations" : [
                {"driver_id": d, "zone_id": z} for d, z in assignments
            ]
        }
        
    def reallocation(self) -> Dict[str, Any]:
        zones = self.db.query(Zone).all()
        if not zones:
            return {"status": "skipped", "message": "No zones found"}
        
        zone_map = {z.zone_id: z for z in zones}
        zone_stats = self._get_zone_stats(zones)

        surge_zones = [
            zs for zs in zone_stats.values()
            if zs["demand_pressure"] > self.SURGE_PENDING_RATIO
        ]
        print("surge_zones", surge_zones)
        surplus_zones = [
            zs for zs in zone_stats.values()
            if zs["available_drivers"] > self.IDLE_DRIVER_THRESHOLD
            and zs["demand_pressure"] < 0.5
        ]
        print("surplus_zones", surplus_zones)
        if not surge_zones and not surplus_zones:
            return {"status": "skipped", "message": "No reallocation needed"}
        
        allocatable_drivers = []
        for sz in surplus_zones:
            drivers_in_zone = self.db.query(Driver).filter(
                Driver.current_zone == sz["zone_id"],
                Driver.duty_status == DutyStatus.ON_DUTY.value
            ).all()
            idle = [d for d in drivers_in_zone if d.status == DriverStatus.AVAILABLE.value]
            allocatable = idle[self.MIN_DRIVERS_PER_ZONE:]
            allocatable_drivers.extend(allocatable)
        
        # Also include drivers who are not currently assigned to any zone
        unzoned = self.db.query(Driver).filter(
            Driver.duty_status == DutyStatus.ON_DUTY.value,
            Driver.status == DriverStatus.AVAILABLE.value,
            Driver.current_zone.is_(None)
        ).all()
        allocatable_drivers.extend(unzoned)

        if not allocatable_drivers:
            return {"status": "skipped", "message": "No allocatable drivers found"}
        
        surge_zones.sort(key=lambda zs: zs["demand_pressure"], reverse=True)
        assignments = []

        assigned_drivers = set()
        for sz in surge_zones:
            available_to_move = [d for d in allocatable_drivers if d.driver_id not in assigned_drivers]
            if not available_to_move:
                break
            
            zone_id = sz["zone_id"]
            zone = zone_map[zone_id]
            
            # Use capacity factor to determine how many actual drivers we need
            needed_drivers = math.ceil(sz["pending_orders"] / self.DRIVER_CAPACITY)
            needed = max(1, needed_drivers - sz["available_drivers"])

            ranked = self._rank_drivers_by_proximity(available_to_move, zone)

            moved = 0
            for driver, travel_time in ranked:
                if moved >= needed:
                    break
                
                assignments.append((driver.driver_id, zone_id))
                assigned_drivers.add(driver.driver_id)
                moved += 1

        if not assignments:
            return {"status": "skipped", "message": "No assignments made"}       

        self._apply_assignments(assignments) 
        
        return {
            "status" : "ok",
            "drivers_reallocated" : len(assignments),
            "surge_zones": [s["zone_id"] for s in surge_zones],
            "allocations" : [
                {"driver_id": d, "zone_id": z} for d, z in assignments
            ]
        }
        
    def manual_allocation(self, driver_id: str, zone_id: str) -> Dict[str, Any]:
        driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
        if not driver:
            return {"status": "skipped", "message": "Driver not found"}

        if driver.duty_status != DutyStatus.ON_DUTY.value:
            return {"status": "skipped", "message": "Driver is not on duty"}
        
        if driver.status != DriverStatus.AVAILABLE.value:
            return {"status": "skipped", "message": "Driver is not available"}
        
        zone = self.db.query(Zone).filter(Zone.zone_id == zone_id).first()
        if not zone:
            return {"status": "skipped", "message": "Zone not found"}
        
        logger.info(f"Manual allocation: Moving driver {driver_id} to zone {zone_id}")
        driver.current_zone = zone_id
        
        self.db.add(driver)
        self.db.commit()
        self.db.refresh(driver)

        # Notify driver
        emit_sync(socket_manager.notify_driver_allocation(driver_id, zone_id))
        
        return {"status": "ok", "message": "Driver allocated to zone"}

    def allocate_driver(self, driver_id: str) -> Dict[str, Any]:
        driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
        if not driver:
            return {"status": "skipped", "message": "Driver not found"}

        if driver.duty_status != DutyStatus.ON_DUTY.value:
            return {"status": "skipped", "message": "Driver is not on duty"}
        
        if driver.status != DriverStatus.AVAILABLE.value:
            return {"status": "skipped", "message": "Driver is not available"}
        
        zones = self.db.query(Zone).all()
        if not zones:
            return {"status": "skipped", "message": "No zones found"}
        
        stats = self._get_zone_stats(zones)
        # Find zone with highest demand pressure
        sorted_zones = sorted(stats.values(), key=lambda x: x["demand_pressure"], reverse=True)
        best_zone_id = sorted_zones[0]["zone_id"]

        logger.info(f"JIT Allocation: Moving driver {driver_id} to highest-demand zone {best_zone_id}")
        driver.current_zone = best_zone_id
        
        self.db.add(driver)
        self.db.commit()
        self.db.refresh(driver)

        # Notify driver
        emit_sync(socket_manager.notify_driver_allocation(driver_id, best_zone_id))

        return {"status": "ok", "zone_id": best_zone_id}

    def get_current_allocation_status(self) -> Dict[str, Any]:
        zones = self.db.query(Zone).all()
        result = []
        
        for zone in zones:
            drivers_in_zone = self.db.query(Driver).filter(
                Driver.current_zone == zone.zone_id,
                Driver.duty_status == DutyStatus.ON_DUTY.value
            ).all()
            
            available = [d for d in drivers_in_zone if d.status == DriverStatus.AVAILABLE.value]
            busy = [d for d in drivers_in_zone if d.status == DriverStatus.BUSY.value]
            on_break = [d for d in drivers_in_zone if d.status == DriverStatus.ON_BREAK.value]

            pending = self.db.query(Order).filter(
                Order.pickup_zone == zone.zone_id,
                Order.status == OrderStatus.pending.value
            ).count()

            recent_orders = self.db.query(Order).filter(
                Order.pickup_zone == zone.zone_id,
                Order.created_at >= datetime.utcnow() - timedelta(minutes=15)
            ).count()

            supply = len(available) or 1
            demand_pressure = round(pending / supply, 2)

            result.append({
                "zone_id": zone.zone_id,
                "zone_name": zone.name,
                "demand_score": zone.demand_score,
                "total_drivers": len(drivers_in_zone),
                "available_drivers": len(available),
                "busy_drivers": len(busy),
                "on_break_drivers": len(on_break),
                "pending_orders": pending,
                "recent_orders": recent_orders,
                "demand_pressure": demand_pressure,
                "supply": supply
            })
        
        return {
            "status": "ok",
            "zones": result, 
            "timestamp": datetime.utcnow().isoformat()
        }

    def _get_forecast_demand(self, zones: List[Zone]) -> Dict[str, float]:
        zone_demand = {}
        # Get city-wide forecast once instead of inside the loop
        forecast_data = self.forecasting_service.get_demand_forecast(hours=1)
        
        for zone in zones:
            if forecast_data.forecasts:
                zone_demand[zone.zone_id] = forecast_data.forecasts[0].predicted
            else:
                zone_demand[zone.zone_id] = (zone.demand_score or 1.0) * 10
        return zone_demand
    
    def _compute_driver_budget(
        self,
        zones : List[Zone],
        zone_demand : Dict[str, float],
        total_demand : float,
        total_drivers : int
    ) -> Dict[str, float]:

        budget = {z.zone_id: 0 for z in zones}
        if total_drivers == 0: 
            return budget

        sorted_zones = sorted(zones, key=lambda z: zone_demand.get(z.zone_id, 0), reverse=True)

        if total_drivers <= len(zones):
            for i in range(total_drivers):
                budget[sorted_zones[i].zone_id] = 1
            return budget

        unallocated_drivers = total_drivers
        for zone in zones:
            budget[zone.zone_id] = self.MIN_DRIVERS_PER_ZONE
            unallocated_drivers -= self.MIN_DRIVERS_PER_ZONE
        remainders = {}
        for zone in zones:
            ratio = zone_demand.get(zone.zone_id, 0) / total_demand
            exact_allocation = ratio * unallocated_drivers
            additional_drivers = math.floor(exact_allocation)
            
            budget[zone.zone_id] += additional_drivers
            remainders[zone.zone_id] = exact_allocation - additional_drivers

        remaining_drivers = total_drivers - sum(budget.values())
        sorted_remainders = sorted(remainders.items(), key=lambda item: item[1], reverse=True)
        
        for zone_id, _ in sorted_remainders:
            if remaining_drivers <= 0:
                break
            budget[zone_id] += 1
            remaining_drivers -= 1

        return budget
            
    
    def _assign_drivers_to_zones(
        self,
        drivers : List[Driver],
        zones : List[Zone],
        budget : Dict[str, int],
        zone_demand : Dict[str, float]
    ) -> Tuple[List[Tuple[str, str]]]:

        remaining_drivers = list(drivers)
        assignments = []

        sorted_zones = sorted(zones, key=lambda z: zone_demand.get(z.zone_id, 0), reverse=True)

        for zone in sorted_zones:
            needed = budget.get(zone.zone_id, 0)
            if not remaining_drivers or needed == 0:
                continue

            ranked = self._rank_drivers_by_proximity(remaining_drivers, zone)

            assigned = 0
            for driver, travel_time in ranked:
                if assigned >= needed or driver not in remaining_drivers:
                    break

                prev_zone = driver.current_zone
                assignments.append((driver.driver_id, zone.zone_id))
                remaining_drivers.remove(driver)
                assigned += 1

        return assignments

    def _apply_assignments(self, assignments):
        for driver_id, zone_id in assignments:
            driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
            if not driver:
                continue

            old_zone = driver.current_zone
            logger.info(f"Applying assignment: Driver {driver_id} from {old_zone} -> {zone_id}")
            driver.current_zone = zone_id
            self.db.add(driver)

            kafka_producer.publish("driver-zone-allocated", {
                "driver_id" : driver_id,
                "old_zone" : old_zone,
                "new_zone" : zone_id,
                "timestamp" : datetime.now().isoformat()
            })   
            
            # Notify driver via Socket
            emit_sync(socket_manager.notify_driver_allocation(driver_id, zone_id))

        self.db.commit()

    def _get_zone_stats(self, zones: List[Zone]) -> Dict[str, Dict]:
        stats = {}
        for zone in zones:
            drivers = self.db.query(Driver).filter(
                Driver.current_zone == zone.zone_id,
                Driver.duty_status == DutyStatus.ON_DUTY.value
            ).all()
            available = sum(1 for d in drivers if d.status == DriverStatus.AVAILABLE.value)
            pending = self.db.query(Order).filter(
                Order.pickup_zone == zone.zone_id,
                Order.status == "pending"
            ).count()

            recent_orders = self.db.query(Order).filter(
                Order.pickup_zone == zone.zone_id,
                Order.created_at >= datetime.utcnow() - timedelta(minutes=15)
            ).count()

            # Supply accounts for the fact that a driver can handle multiple orders (batching)
            effective_supply = (available * self.DRIVER_CAPACITY) or 1
            
            demand_pressure = (pending + recent_orders * 0.5) / effective_supply

            stats[zone.zone_id] = {
                "zone_id" : zone.zone_id,
                "available_drivers" : available,
                "pending_orders" : pending,
                "recent_orders" : recent_orders,
                "demand_pressure" : round(demand_pressure, 2),
            }
        return stats
    
    def _rank_drivers_by_proximity(
        self,
        drivers : List[Driver],
        zone : Zone
    ) -> List[Tuple[Driver, Optional[float]]]:

        if not zone.centroid:
            return [(d, None) for d in drivers]
        
        centroid_shape = to_shape(zone.centroid)
        zone_lat, zone_lon = centroid_shape.y, centroid_shape.x

        driver_positions = []
        for driver in drivers:
            if driver.location:
                try:
                    shape = to_shape(driver.location)
                    driver_positions.append((driver, shape.y, shape.x))
                except Exception:
                    driver_positions.append((driver, None, None))
            else:
                driver_positions.append((driver, None, None))
        
        if self.gmaps:
            try:
                origins = [
                    (d, lat, lon) for d, lat, lon in driver_positions
                    if lat is not None and lon is not None
                ]
                if origins:
                    coords = [(lat, lon) for _, lat, lon in origins]
                    dest = (zone_lat, zone_lon)

                    matrix = self.gmaps.distance_matrix(
                        origins=coords,
                        destinations=[dest],
                        mode="driving",
                        departure_time="now",
                        traffic_model="best_guess"
                    )

                    ranked = []
                    for i, (driver, lat, lon) in enumerate(origins):
                        row = matrix["rows"][i]["elements"][0]
                        if row["status"] == "OK":
                            duration_data = row.get("duration_in_traffic", row.get("duration", {}))
                            travel_time = duration_data.get("value", 0) / 60.0
                        else:
                            travel_time = self._calculate_haversine_distance(lat, lon, zone_lat, zone_lon)
                        
                        ranked.append((driver, travel_time))

                    no_loc_drivers = [(d, None) for d, lat, lon in driver_positions if lat is None]
                    ranked.extend(no_loc_drivers)
                    return sorted(ranked, key=lambda x: (x[1] is None, x[1] or 0))
            except Exception as e:
                logger.warning(f"Google Maps Distance Matrix failed, using Haversine fallback")

        ranked = []
        for driver, lat, lon in driver_positions:
            if lat is not None and lon is not None:
                travel_time = self._calculate_haversine_distance(lat, lon, zone_lat, zone_lon)
            else:
                travel_time = None
            ranked.append((driver, travel_time))

        return sorted(ranked, key=lambda x: (x[1] is None, x[1] or 0))
    
    

    @staticmethod
    def _calculate_haversine_distance(lat1, lon1, lat2, lon2):
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        distance_km = 2 * R * math.atan2(math.sqrt(a), math.sqrt(1-a))
        return (distance_km / 45) * 60
    

