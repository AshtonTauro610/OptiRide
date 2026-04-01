import uuid
from sqlalchemy import Column, String, Integer, Float, JSON, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from geoalchemy2 import Geometry
from app.db.database import Base
from sqlalchemy.orm import relationship

class Zone(Base):
    __tablename__ = "zones"

    zone_id = Column(String, primary_key=True)
    name = Column(String)

    centroid = Column(Geometry('POINT'), nullable=False)
    boundary = Column(Geometry('POLYGON'), nullable=True)  # Zone boundary for point-in-polygon checks
    
    demand_score = Column(Float, default=0.0)
    active_drivers = Column(Integer, default=0)
    available_drivers = Column(Integer, default=0)
    pending_orders = Column(Integer, default=0)

    avg_daily_orders = Column(Float, default=0.0)
    avg_peak_demand = Column(Float, default=0.0)

    area_km2 = Column(Float)
    population_density = Column(Float)
    restaurant_count = Column(Integer, default=0)

    demands = relationship("Demand", back_populates="zone")
    
class DemandForecast(Base):
    __tablename__ = "demand_forecasts"

    forecast_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    zone_id = Column(String, ForeignKey("zones.zone_id"), nullable=False)
    
    forecast_time = Column(DateTime, nullable=False, index=True)
    forecast_horizon = Column(Integer)

    predicted_demand = Column(Float, nullable=False)
    demand_score = Column(Float)
    confidence_interval_lower = Column(Float)
    confidence_interval_upper = Column(Float)

    model_used = Column(String)
    model_version = Column(String)
    confidence = Column(Float)

    features = Column(JSON)

    threshold_exceeded = Column(Boolean, default=False)
    alert_level = Column(String)

    created_at = Column(DateTime)

class DemandPattern(Base):
    __tablename__ = "demand_patterns"

    pattern_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    zone_id = Column(String, ForeignKey("zones.zone_id"), nullable=False)
    
    pattern_type = Column(String) # hourly, daily, weekly, monthly, seasonal, event

    hour_of_day = Column(Integer)
    day_of_week = Column(Integer)
    week_of_month = Column(Integer)
    month = Column(Integer)

    avg_demand = Column(Float)
    std_demand = Column(Float)
    peak_demand = Column(Float)
    min_demand = Column(Float)

    influencing_factors = Column(JSON)

    sample_size = Column(Integer)
    last_updated = Column(DateTime)
    