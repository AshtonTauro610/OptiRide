from fastapi import HTTPException, status, Depends
from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Any
from geoalchemy2.functions import ST_Distance, ST_X, ST_Y
from geoalchemy2.elements import WKTElement
from datetime import datetime, timedelta
from app.core.kafka import kafka_producer
from app.models.driver import Driver
from app.models.order import Order
from app.models.alert import Alert
from app.models.break_model import Break
from sqlalchemy import func
from app.schemas.alert import AlertType, AlertSeverity
from app.schemas.driver import (
    DriverCreate, DriverUpdate, LocationSchema,
    DriverPerformanceStats, NearbyDriverResponse,
    ShiftStart, ShiftEnd, ShiftSummary, BreakRequest, DriverStatus, DutyStatus, TelemetryUpdate
)
from app.services.allocation_service import AllocationService

class DriverService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_driver(self, driver_data: DriverCreate) -> Driver:
        driver = Driver(
            user_id=driver_data.user_id,
            name=driver_data.name,
            current_zone=driver_data.current_zone,
            vehicle_type=driver_data.vehicle_type,
            license_plate=driver_data.license_plate,
            status="offline",
            duty_status="off_duty"
        )
        self.db.add(driver)
        self.db.commit()
        self.db.refresh(driver)

        return driver
    
    def get_driver_by_id(self, driver_id: str) -> Optional[Driver]:
        return self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
    
    def get_driver_by_user_id(self, user_id: str) -> Optional[Driver]:
        return self.db.query(Driver).filter(Driver.user_id == user_id).first()
    
    def update_driver(self, driver_id: str, update_data: DriverUpdate) -> Driver:
        driver = self.get_driver_by_id(driver_id)

        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        
        if update_data.name is not None:
            driver.name = update_data.name
        if update_data.current_zone is not None:
            driver.current_zone = update_data.current_zone
        if update_data.vehicle_type is not None:
            driver.vehicle_type = update_data.vehicle_type
        if update_data.license_plate is not None:
            driver.license_plate = update_data.license_plate
        
        self.db.commit()
        self.db.refresh(driver)

        return driver
    
    def delete_driver(self, driver_id: str) -> None:
        driver = self.get_driver_by_id(driver_id)
        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        self.db.delete(driver)
        self.db.commit()
    
    def update_location(self, driver_id: str, location_data: LocationSchema) -> Driver:
        driver = self.get_driver_by_id(driver_id)

        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        
        point_wkt = WKTElement(f'POINT({location_data.longitude} {location_data.latitude})', srid=4326)
        driver.location = point_wkt

        if location_data.speed is not None:
            driver.current_speed = location_data.speed
        if location_data.heading is not None:
            driver.heading = location_data.heading

        self.db.commit()

        kafka_producer.publish("driver-location", {
            "driver_id": driver.driver_id,
            "latitude": location_data.latitude,
            "longitude": location_data.longitude,
            "speed": driver.current_speed,
            "heading": driver.heading,
            "status": driver.status,
            "timestamp": str(datetime.now())
        })

        return driver
    
    def update_telemetry(self, driver_id: str, telemetry: TelemetryUpdate) -> Driver:
        driver = self.get_driver_by_id(driver_id)
        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        
        if telemetry.battery_level is not None:
            driver.battery_level = telemetry.battery_level
            if driver.battery_level < 20:
                existing_alert = self.db.query(Alert).filter(
                    Alert.driver_id == driver_id,
                    Alert.alert_type == AlertType.DEVICE.value,
                    Alert.acknowledged == False
                ).first()
                if not existing_alert:
                    alert = Alert(
                        driver_id=driver_id,
                        alert_type=AlertType.DEVICE.value,
                        severity=AlertSeverity.MODERATE.value,
                        location=driver.location,  # Use driver's current location
                        acknowledged=False
                    )
                    self.db.add(alert)
        if telemetry.network_strength is not None:
            driver.network_strength = telemetry.network_strength
        if telemetry.camera_active is not None:
            driver.camera_active = telemetry.camera_active

        self.db.commit()
        return driver
       
    def get_location(self, driver_id: str) -> Optional[LocationSchema]:
        driver = self.get_driver_by_id(driver_id)

        if not driver or not driver.location:
            return None
        
        longitude = self.db.scalar(ST_X(driver.location))
        latitude = self.db.scalar(ST_Y(driver.location))

        return LocationSchema(latitude=latitude, longitude=longitude)
    
    def get_nearby_drivers(self, latitude: float, longitude: float, radius_km: float, status: Optional[DriverStatus] = DriverStatus.AVAILABLE, limit: int = 10):
        point_wkt = WKTElement(f'POINT({longitude} {latitude})', srid=4326)
        radius_meters = radius_km * 1000  

        query = self.db.query(
            Driver,
            ST_Distance(Driver.location, point_wkt, True).label('distance'),
            ST_Y(Driver.location).label('latitude'),
            ST_X(Driver.location).label('longitude')
        ).filter(
            ST_Distance(Driver.location, point_wkt, True) <= radius_meters
        )

        if status:
            query = query.filter(Driver.status == status.value)

        query = query.order_by('distance').limit(limit)

        results = query.all()

        nearby_drivers = []
        for driver, distance, lat, lon in results:
            nearby_drivers.append(
                NearbyDriverResponse(
                    driver_id=driver.driver_id,
                    name=driver.name,
                    status=DriverStatus(driver.status),
                    rating=driver.rating,
                    latitude=lat,
                    longitude=lon,
                    distance_meters=float(distance),
                    current_zone=driver.current_zone
                )
            )

        return nearby_drivers
    
    def update_status(self, driver_id: str, new_status: DriverStatus) -> Driver:
        driver = self.get_driver_by_id(driver_id)

        if not driver:
            raise HTTPException(
                status_code=404,
                detail="Driver not found"
            )
        driver.status = new_status.value
        self.db.commit()
        self.db.refresh(driver)

        # Trigger allocation if becoming available
        if new_status == DriverStatus.AVAILABLE:
            allocation_service = AllocationService(self.db)
            allocation_service.allocate_driver(driver_id)

        return driver
    
    def update_duty_status(self, driver_id: str, duty_status: DutyStatus) -> Driver:
        driver = self.get_driver_by_id(driver_id)

        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        driver.duty_status = duty_status.value
        self.db.commit()
        self.db.refresh(driver)
        return driver
    
    def start_shift(self, driver_id: str, shift_start: ShiftStart) -> Driver:
        driver = self.get_driver_by_id(driver_id)
        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        
        if driver.duty_status == DutyStatus.ON_DUTY.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Driver is already on duty"
            )
        
        driver.duty_status = DutyStatus.ON_DUTY.value
        driver.status = DriverStatus.AVAILABLE.value
        driver.report_time = shift_start.start_time.replace(tzinfo=None) if shift_start.start_time.tzinfo else shift_start.start_time

        driver.location = WKTElement(f'POINT({shift_start.start_longitude} {shift_start.start_latitude})', srid=4326)

        driver.breaks = 0
        driver.safety_alerts = 0
        driver.fatigue_score = 0.0

        self.db.commit()
        self.db.refresh(driver)

        # Trigger initial allocation
        try:
            allocation_service = AllocationService(self.db)
            allocation_service.allocate_driver(driver.driver_id)
        except Exception as e:
            logger.error(f"Initial allocation failed: {e}")

        return driver
    
    def end_shift(self, driver_id: str, shift_end: ShiftEnd) -> ShiftSummary:
        driver = self.get_driver_by_id(driver_id)
        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        
        if driver.duty_status == DutyStatus.OFF_DUTY.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Driver is already off duty"
            )
        
        driver.duty_status = DutyStatus.OFF_DUTY.value
        driver.status = DriverStatus.OFFLINE.value
        driver.exit_time = shift_end.end_time.replace(tzinfo=None) if shift_end.end_time.tzinfo else shift_end.end_time

        driver.location = WKTElement(f'POINT({shift_end.end_longitude} {shift_end.end_latitude})', srid=4326)
        
        # Make sure both times are naive for comparison
        report_time = driver.report_time.replace(tzinfo=None) if driver.report_time and driver.report_time.tzinfo else driver.report_time
        exit_time = driver.exit_time.replace(tzinfo=None) if driver.exit_time.tzinfo else driver.exit_time
        
        if report_time:
            shift_duration = (exit_time - report_time).total_seconds() / 3600.0
        else:
            shift_duration = 0.0

        orders_completed = self.db.query(Order).filter(
            Order.driver_id == driver.driver_id,
            Order.status == 'delivered',
            Order.delivered_at >= driver.report_time,
            Order.delivered_at <= driver.exit_time
        ).count()

        safety_alerts = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.timestamp >= driver.report_time,
            Alert.timestamp <= driver.exit_time
        ).count()

        summary = ShiftSummary(
            driver_id=driver.driver_id,
            name=driver.name,
            start_time=driver.report_time,
            end_time=driver.exit_time,
            total_hours=round(shift_duration, 2),
            total_orders=orders_completed,
            total_distance=0.0, # Placeholder for distance calculation 
            breaks_taken=driver.breaks,
            safety_alerts=safety_alerts,
            average_rating=driver.rating
        )
        self.db.commit()
        return summary
    
    def request_break(self, driver_id: str, break_request: BreakRequest) -> Driver:
        driver = self.get_driver_by_id(driver_id)
        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        
        if driver.duty_status != DutyStatus.ON_DUTY.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Driver must be on duty to request a break"
            )
        
        if driver.status == DriverStatus.BUSY.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Driver is currently delivering and cannot take a break"
            )
        
        if driver.status == DriverStatus.ON_BREAK.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Driver is already on a break"
            )
        
        driver.status = DriverStatus.ON_BREAK.value
        driver.breaks += 1
        if break_request.latitude is not None and break_request.longitude is not None:
            driver.location = WKTElement(f'POINT({break_request.longitude} {break_request.latitude})', srid=4326)

        self.db.commit()
        self.db.refresh(driver)
        return driver
    
    def end_break(self, driver_id: str) -> Driver:
        driver = self.get_driver_by_id(driver_id)
        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        
        if driver.status != DriverStatus.ON_BREAK.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Driver is not currently on a break"
            )
        
        driver.status = DriverStatus.AVAILABLE.value
        self.db.commit()
        self.db.refresh(driver)
        return driver
    
    def get_performance_stats(self, driver_id: str) -> DriverPerformanceStats:
        driver = self.get_driver_by_id(driver_id)
        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        last_30_days = datetime.utcnow() - timedelta(days=30)

        # ========== TODAY'S STATS (Primary - Real-time monitoring) ==========
        today_orders = self.db.query(Order).filter(
            Order.driver_id == driver.driver_id,
            Order.status == 'delivered',
            Order.delivered_at >= today_start
        ).count()
        
        # Today's distance (from delivered orders)
        today_distance = self.db.query(func.sum(Order.distance_km)).filter(
            Order.driver_id == driver.driver_id,
            Order.status == 'delivered',
            Order.delivered_at >= today_start
        ).scalar() or 0.0
        
        # Today's earnings calculation:
        # - 5 AED base fee per delivery
        # - 0.2 AED per kilometer driven
        BASE_FEE_PER_ORDER = 5.0
        RATE_PER_KM = 0.2
        today_earnings = (today_orders * BASE_FEE_PER_ORDER) + (today_distance * RATE_PER_KM)

        # Today's alert counts by type
        today_harsh_braking = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.alert_type == 'harsh_braking',
            Alert.timestamp >= today_start
        ).count()
        
        today_speeding = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.alert_type.in_(['speeding', 'speed_violation']),
            Alert.timestamp >= today_start
        ).count()
        
        today_fatigue_alerts = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.alert_type.in_(['fatigue', 'fatigue_warning']),
            Alert.timestamp >= today_start
        ).count()
        
        today_critical_alerts = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.severity == 4,
            Alert.timestamp >= today_start
        ).count()
        
        today_safety_alerts = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.timestamp >= today_start
        ).count()
        
        today_other_alerts = today_safety_alerts - today_critical_alerts - today_fatigue_alerts - today_speeding - today_harsh_braking
        
        # Today's breaks count (from Break table)
        today_breaks = self.db.query(Break).filter(
            Break.driver_id == driver.driver_id,
            Break.start_time >= today_start
        ).count()
        
        # Calculate TODAY's safety score (0-100)
        # Deductions based on today's alerts only
        today_safety_score = 100.0
        today_safety_score -= min(today_critical_alerts * 15, 45)
        today_safety_score -= min(today_fatigue_alerts * 5, 25)
        today_safety_score -= min(today_speeding * 3, 15)
        today_safety_score -= min(today_harsh_braking * 2, 10)
        today_safety_score -= min(today_other_alerts * 1, 5)
        
        # Factor in current fatigue level from driver record
        current_fatigue = driver.fatigue_score or 0
        if current_fatigue > 7:  # SEVERE fatigue
            today_safety_score -= 15
        elif current_fatigue > 4:  # WARNING fatigue
            today_safety_score -= 8
        elif current_fatigue > 2:  # Elevated fatigue
            today_safety_score -= 3
        
        today_safety_score = max(0, today_safety_score)

        # ========== LIFETIME STATS ==========
        total_orders = self.db.query(Order).filter(
            Order.driver_id == driver.driver_id,
            Order.status == 'delivered'
        ).count()

        total_assigned = self.db.query(Order).filter(
            Order.driver_id == driver.driver_id,
        ).count()

        completion_rate = (total_orders / total_assigned * 100) if total_assigned > 0 else 0.0
        
        # Lifetime breaks and distance
        total_breaks = self.db.query(Break).filter(
            Break.driver_id == driver.driver_id
        ).count()
        
        total_distance = self.db.query(func.sum(Order.distance_km)).filter(
            Order.driver_id == driver.driver_id,
            Order.status == 'delivered'
        ).scalar() or 0.0

        # ========== 30-DAY STATS (Secondary - Trends) ==========
        orders_30d = self.db.query(Order).filter(
            Order.driver_id == driver.driver_id,
            Order.status == 'delivered',
            Order.delivered_at >= last_30_days
        ).count()
        
        breaks_30d = self.db.query(Break).filter(
            Break.driver_id == driver.driver_id,
            Break.start_time >= last_30_days
        ).count()
        
        distance_30d = self.db.query(func.sum(Order.distance_km)).filter(
            Order.driver_id == driver.driver_id,
            Order.status == 'delivered',
            Order.delivered_at >= last_30_days
        ).scalar() or 0.0
        
        total_30d_alerts = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.timestamp >= last_30_days
        ).count()
        
        harsh_braking_30d = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.alert_type == 'harsh_braking',
            Alert.timestamp >= last_30_days
        ).count()
        
        speeding_30d = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.alert_type.in_(['speeding', 'speed_violation']),
            Alert.timestamp >= last_30_days
        ).count()
        
        fatigue_30d = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.alert_type.in_(['fatigue', 'fatigue_warning']),
            Alert.timestamp >= last_30_days
        ).count()
        
        critical_30d = self.db.query(Alert).filter(
            Alert.driver_id == driver.driver_id,
            Alert.severity == 4,
            Alert.timestamp >= last_30_days
        ).count()
        
        other_30d = total_30d_alerts - critical_30d - fatigue_30d - speeding_30d - harsh_braking_30d
        
        # Calculate 30-day average safety score
        avg_30d_safety_score = 100.0
        avg_30d_safety_score -= min(critical_30d * 15, 45)
        avg_30d_safety_score -= min(fatigue_30d * 5, 25)
        avg_30d_safety_score -= min(speeding_30d * 3, 15)
        avg_30d_safety_score -= min(harsh_braking_30d * 2, 10)
        avg_30d_safety_score -= min(other_30d * 1, 5)
        avg_30d_safety_score = max(0, avg_30d_safety_score)

        return DriverPerformanceStats(
            driver_id=driver.driver_id,
            name=driver.name,
            # Today's stats (primary)
            today_orders=today_orders,
            today_earnings=round(today_earnings, 2),
            today_breaks=today_breaks,
            today_distance=round(today_distance, 2),
            today_safety_alerts=today_safety_alerts,
            today_safety_score=round(today_safety_score, 1),
            today_harsh_braking=today_harsh_braking,
            today_speeding=today_speeding,
            today_fatigue_alerts=today_fatigue_alerts,
            current_fatigue_score=driver.fatigue_score or 0.0,
            # Lifetime stats
            total_orders=total_orders,
            total_breaks=total_breaks,
            total_distance=round(total_distance, 2),
            average_rating=driver.rating or 0.0,
            completion_rate=round(completion_rate, 2),
            # 30-day totals and averages
            orders_30d=orders_30d,
            breaks_30d=breaks_30d,
            distance_30d=round(distance_30d, 2),
            avg_30d_safety_score=round(avg_30d_safety_score, 1),
            total_30d_alerts=total_30d_alerts,
            avg_30d_harsh_braking=round(harsh_braking_30d / 30, 2),
            avg_30d_speeding=round(speeding_30d / 30, 2),
            avg_30d_fatigue_alerts=round(fatigue_30d / 30, 2)
        )
    
    def update_zone(self, driver_id: str, new_zone: str) -> Driver:
        driver = self.get_driver_by_id(driver_id)

        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver not found"
            )
        
        old_zone = driver.current_zone
        driver.current_zone = new_zone
        self.db.commit()
        self.db.refresh(driver)

        kafka_producer.publish("driver-zone", {
            "driver_id": driver.driver_id,
            "old_zone": old_zone,
            "new_zone": new_zone,
            "timestamp": str(datetime.now())
        })
        return driver
        
    def get_drivers_by_zone(self, zone: str) -> List[Driver]:
        drivers = self.db.query(Driver).filter(
            Driver.current_zone == zone,
            Driver.duty_status == DutyStatus.ON_DUTY.value).all()
        return drivers
    
    def list_drivers(self, skip: int = 0, limit: int = 100) -> List[Driver]:
        return self.db.query(Driver).offset(skip).limit(limit).all()
    
    def count_total_drivers(self) -> int:
        return self.db.query(Driver).count()
    
    def count_drivers_by_status(self, status: DriverStatus) -> int:
        return self.db.query(Driver).filter(
            Driver.status == status.value,
            Driver.duty_status == DutyStatus.ON_DUTY.value).count()
    
    def count_drivers_by_duty_status(self, duty_status: DutyStatus) -> int:
        return self.db.query(Driver).filter(
            Driver.duty_status == duty_status.value).count()
    
    def get_all_active_drivers_locations(self) -> List[Dict[str, Any]]:
        drivers = self.db.query(Driver).filter(
            Driver.duty_status == DutyStatus.ON_DUTY.value,
            Driver.location.isnot(None)
        ).all()

        return [
            {
                "driver_id": driver.driver_id,
                "name": driver.name,
                "current_zone": driver.current_zone,
                "latitude": self.db.scalar(ST_Y(driver.location)),
                "longitude": self.db.scalar(ST_X(driver.location))
            }
            for driver in drivers
        ]