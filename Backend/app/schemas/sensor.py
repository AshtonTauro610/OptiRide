from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class AccelerometerData(BaseModel):
    x: float 
    y: float
    z: float
    timestamp: datetime

class GyroscopeData(BaseModel):
    x: float
    y: float
    z: float
    timestamp: datetime

class LocationData(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    speed: Optional[float] = Field(None, ge=0.0)
    heading: Optional[float] = Field(None, ge=0.0, le=360.0)
    altitude: Optional[float] = None
    accuracy: Optional[float] = None
    timestamp: datetime 

class CameraFrameData(BaseModel):
    frame_data: str
    timestamp: datetime

class SensorDataBatch(BaseModel):
    driver_id: str
    session_id: str
    accelerometer_data: List[AccelerometerData]
    gyroscope_data: List[GyroscopeData]
    location_data: LocationData
    camera_frame_data: Optional[CameraFrameData] = None

class FatigueAnalysisResult(BaseModel):
    fatigue_score: float = Field(..., ge=0, le=1, description="0=alert, 1=extremely fatigued")
    eye_blink_rate: Optional[float] = None
    yawn_detected: Optional[bool] = None
    head_tilt_rate: Optional[float] = None
    recommendation: str
    alert_level: str 

class MovementAnalysisResult(BaseModel):
    harsh_braking: bool
    harsh_acceleration: bool
    sharp_turn: bool
    sudden_impact: bool
    risk_level: str
    description: str

class DistanceStats(BaseModel):
    session_id: str
    total_distance_km: float
    total_duration_hours: float
    average_speed_kmh: float
    max_speed_kmh: float
    start_time: datetime
    end_time: Optional[datetime]

class SensorDataBatchResponse(BaseModel):
    status: str
    record_id: str
    fatigue_score: Optional[float] = None
    movement_risk: Optional[str] = None
    crash_probability: Optional[float] = None
    crash_action: Optional[str] = None
    crash_fuzzy: Optional[float] = None
    fall_probability: Optional[float] = None
    fall_action: Optional[str] = None
    fall_fuzzy: Optional[float] = None
    alerts_generated: int
    recommendation: str
    genai_insights: List[str] = []
