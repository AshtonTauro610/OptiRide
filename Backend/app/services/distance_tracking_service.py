from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
from typing import List, Optional
import math
from app.models.gps_track import GPSTrack
from app.models.driver import Driver
from app.schemas.sensor import LocationData, DistanceStats
from geoalchemy2.functions import ST_Distance, ST_MakePoint, ST_SetSRID, ST_Transform
from geoalchemy2.elements import WKTElement
import redis
from app.core.redis_client import redis_client

class DistanceTrackingService:
    def __init__(self, db: Session):
        self.db = db

    def record_gps_point(self, driver_id: str, session_id: str, location_data: LocationData) -> GPSTrack:
        last_point = self.db.query(GPSTrack).filter(
            GPSTrack.driver_id == driver_id,
            GPSTrack.session_id == session_id
        ).order_by(GPSTrack.recorded_at.desc()).first()

        distance_from_last = 0.0
        cumulative_distance = 0.0

        new_location_wkt = WKTElement(f'POINT({location_data.longitude} {location_data.latitude})', srid=4326)

        if last_point and last_point.location:
            distance_meters = self.db.query(
                func.ST_Distance(
                    last_point.location,
                    new_location_wkt,
                    True
                )
            ).scalar()

            distance_from_last = distance_meters / 1000.0 if distance_meters else 0.0
            cumulative_distance = last_point.cumulative_distance + distance_from_last

        driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
        if driver:
            driver.location = new_location_wkt
            driver.updated_at = datetime.utcnow()
            
            if driver.status == "offline":
                driver.status = "available"
            if driver.duty_status == "off_duty":
                driver.duty_status = "on_duty"
                if not driver.report_time:
                    driver.report_time = datetime.utcnow()

            try:
                if location_data.speed is not None:
                    redis_client.set(f"driver:{driver_id}:speed", str(location_data.speed))
                if location_data.heading is not None:
                    redis_client.set(f"driver:{driver_id}:heading", str(location_data.heading))
            except redis.exceptions.ConnectionError:
                pass

            throttle_key = f"driver_telemetry_throttle:{driver_id}"
            try:
                is_throttled = redis_client.get(throttle_key)
                if not is_throttled:
                    cached_speed = redis_client.get(f"driver:{driver_id}:speed")
                    cached_heading = redis_client.get(f"driver:{driver_id}:heading")
                    if cached_speed is not None:
                        driver.current_speed = float(cached_speed)
                    if cached_heading is not None:
                        driver.heading = float(cached_heading)
                    self.db.commit()
                    redis_client.setex(throttle_key, 30, "1")
            except redis.exceptions.ConnectionError:
                if location_data.speed is not None:
                    driver.current_speed = location_data.speed
                if location_data.heading is not None:
                    driver.heading = location_data.heading
                self.db.commit()

        gps_track = GPSTrack(
            driver_id=driver_id,
            session_id=session_id,
            location=new_location_wkt,
            latitude=location_data.latitude,
            longitude=location_data.longitude,
            speed=location_data.speed,
            heading=location_data.heading,
            altitude=location_data.altitude,
            accuracy=location_data.accuracy,
            distance_from_last=distance_from_last,
            cumulative_distance=cumulative_distance,
            recorded_at=location_data.timestamp
        )
        self.db.add(gps_track)
        self.db.commit()
        self.db.refresh(gps_track)
        return gps_track
    
    def compute_distance_stats(self, driver_id: str, session_id: str) -> Optional[DistanceStats]:
        points = self.db.query(GPSTrack).filter(
            GPSTrack.driver_id == driver_id,
            GPSTrack.session_id == session_id
        ).order_by(GPSTrack.recorded_at).all()

        if not points:
            return None
        
        first_point = points[0]
        last_point = points[-1]

        total_distance_km = last_point.cumulative_distance
        duration_seconds = (last_point.recorded_at - first_point.recorded_at).total_seconds() 
        total_duration_hours = duration_seconds / 3600.0

        speeds = [p.speed for p in points if p.speed and p.speed > 0]
        avg_speed = sum(speeds) / len(speeds) if speeds else 0.0
        max_speed = max(speeds) if speeds else 0.0

        return DistanceStats(
            session_id=session_id,
            total_distance_km=total_distance_km,
            total_duration_hours=total_duration_hours,
            average_speed_kmh=avg_speed,
            max_speed_kmh=max_speed,
            start_time=first_point.recorded_at,
            end_time=last_point.recorded_at if total_duration_hours > 0 else None
        )
    
    def get_today_distance(self, driver_id: str, start_time: Optional[datetime] = None) -> float:
        if not start_time:
            start_time = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

        result = self.db.query(
            func.sum(GPSTrack.distance_from_last)
        ).filter(
            GPSTrack.driver_id == driver_id,
            GPSTrack.recorded_at >= start_time
        ).scalar()

        return round(float(result), 2) if result else 0.0