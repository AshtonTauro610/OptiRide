import math
import logging
import googlemaps
import numpy as np
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timedelta
from geoalchemy2.shape import to_shape
from scipy.optimize import linear_sum_assignment
from geoalchemy2.functions import ST_X, ST_Y

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
        
        #surge_zones.sort(key=lambda zs: zs["demand_pressure"], reverse=True)
        #assignments = []
        #assigned_drivers = set()
        
        zone_slots = []
        for sz in surge_zones:
            #available_to_move = [d for d in allocatable_drivers if d.driver_id not in assigned_drivers]
            #if not available_to_move:
            #    break
            
            zone_id = sz["zone_id"]
            zone = zone_map[zone_id]
            # Use capacity factor to determine how many actual drivers we need
            needed_drivers = math.ceil(sz["pending_orders"] / self.DRIVER_CAPACITY)
            needed = max(1, needed_drivers - sz["available_drivers"])
            zone_slots.extend([zone] * needed)

        assignments = self._assign_drivers_to_zones_optimized(allocatable_drivers, zone_slots)
            #ranked = self._rank_drivers_by_proximity(available_to_move, zone)

            #moved = 0
            #for driver, travel_time in ranked:
            #    if moved >= needed:
            #        break
                
            #    assignments.append((driver.driver_id, zone_id))
            #    assigned_drivers.add(driver.driver_id)
            #    moved += 1

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

        zone_lat, zone_lon, zone_name = None, None, None
        if zone:
            zone_name = zone.name if hasattr(zone, 'name') else None
            if zone.centroid:
                try:
                    pt = to_shape(zone.centroid)
                    zone_lon = pt.x
                    zone_lat = pt.y
                except:
                    pass

        # Notify driver
        emit_sync(socket_manager.notify_driver_allocation(driver_id, zone_id, zone_lat, zone_lon, zone_name))
        
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
        
        # Consider driver's location for JIT allocation to avoid sending them too far
        driver_lat = None
        driver_lon = None
        if driver.location is not None:
            try:
                driver_pt = to_shape(driver.location)
                driver_lon = driver_pt.x
                driver_lat = driver_pt.y
            except Exception as e:
                logger.error(f"Error parsing driver location: {e}")

        best_zone_id = None
        best_score = float('-inf')

        for zone in zones:
            zone_stat = stats.get(zone.zone_id, {})
            score = zone_stat.get("demand_pressure", 0.0)

            if driver_lat is not None and driver_lon is not None and zone.centroid is not None:
                try:
                    zone_pt = to_shape(zone.centroid)
                    zone_lon = zone_pt.x
                    zone_lat = zone_pt.y
                    
                    dist_km = self._calculate_haversine_distance(driver_lat, driver_lon, zone_lat, zone_lon)
                    # Apply a distance penalty (e.g., -0.5 score per km) 
                    # so closer zones are prioritized unless demand pressure is overwhelmingly higher elsewhere
                    score -= (dist_km * 0.5)
                except Exception as e:
                    logger.error(f"Error parsing zone {zone.zone_id} centroid: {e}")

            if score > best_score:
                best_score = score
                best_zone_id = zone.zone_id

        if not best_zone_id:
            # Fallback to pure demand pressure if calculation fails
            sorted_zones = sorted(stats.values(), key=lambda x: x["demand_pressure"], reverse=True)
            best_zone_id = sorted_zones[0]["zone_id"]

        logger.info(f"JIT Allocation: Moving driver {driver_id} to highest-demand zone {best_zone_id}")
        driver.current_zone = best_zone_id
        
        self.db.add(driver)
        self.db.commit()
        self.db.refresh(driver)

        zone_lat, zone_lon, zone_name = None, None, None
        assigned_zone = next((z for z in zones if z.zone_id == best_zone_id), None)
        if assigned_zone:
            zone_name = assigned_zone.name if hasattr(assigned_zone, 'name') else None
            if assigned_zone.centroid:
                try:
                    pt = to_shape(assigned_zone.centroid)
                    zone_lon = pt.x
                    zone_lat = pt.y
                except:
                    pass

        # Notify driver
        emit_sync(socket_manager.notify_driver_allocation(driver_id, best_zone_id, zone_lat, zone_lon, zone_name))

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
            
    
    """def _assign_drivers_to_zones(
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

        return assignments"""
    
    def _assign_drivers_to_zones(
        self,
        drivers: List[Driver],
        zones: List[Zone],
        budget: Dict[str, int],
        zone_demand: Dict[str, float]
    ) -> List[Tuple[str, str]]:
        zone_slots = []
        for zone in zones:
            needed = budget.get(zone.zone_id, 0)
            zone_slots.extend([zone]*needed)
        
        return self._assign_drivers_to_zones_optimized(drivers, zone_slots)
    
    def _assign_drivers_to_zones_optimized(
        self,
        drivers: List[Driver],
        zone_slots: List[Zone]
    ) -> List[Tuple[str, str]]:
        """Hungarian Algorithm for optimal assignment"""
        if not drivers or not zone_slots:
            return []
        
        cost_matrix = np.zeros((len(drivers), len(zone_slots)))
        matrix = False

        driver_penalties = [self._calculate_driver_penalties(d) for d in drivers]

        if self.gmaps:
            try:
                unique_zones = list({z.zone_id : z for z in zone_slots}.values())
                origins = [f"{to_shape(d.location).y},{to_shape(d.location).x}" for d in drivers]
                destinations = [f"{to_shape(z.centroid).y},{to_shape(z.centroid).x}" for z in unique_zones]

                if origins and destinations:
                    response = self.gmaps.distance_matrix(origins=origins, destinations=destinations)

                    if response["status"] == "OK":
                        for i, row in enumerate(response["rows"]):
                            penalty = driver_penalties[i]
                            for j, element in enumerate(row["elements"]):
                                if element["status"] == "OK":
                                    base_travel_time = element["duration"]["value"] / 60.0
                                    unique_zone_id = unique_zones[j].zone_id

                                    travel_time = base_travel_time + penalty
                                    
                                    for slot_idx, slot_zone in enumerate(zone_slots):
                                        if slot_zone.zone_id == unique_zone_id:
                                            cost_matrix[i, slot_idx] = travel_time
                                else:
                                    raise Exception("API Element status not OK")
                        matrix = True
            except Exception as e:
                logger.warning(f"Google Maps batch request failed, fall back to Haversine")
        if not matrix:
            for i, driver in enumerate(drivers):
                penalty = driver_penalties[i]
                for j, zone in enumerate(zone_slots):
                    cost_matrix[i, j] = self._get_travel_time(driver, zone) + penalty
        
        row_ind, col_ind = linear_sum_assignment(cost_matrix)

        assignments = []
        for i in range(len(row_ind)):
            driver = drivers[row_ind[i]]
            zone = zone_slots[col_ind[i]]
            assignments.append((driver.driver_id, zone.zone_id))

        return assignments
    
    def _get_travel_time(self, driver: Driver, zone: Zone) -> float:
        if not driver.location or not zone.centroid:
            return 999.0
        
        try:
            driver_shape = to_shape(driver.location)
            zone_shape = to_shape(zone.centroid)

            return self._calculate_haversine_distance(
                driver_shape.y, driver_shape.x,
                zone_shape.y, zone_shape.x
            )
        except Exception as e:
            logger.error(f"Error calculating haversine distance: {e}")
            return 999.0
                
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
            
            zone_lat, zone_lon, zone_name = None, None, None
            zone_obj = self.db.query(Zone).filter(Zone.zone_id == zone_id).first()
            if zone_obj:
                zone_name = zone_obj.name if hasattr(zone_obj, 'name') else None
                if zone_obj.centroid:
                    try:
                        pt = to_shape(zone_obj.centroid)
                        zone_lon = pt.x
                        zone_lat = pt.y
                    except:
                        pass
            
            # Notify driver via Socket
            emit_sync(socket_manager.notify_driver_allocation(driver_id, zone_id, zone_lat, zone_lon, zone_name))

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

    def _calculate_driver_penalties(self, driver : Driver) -> float:
        penalty = 0.0

        fatigue_score = getattr(driver, "fatigue_score", 0.0)
        if fatigue_score > 0.65:
            penalty += 60
        elif fatigue_score > 0.4:
            penalty += (fatigue_score * 50)

        battery_level = getattr(driver, "battery_level", 100)
        if battery_level < 20:
            penalty += 30

        return penalty
        
    
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
    