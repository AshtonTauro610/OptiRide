from sqlalchemy import Column, String, DateTime, Integer, Float, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from app.db.database import Base
import uuid
from datetime import datetime

class Driver(Base):
    __tablename__ = "drivers"

    driver_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), unique=True, nullable=False)
    user_id = Column(String, ForeignKey('users.user_id'), unique=True, nullable=False)
    name = Column(String, nullable=False)
    vehicle_type = Column(String)
    license_plate = Column(String, unique=True)
    current_zone = Column(String, ForeignKey('zones.zone_id'))
    status = Column(String, default="offline")  

    location = Column(Geometry('POINT'))
    current_speed = Column(Float, default=0.0)
    heading = Column(Float, default=0.0)

    battery_level = Column(Integer, default=100)
    network_strength = Column(String, default="strong")
    camera_active = Column(Boolean, default=True)

    report_time = Column(DateTime)
    exit_time = Column(DateTime)
    duty_status = Column(String, default="off_duty")
    orders_received = Column(Integer, default=0)

    rating = Column(Float, default=0.0)
    breaks = Column(Integer, default=0)
    safety_alerts = Column(Integer, default=0)
    fatigue_score = Column(Float, default=0.0)

    # Scheduled shift timings
    shift_type = Column(String, default="Morning")  # Morning, Evening, Night
    shift_start_time = Column(String, default="09:00")  # HH:MM format
    shift_end_time = Column(String, default="17:00")  # HH:MM format

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    orders = relationship("Order", back_populates="driver")
    alerts = relationship("Alert", back_populates="driver", cascade="all, delete-orphan")
    assignments = relationship("Assignment", back_populates="driver")
    sensor_records = relationship("SensorRecord", back_populates="driver")
    events = relationship("Event", back_populates="driver")
    gps_tracks = relationship("GPSTrack", back_populates="driver")
    user = relationship("User", back_populates="driver")
    break_records = relationship("Break", back_populates="driver")
    gen_insights = relationship("GenInsights", back_populates="driver")

