from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

class OrderStatus(str, Enum):
    pending = "pending"
    offered = "offered"  # Order offered to driver, awaiting acceptance
    assigned = "assigned"
    picked_up = "picked_up"
    delivered = "delivered"
    cancelled = "cancelled"

class OrderCreate(BaseModel):
    pickup_address: str
    pickup_latitude: float = Field(..., ge=-90, le=90)
    pickup_longitude: float = Field(..., ge=-180, le=180)

    dropoff_address: str
    dropoff_latitude: float = Field(..., ge=-90, le=90)
    dropoff_longitude: float = Field(..., ge=-180, le=180)
    
    customer_name: str
    customer_contact: str

    restaurant_name: str
    restaurant_contact: str

    price: float = 0.0

class OrderUpdate(BaseModel):
    status: Optional[OrderStatus] = None
    
class OrderAssign(BaseModel):
    driver_id: str
    distance_km: Optional[float] = None
    duration_min: Optional[float] = None
    delivery_fee: Optional[float] = None
    pickup_time: Optional[datetime] = None
    dropoff_time: Optional[datetime] = None


class OrderPickup(BaseModel):
    pickup_latitude: float = Field(..., ge=-90, le=90)
    pickup_longitude: float = Field(..., ge=-180, le=180)
    

class OrderDeliver(BaseModel):
    dropoff_latitude: float = Field(..., ge=-90, le=90)
    dropoff_longitude: float = Field(..., ge=-180, le=180)
    

class OrderResponse(BaseModel):
    order_id: str
    pickup_address: str
    pickup_latitude: float
    pickup_longitude: float
    dropoff_address: str
    dropoff_latitude: float
    dropoff_longitude: float
    status: OrderStatus
    driver_id: Optional[str] = None
    customer_name: str
    customer_contact: str
    restaurant_name: str
    restaurant_contact: str
    price: float
    delivery_fee: Optional[float] = None
    distance_km: Optional[float] = None
    duration_min: Optional[float] = None
    pickup_time: Optional[datetime] = None
    dropoff_time: Optional[datetime] = None
    route_polyline: Optional[str] = None
    pickup_zone: Optional[str] = None
    dropoff_zone: Optional[str] = None
    assignment_id: Optional[str] = None
    created_at: datetime
    assigned_at: Optional[datetime] = None
    picked_up_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    optimized_sequence: Optional[List[str]] = None

    class Config:
        from_attributes = True

class OrderStats(BaseModel):
    total_orders: int
    pending: int
    assigned: int
    picked_up: int
    delivered: int
    
    avg_delivery_time_min: Optional[float] = None
    avg_distance_km: Optional[float] = None
    total_revenue: Optional[float] = None