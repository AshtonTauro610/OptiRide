from pydantic import BaseModel, Field, computed_field, field_validator
from typing import Optional, Any
from datetime import datetime
from enum import Enum
from geoalchemy2.shape import to_shape
from geoalchemy2.elements import WKBElement

class DriverStatus(str, Enum):
    AVAILABLE = "available"
    OFFLINE = "offline"
    BUSY = "busy"
    ON_BREAK = "on_break"

class DutyStatus(str, Enum):
    ON_DUTY = "on_duty"
    OFF_DUTY = "off_duty"


class DriverBase(BaseModel):
    name : str
    current_zone : Optional[str] = None

class LocationSchema(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    speed: Optional[float] = None
    heading: Optional[float] = None

class StatusUpdate(BaseModel):
    status: DriverStatus

class DutyStatusUpdate(BaseModel):
    duty_status: DutyStatus

class ZoneUpdate(BaseModel):
    zone_id: str

class DriverCreate(DriverBase):
    user_id : str
    vehicle_type : Optional[str] = None
    license_plate : Optional[str] = None

class DriverUpdate(DriverBase):
    user_id : str
    vehicle_type : Optional[str] = None
    license_plate : Optional[str] = None
    shift_type : Optional[str] = None
    shift_start_time : Optional[str] = None
    shift_end_time : Optional[str] = None

class TelemetryUpdate(BaseModel):
    battery_level : Optional[int] = None
    network_strength : Optional[str] = None
    camera_active : Optional[bool] = None

class DriverResponse(BaseModel):
    driver_id: str
    user_id: str
    name: str
    email: Optional[str] = None
    phone_number: Optional[str] = None
    vehicle_type: Optional[str] = None
    license_plate: Optional[str] = None
    current_zone: Optional[str] = None
    status: DriverStatus

    location: Optional[LocationSchema] = None
    current_speed : Optional[float] = 0.0
    battery_level : Optional[int] = 100
    network_strength : Optional[str] = "strong"
    camera_active : Optional[bool] = True

    report_time: Optional[datetime] = None
    duty_status: str
    orders_received: int
    rating: float
    breaks: int
    safety_alerts: int
    fatigue_score: float
    
    # Scheduled shift timings
    shift_type: Optional[str] = "Morning"
    shift_start_time: Optional[str] = "09:00"
    shift_end_time: Optional[str] = "17:00"
    
    created_at: datetime
    updated_at: Optional[datetime] = None

    @computed_field
    def safety_score(self) -> float:
        base_score = 100
        alert_penalty = (self.safety_alerts or 0) * 5
        fatigue_penalty = (self.fatigue_score or 0) * 2
        final_score =  base_score - alert_penalty - fatigue_penalty
        return max(0, min(final_score, 100))

    @field_validator('location', mode='before')
    @classmethod
    def serialize_location(cls, v: Any) -> Optional[LocationSchema]:
        if v is None:
            return None
        if isinstance(v, WKBElement) or hasattr(v, "desc"):
             point = to_shape(v)
             return LocationSchema(latitude=point.y, longitude=point.x)
        return v

    class Config:
        from_attributes = True

class DriverWithTodayStats(DriverResponse):
    today_safety_score: float = 100.0
    today_safety_alerts: int = 0
    today_harsh_braking: int = 0
    today_speeding: int = 0
    today_fatigue_alerts: int = 0

class DriverListResponse(BaseModel):
    drivers: list[DriverWithTodayStats]
    total: int

class DriverPerformanceStats(BaseModel):
    driver_id : str
    name : str

    # Today's stats
    today_orders : int
    today_earnings : float  
    today_breaks : int
    today_distance : float 
    today_safety_alerts : int 
    today_safety_score : float  
    today_harsh_braking : int
    today_speeding : int
    today_fatigue_alerts : int
    current_fatigue_score : float  
    current_speed : float = 0.0 
    
    # Lifetime/overall stats
    total_orders : int
    total_assigned : int = 0
    total_breaks : int = 0 
    total_distance : float = 0.0 
    average_rating : float
    completion_rate : float
    
    # 30-day totals and averages 
    orders_30d : int = 0  # Total orders in last 30 days
    breaks_30d : int = 0  # Total breaks in last 30 days
    distance_30d : float = 0.0  # Total distance in last 30 days
    avg_30d_safety_score : float  # 30-day average safety score
    total_30d_alerts : int
    avg_30d_harsh_braking : float  # Average per day
    avg_30d_speeding : float  # Average per day
    avg_30d_fatigue_alerts : float  # Average per day
    

class NearbyDriverResponse(BaseModel):
    driver_id : str
    name : str
    status : DriverStatus
    rating : float
    latitude : float
    longitude : float
    distance_meters : float
    current_zone : Optional[str] = None

class ShiftStart(BaseModel):
    start_time : datetime
    start_latitude : float = Field(..., ge=-90, le=90)
    start_longitude : float = Field(..., ge=-180, le=180)

class ShiftEnd(BaseModel):
    end_time : datetime
    end_latitude : float = Field(..., ge=-90, le=90)
    end_longitude : float = Field(..., ge=-180, le=180)

class ShiftSummary(BaseModel):
    driver_id : str
    name : str
    start_time : datetime
    end_time : Optional[datetime]
    total_hours : float
    total_orders : int
    total_distance : float
    breaks_taken : int
    safety_alerts : int
    average_rating : float

class BreakRequest(BaseModel):
    break_type : str
    start_time : datetime
    end_time : Optional[datetime] = None
    latitude : Optional[float] = Field(None, ge=-90, le=90)
    longitude : Optional[float] = Field(None, ge=-180, le=180)

class BreakResponse(BaseModel):
    driver_id : str
    break_type : str
    start_time : datetime
    end_time : Optional[datetime] = None
    latitude : Optional[float] = None
    longitude : Optional[float] = None


