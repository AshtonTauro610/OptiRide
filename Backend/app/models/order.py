from sqlalchemy import Column, String, DateTime, ForeignKey, Float, Integer
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from app.db.database import Base
import uuid
from datetime import datetime

class Order(Base):
    __tablename__ = "orders"

    order_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    pickup = Column(Geometry('POINT'), nullable=False)
    dropoff = Column(Geometry('POINT'), nullable=False)
    pickup_address = Column(String, nullable=False)
    dropoff_address = Column(String, nullable=False)
    pickup_latitude = Column(Float, nullable=False)
    pickup_longitude = Column(Float, nullable=False)
    dropoff_latitude = Column(Float, nullable=False)
    dropoff_longitude = Column(Float, nullable=False)

    status = Column(String, default="pending")  # pending, assigned, picked_up, delivered, cancelled
    driver_id = Column(String, ForeignKey('drivers.driver_id'), nullable=True)

    customer_name = Column(String, nullable=False)
    customer_contact = Column(String, nullable=False)

    restaurant_name = Column(String, nullable=False)
    restaurant_contact = Column(String, nullable=False)
    price = Column(Float, default=0.0)
    delivery_fee = Column(Float, nullable=True)
    

    distance_km = Column(Float, nullable=True)
    duration_min = Column(Float, nullable=True)
    pickup_time = Column(DateTime, nullable=True)
    dropoff_time = Column(DateTime, nullable=True)

    pickup_zone = Column(String, nullable=True)
    dropoff_zone = Column(String, nullable=True)
    route_polyline = Column(String, nullable=True)

    assignment_id = Column(String, ForeignKey('assignments.assignment_id'), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    assigned_at = Column(DateTime)
    picked_up_at = Column(DateTime)
    delivered_at = Column(DateTime)
    customer_rating = Column(Integer, nullable=True) # Remove

    # Relationships
    driver = relationship("Driver", back_populates="orders")
    assignment = relationship("Assignment", back_populates="orders")

    @property
    def optimized_sequence(self):
        return self.assignment.optimized_sequence if self.assignment else None