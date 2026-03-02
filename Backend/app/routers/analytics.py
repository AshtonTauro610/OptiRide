from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date

from app.db.database import get_db
from app.core.dependencies import get_current_admin, get_current_user
from app.models.user import User
from app.services.analytics_service import AnalyticsService
from app.schemas.analytics import (
    DashboardOverview, RealtimeMetrics, ZoneHeatmap,
    TrendData, ReportRequest, ReportResponse, PerformanceAnalysis,
    MetricPeriod, ForecastResponse, AlertsSummaryResponse,
    SafetyScoreResponse, TopPerformersResponse, DemandForecastResponse,
    DemandHistoryResponse, PredictiveRisksResponse
)

router = APIRouter()

@router.get("/dashboard", response_model=DashboardOverview)
def get_dashboard_overview(
    period: str = Query("today", description="Period: today, last_7_days, this_month"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    return analytics_service.get_dashboard_overview(period=period)


@router.get("/realtime", response_model=RealtimeMetrics)
def get_realtime_metrics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    return analytics_service.get_realtime_metrics()


@router.get("/zones/heatmap", response_model=ZoneHeatmap)
def get_zone_heatmap(
    hour: Optional[int] = Query(None, ge=0, le=23, description="Hour of day (0-23), defaults to current hour"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    return analytics_service.get_zone_heatmap(hour=hour)


@router.get("/trends/{metric}", response_model=TrendData)
def get_trend_data(
    metric: str,
    period: str = Query("last_7_days", description="Period: today, last_7_days, this_month"),
    granularity: str = Query("daily", description="Granularity: hourly, daily, weekly"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    return analytics_service.get_trend_data(metric=metric, period=period, granularity=granularity)


@router.post("/reports", response_model=ReportResponse)
def generate_report(
    request: ReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    return analytics_service.generate_report(request=request, generated_by=current_user.user_id)

@router.get("/fleet-charts")
def get_fleet_dashboard_charts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    analytics = analytics_service.get_fleet_charts()
    return analytics

@router.get("/performance/{entity_type}", response_model=PerformanceAnalysis)
def analyze_performance(
    entity_type: str,
    entity_id: Optional[str] = Query(None, description="Driver ID or Zone ID (required for driver/zone types)"),
    period: str = Query("this_month", description="Period: today, last_7_days, this_month"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    if entity_type in ["driver", "zone"] and not entity_id:
        raise HTTPException(
            status_code=400, 
            detail=f"entity_id is required for {entity_type} analysis"
        )
    
    analytics_service = AnalyticsService(db)
    return analytics_service.analyze_performance(
        entity_type=entity_type, 
        entity_id=entity_id, 
        period=period
    )

@router.get("/drivers/{driver_id}/summary")
def get_driver_analytics_summary(
    driver_id: str,
    period: str = Query("this_month", description="Period: today, last_7_days, this_month"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    start_date, end_date = analytics_service._get_date_range(period)
    metrics = analytics_service._calculate_driver_metrics(driver_id, start_date, end_date)
    return {
        "driver_id": driver_id,
        "period": period,
        "metrics": metrics
    }


@router.get("/zones/{zone_id}/summary")
def get_zone_analytics_summary(
    zone_id: str,
    period: str = Query("this_month", description="Period: today, last_7_days, this_month"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    start_date, end_date = analytics_service._get_date_range(period)
    metrics = analytics_service._calculate_zone_metrics(zone_id, start_date, end_date)
    return {
        "zone_id": zone_id,
        "period": period,
        "metrics": metrics
    }

@router.get("/alerts/summary", response_model=AlertsSummaryResponse)
def get_alerts_summary(
    period: str = Query("last_7_days", description="Period: today, last_7_days, this_month"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    return analytics_service.get_alerts_summary(period=period)


@router.get("/safety/score", response_model=SafetyScoreResponse)
def get_safety_score(
    period: str = Query("last_7_days", description="Period: today, last_7_days, this_month"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """
    Safety score is calculated based on:
    - Fatigue alerts (25% weight)
    - Incident severity and count (35% weight)
    - Alert acknowledgment compliance (20% weight)
    - Driving behavior patterns (20% weight)
    """
    analytics_service = AnalyticsService(db)
    return analytics_service.get_safety_score(period=period)


@router.get("/drivers/top-performers", response_model=TopPerformersResponse)
def get_top_performers(
    period: str = Query("last_7_days", description="Period: today, last_7_days, this_month"),
    limit: int = Query(5, ge=1, le=20, description="Number of top performers to return"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """
    Efficiency score factors:
    - Order volume (30% weight)
    - Delivery speed (25% weight)
    - Safety record (25% weight)
    - On-time delivery rate (20% weight)
    """
    analytics_service = AnalyticsService(db)
    return analytics_service.get_top_performers(period=period, limit=limit)


@router.get("/demand/forecast", response_model=DemandForecastResponse)
def get_demand_forecast(
    hours: int = Query(12, ge=1, le=24, description="Number of hours to forecast"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    return analytics_service.get_demand_forecast(hours=hours)


@router.get("/demand/history")
def get_demand_history(
    date: Optional[str] = Query(None, description="Target date in YYYY-MM-DD format, defaults to today"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    return analytics_service.get_demand_history(target_date=date)

@router.get("/demand/zones")
def get_zone_demand_history(
    date: Optional[str] = Query(None, description="Target date in YYYY-MM-DD format, defaults to today"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    return analytics_service.get_zone_demand_history(target_date=date)

@router.get("/predictive-risks", response_model=PredictiveRisksResponse)
def get_predictive_risks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    analytics_service = AnalyticsService(db)
    return analytics_service.get_predictive_risks()

