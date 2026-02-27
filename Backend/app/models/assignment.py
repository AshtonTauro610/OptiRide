from sqlalchemy import Column, String, DateTime, ForeignKey, JSON, Float
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from app.db.database import Base
import uuid
from datetime import datetime

class Assignment(Base):
    __tablename__ = "assignments"

    assignment_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    driver_id = Column(String, ForeignKey('drivers.driver_id'), nullable=False)
    route = Column(Geometry('LINESTRING'), nullable=True)
    
    route_polyline = Column(String, nullable=True)
    total_distance_km = Column(Float, nullable=True)
    estimated_time_min = Column(Float, nullable=True)
    optimized_sequence = Column(JSON, nullable=True)

    eta = Column(DateTime)
    status = Column(String, default="assigned")  # assigned, in_progress, completed, cancelled
    assigned_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    #orders_rel = relationship("Order", primaryjoin="Assignment.orders.any(Order.order_id)", viewonly=True)
    driver = relationship("Driver", back_populates="assignments")
    orders = relationship("Order", back_populates="assignment")  