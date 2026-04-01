from sqlalchemy import Column, String, DateTime, Date, Integer, Float, ForeignKey, Boolean, JSON
from sqlalchemy.orm import relationship
from app.db.database import Base
import uuid
from datetime import datetime

class DailyMetrics(Base):
    __tablename__ = "daily_metrics"

    metric_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    date = Column(Date, nullable=False, index=True, unique=True) 

    total_orders = Column(Integer, default=0)
    completed_orders = Column(Integer, default=0)
    cancelled_orders = Column(Integer, default=0)
    
    avg_delivery_time_min = Column(Float, nullable=True)
    avg_distance_km = Column(Float, nullable=True)
    total_revenue = Column(Float, default=0.0)

    total_alerts = Column(Integer, default=0)
    fatigue_alerts = Column(Integer, default=0)
    accident_alerts = Column(Integer, default=0)

    avg_pickup_time_min = Column(Float, nullable=True)
    driver_utilization_rate = Column(Float, nullable=True)
    order_completion_rate = Column(Float, nullable=True)

    busiest_zone = Column(String, nullable=True)
    active_drivers_peak = Column(Integer, default=0)

class Demand(Base):
    __tablename__ = "demands"

    demand_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    zone_id = Column(String, ForeignKey('zones.zone_id'), nullable=False)
    
    demand_score = Column(Float, nullable=False) 
    confidence = Column(Float, nullable=False)
    demand_threshold_exceeded = Column(Boolean, default=False)
    
    influencing_factors = Column(JSON) # e.g. ["rain", "holiday", "rush_hour"]
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)

    zone = relationship("Zone", back_populates="demands") 

class GenInsights(Base):
    __tablename__ = "gen_insights"

    insight_id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    recipient_id = Column(String, ForeignKey('drivers.driver_id'), nullable=True) 
    
    topic = Column(String) # e.g. "Safety", "Efficiency"
    message = Column(String, nullable=False)
    priority = Column(Integer, default=1) # 1 (low) to 5 (high)
    created_at = Column(DateTime, default=datetime.utcnow)

    driver = relationship("Driver", back_populates="gen_insights")

class DriverMetrics(Base):
    __tablename__ = "driver_metrics"
    
    metric_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    driver_id = Column(String, ForeignKey('drivers.driver_id'), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)

    orders_completed = Column(Integer, default=0)
    orders_cancelled = Column(Integer, default=0)
    total_distance_km = Column(Float, default=0.0)
    total_earnings = Column(Float, default=0.0)

    hours_worked = Column(Float, default=0.0)
    hours_active = Column(Float, default=0.0)
    hours_idle = Column(Float, default=0.0)

    safety_alerts = Column(Integer, default=0)
    harsh_braking_count = Column(Integer, default=0)
    harsh_acceleration_count = Column(Integer, default=0)

    avg_delivery_time_min = Column(Float, nullable=True)
    orders_per_hour = Column(Float, nullable=True)

class ZoneMetrics(Base):
    __tablename__ = "zone_metrics"
    
    metric_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    zone_id = Column(String, ForeignKey('zones.zone_id'), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    hour = Column(Integer, nullable=True) 

    total_orders = Column(Integer, default=0)
    completed_orders = Column(Integer, default=0)

    avg_demand_score = Column(Float, nullable=True) 
    peak_hour = Column(Integer, nullable=True)
    
    avg_drivers_available = Column(Float, default=0.0)
    driver_shortage_minutes = Column(Integer, default=0)
    
    avg_wait_time_min = Column(Float, nullable=True)
    fulfillment_rate = Column(Float, nullable=True)

class PerformanceReport(Base):
    __tablename__ = "performance_reports"
    
    report_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    report_type = Column(String, nullable=False) # 'weekly', 'monthly'
    entity_id = Column(String, nullable=True) 
    
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)

    summary = Column(JSON)
    metrics = Column(JSON)
    insights = Column(JSON)
    recommendations = Column(JSON)
    
    generated_by = Column(String, default="system")
    generated_at = Column(DateTime, default=datetime.utcnow)