from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, date
from enum import Enum

class ReportType(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    DRIVER = "driver"
    ZONE = "zone"
    CUSTOM = "custom"

class MetricPeriod(str, Enum):
    TODAY = "today"
    YESTERDAY = "yesterday"
    LAST_7_DAYS = "last_7_days"
    LAST_30_DAYS = "last_30_days"
    THIS_MONTH = "this_month"
    LAST_MONTH = "last_month"
    CUSTOM = "custom"

class DailyMetricsResponse(BaseModel):
    metric_id: str
    date: date
    
    total_orders: int
    completed_orders: int
    cancelled_orders: int
    avg_delivery_time_min: Optional[float]
    avg_distance_km: Optional[float]
    total_revenue: float

    active_drivers: int
    total_driver_hours: float
    
    total_alerts: int
    fatigue_alerts: int
    accident_alerts: int
    
    avg_pickup_time_min: Optional[float]
    driver_utilization_rate: Optional[float]
    order_completion_rate: Optional[float]
    busiest_zone: Optional[str]
    
    class Config:
        from_attributes = True

class DriverMetricsResponse(BaseModel):
    metric_id: str
    driver_id: str
    date: date
    
    orders_completed: int
    orders_cancelled: int
    total_distance_km: float
    total_earnings: float
    
    hours_worked: float
    hours_active: float
    hours_idle: float
    
    safety_alerts: int
    harsh_braking_count: int
    harsh_acceleration_count: int
    
    avg_delivery_time_min: Optional[float]
    orders_per_hour: Optional[float]
    
    class Config:
        from_attributes = True

class ZoneMetricsResponse(BaseModel):
    metric_id: str
    zone_id: str
    date: date
    hour: Optional[int]
    
    total_orders: int
    completed_orders: int
    avg_demand_score: Optional[float]
    peak_hour: Optional[int]
    
    avg_drivers_available: Optional[float]
    driver_shortage_minutes: int
    
    avg_wait_time_min: Optional[float]
    fulfillment_rate: Optional[float]
    
    class Config:
        from_attributes = True

class DashboardOverview(BaseModel):
    period: str
    total_orders: int
    completed_orders: int
    active_drivers: int
    total_revenue: float

    orders_change_percent: float
    revenue_change_percent: float
    drivers_change_percent: float
    completion_rate_change_percent: float = 0.0
    delivery_time_change_percent: float = 0.0

    avg_delivery_time_min: float
    order_completion_rate: float
    driver_utilization_rate: float
    
    total_safety_alerts: int
    critical_alerts: int

class RealtimeMetrics(BaseModel):
    timestamp: datetime
    
    drivers_online: int
    drivers_available: int
    drivers_busy: int
    drivers_on_break: int
    
    orders_pending: int
    orders_in_progress: int
    orders_completed_today: int

    orders_per_hour: float
    avg_wait_time_min: float
    
    active_alerts: int

class ZoneHeatmapItem(BaseModel):
    zone_id: str
    latitude: float
    longitude: float
    demand_score: float
    color: str 

class ZoneHeatmap(BaseModel):
    timestamp: datetime
    zones: List[ZoneHeatmapItem]

class TrendData(BaseModel):
    metric_name: str
    period: str
    data_points: List[Dict[str, Any]]  # List of {timestamp, value}


class ReportRequest(BaseModel):
    report_type: ReportType
    start_date: date
    end_date: date
    entity_id: Optional[str] = None  # driver_id or zone_id
    include_insights: bool = True
    include_recommendations: bool = True

class ReportResponse(BaseModel):
    report_id: str
    report_type: str
    entity_id: Optional[str]
    start_date: date
    end_date: date
    
    summary: Dict[str, Any]
    metrics: Dict[str, Any]
    insights: Optional[List[str]]
    recommendations: Optional[List[str]]
    
    generated_by: str
    generated_at: datetime
    
    class Config:
        from_attributes = True

class PerformanceAnalysis(BaseModel):
    entity_type: str  # driver, zone, system
    entity_id: Optional[str]
    period: str
    
    performance_score: float  # 0-100
    grade: str  # A+, A, B, C, D, F
    
    efficiency_score: float
    safety_score: float
    reliability_score: float
    
    strengths: List[str]
    weaknesses: List[str]
    improvement_areas: List[str]

class PredictiveAnalysis(BaseModel):
    metric: str
    forecast_period: str
    
    current_value: float
    predicted_value: float
    confidence: float
    trend: str  # increasing, decreasing, stable
    
    factors: List[Dict[str, Any]]

class ComparativeAnalysis(BaseModel):
    comparison_type: str  # driver_vs_driver, zone_vs_zone, period_vs_period
    entities: List[str]
    metrics: Dict[str, List[float]]
    winner: Optional[str]
    insights: List[str]

class ForecastResponse(BaseModel):
    status: str
    message: Optional[str] = None


class AlertTypeSummary(BaseModel):
    alert_type: str
    count: int
    percentage: float

class AlertDaySummary(BaseModel):
    day: str
    count: int

class AlertZoneSummary(BaseModel):
    zone_id: str
    zone_name: Optional[str] = None
    count: int

class AlertsSummaryResponse(BaseModel):
    total_alerts: int
    period: str
    by_type: List[AlertTypeSummary]
    by_day: List[AlertDaySummary]
    by_zone: List[AlertZoneSummary]
    by_severity: Dict[str, int]


class SafetyScoreResponse(BaseModel):
    overall_score: float  # 0-100
    grade: str  # A+, A, B, C, D, F
    trend: str  # improving, declining, stable
    trend_percentage: float
    
    # Component scores
    fatigue_score: float
    incident_score: float
    compliance_score: float
    behavior_score: float
    
    # Key metrics
    total_incidents: int
    critical_incidents: int
    accident_rate: float  # percentage
    fatigue_alerts_count: int
    speeding_events: int
    harsh_braking_events: int
    peak_speeding_hour: Optional[str] = None
    
    # Benchmarks
    industry_benchmark: float
    previous_period_score: float


class TopPerformerDriver(BaseModel):
    driver_id: str
    name: str
    efficiency_score: float
    orders_completed: int
    total_earnings: float
    avg_delivery_time_min: float
    safety_score: float
    on_time_rate: float
    rating: float


class TopPerformersResponse(BaseModel):
    period: str
    drivers: List[TopPerformerDriver]


class DemandForecastPoint(BaseModel):
    hour: str
    actual: Optional[float] = None
    predicted: float
    confidence: float


class DemandForecastResponse(BaseModel):
    generated_at: datetime
    forecast_hours: int
    current_demand: int
    peak_predicted_hour: str
    peak_predicted_demand: float
    forecasts: List[DemandForecastPoint]
    recommendations: List[str]


class DemandHistoryPoint(BaseModel):
    hour: str 
    actual: Optional[int] = None
    predicted: Optional[float] = None


class DemandHistoryResponse(BaseModel):
    date: str 
    date_label: str
    is_today: bool
    current_hour: Optional[int] = None  
    data: List[DemandHistoryPoint]
    total_actual: int
    total_predicted: float    
    recommendations: List[str] = []

class HighRiskZone(BaseModel):
    zone_id: str
    zone_name: str
    risk_level: str  # 'Critical', 'High', 'Medium', 'Low'
    reason: str

class AtRiskDriver(BaseModel):
    driver_id: str
    name: str
    continuous_hours: float
    risk_level: str  # 'Critical', 'High', 'Medium'

class WeatherImpact(BaseModel):
    condition: str
    timeframe: str
    impact_text: str
    icon_type: str   # 'rain', 'temperature', 'optimal'

class PredictiveRisksResponse(BaseModel):
    high_risk_zones: List[HighRiskZone]
    drivers_at_risk: List[AtRiskDriver]
    weather_impacts: List[WeatherImpact]

