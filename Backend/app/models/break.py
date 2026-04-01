from sqlalchemy import Column, String, DateTime, ForeignKey, Float
from sqlalchemy.orm import relationship
from app.db.database import Base
import uuid
from datetime import datetime

class Break(Base):
    __tablename__ = "breaks"

    break_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    driver_id = Column(String, ForeignKey('drivers.driver_id'), nullable=False)
    
    break_type = Column(String, nullable=False)  # "rest", "meal", "emergency", etc.
    start_time = Column(DateTime, nullable=False, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    duration_minutes = Column(Float, nullable=True)
    
    start_latitude = Column(Float, nullable=True)
    start_longitude = Column(Float, nullable=True)
    end_latitude = Column(Float, nullable=True)
    end_longitude = Column(Float, nullable=True)
    
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    driver = relationship("Driver", back_populates="break_records")
