from sqlalchemy import Column, String, DateTime, Integer, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from app.db.database import Base
import uuid
from datetime import datetime

class Alert(Base):
    __tablename__ = "alerts"

    alert_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    driver_id = Column(String, ForeignKey('drivers.driver_id', ondelete='CASCADE'), nullable=False)
    alert_type = Column(String, nullable=False)  # Store enum value as string
    severity = Column(Integer, nullable=False) # 1 (low) to 4 (Critical)
    location = Column(Geometry('POINT'))
    timestamp = Column(DateTime, default=datetime.utcnow)
    acknowledged = Column(Boolean, default=False)
    

    driver = relationship("Driver", back_populates="alerts")