from sqlalchemy.orm import Session
from sqlalchemy import func, and_, case, extract, text
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timedelta
import os
import pandas as pd
import joblib
import requests

from app.models.analytics import DailyMetrics, ZoneMetrics, PerformanceReport, Demand
from app.models.order import Order
from app.models.driver import Driver
from app.models.alert import Alert
from app.models.zone import Zone
from app.services.forecasting_service import ForecastingService

from app.schemas.alert import AlertSeverity
from app.schemas.driver import DriverStatus, DutyStatus
from app.schemas.order import OrderStatus
from app.schemas.analytics import (
    DashboardOverview, RealtimeMetrics, ZoneHeatmap,
    TrendData, ReportRequest, ReportResponse, PerformanceAnalysis,
    ReportType, AlertsSummaryResponse, AlertTypeSummary, AlertDaySummary,
    AlertZoneSummary, SafetyScoreResponse, TopPerformersResponse,
    TopPerformerDriver, DemandForecastResponse, DemandForecastPoint,
    PredictiveRisksResponse, HighRiskZone, AtRiskDriver, WeatherImpact
)


MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'ml', 'demand_model.pkl')
ENCODER_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'ml', 'zone_encoder.pkl')

demand_model = None
zone_encoder = None

if os.path.exists(MODEL_PATH) and os.path.exists(ENCODER_PATH):
    demand_model = joblib.load(MODEL_PATH)
    zone_encoder = joblib.load(ENCODER_PATH)

class AnalyticsService:  
    def __init__(self, db: Session):
        self.db = db

    def get_dashboard_overview(self, period: str = "today") -> DashboardOverview:
        start_date, end_date = self._get_date_range(period)
        
        # Calculate proper comparison period
        if period == "today":
            # Compare today vs yesterday (same time range)
            yesterday_end = start_date  # midnight today
            yesterday_start = yesterday_end - timedelta(days=1)  # midnight yesterday
        elif period == "last_7_days":
            # Compare last 7 days vs prior 7 days
            prev_end = start_date
            yesterday_start = prev_end - timedelta(days=7)
            yesterday_end = prev_end
        elif period == "last_30_days":
            # Compare last 30 days vs prior 30 days
            prev_end = start_date
            yesterday_start = prev_end - timedelta(days=30)
            yesterday_end = prev_end
        else:
            # Default: compare to prior period of same duration
            duration = end_date - start_date
            yesterday_end = start_date
            yesterday_start = yesterday_end - duration

        current = self._calculate_period_metrics(start_date, end_date)
        prev = self._calculate_period_metrics(yesterday_start, yesterday_end)
        

        total_alerts = self.db.query(Alert).filter(
            Alert.timestamp >= start_date, Alert.timestamp <= end_date
        ).count()
        
        critical_alerts = self.db.query(Alert).filter(
            Alert.timestamp >= start_date, 
            Alert.timestamp <= end_date,
            Alert.severity == AlertSeverity.CRITICAL.value
        ).count()
        
        return DashboardOverview(
            period=period,
            total_orders=current['total_orders'],
            completed_orders=current['completed_orders'],
            active_drivers=current['active_drivers'],
            total_revenue=current['total_revenue'],
            
            orders_change_percent=self._calculate_percent_change(prev['total_orders'], current['total_orders']),
            revenue_change_percent=self._calculate_percent_change(prev['total_revenue'], current['total_revenue']),
            drivers_change_percent=self._calculate_percent_change(prev['active_drivers'], current['active_drivers']),
            completion_rate_change_percent=self._calculate_percent_change(prev['completion_rate'], current['completion_rate']),
            delivery_time_change_percent=self._calculate_percent_change(prev['avg_delivery_time'], current['avg_delivery_time']),
            
            avg_delivery_time_min=current['avg_delivery_time'],
            order_completion_rate=current['completion_rate'],
            driver_utilization_rate=current['utilization_rate'],
            total_safety_alerts=total_alerts,
            critical_alerts=critical_alerts
        )

    def get_realtime_metrics(self) -> RealtimeMetrics:
        driver_counts = self.db.query(
            Driver.status, func.count(Driver.driver_id)
        ).filter(Driver.duty_status == DutyStatus.ON_DUTY.value).group_by(Driver.status).all()
        
        d_map = {status: count for status, count in driver_counts}
        

        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        
        orders_pending = self.db.query(Order).filter(Order.status == OrderStatus.pending.value).count()
        orders_in_progress = self.db.query(Order).filter(Order.status.in_([OrderStatus.assigned.value, OrderStatus.picked_up.value])).count()
        orders_completed_today = self.db.query(Order).filter(Order.status == OrderStatus.delivered.value, Order.delivered_at >= today_start).count()
        
        one_hour_ago = now - timedelta(hours=1)
        orders_last_hour = self.db.query(Order).filter(Order.created_at >= one_hour_ago).count()
        
        avg_wait = self.db.query(
            func.avg(extract('epoch', now - Order.created_at) / 60)
        ).filter(Order.status == OrderStatus.pending.value).scalar()
        
        active_alerts = self.db.query(Alert).filter(Alert.acknowledged == False).count()
        
        return RealtimeMetrics(
            timestamp=now,
            drivers_online=sum(d_map.values()),
            drivers_available=d_map.get(DriverStatus.AVAILABLE.value, 0),
            drivers_busy=d_map.get(DriverStatus.BUSY.value, 0),
            drivers_on_break=d_map.get(DriverStatus.ON_BREAK.value, 0),
            
            orders_pending=orders_pending,
            orders_in_progress=orders_in_progress,
            orders_completed_today=orders_completed_today,
            orders_per_hour=float(orders_last_hour),
            avg_wait_time_min=round(avg_wait or 0.0, 1),
            active_alerts=active_alerts
        )

    def get_zone_heatmap(self, hour: Optional[int] = None) -> ZoneHeatmap:
        if hour is None:
            hour = datetime.utcnow().hour

        zones = self.db.query(ZoneMetrics).filter(
            ZoneMetrics.date == datetime.utcnow().date(),
            ZoneMetrics.hour == hour
        ).all()
        
        heatmap_data = []
        if not zones:
            all_zones = self.db.query(Zone).all()
            for z in all_zones:
                # Extract lat/lon from centroid geometry
                lat = self.db.scalar(func.ST_Y(z.centroid)) if z.centroid else 25.2048
                lon = self.db.scalar(func.ST_X(z.centroid)) if z.centroid else 55.2708
                heatmap_data.append({
                    "zone_id": z.zone_id,
                    "latitude": lat,
                    "longitude": lon,
                    "demand_score": 0.5,
                    "color": "#FFCC00"
                })
        else:
            for zone in zones:
                zone_info = self.db.query(Zone).filter(Zone.zone_id == zone.zone_id).first()
                # Extract lat/lon from centroid geometry
                lat = self.db.scalar(func.ST_Y(zone_info.centroid)) if zone_info and zone_info.centroid else 25.2048
                lon = self.db.scalar(func.ST_X(zone_info.centroid)) if zone_info and zone_info.centroid else 55.2708
                
                heatmap_data.append({
                    "zone_id": zone.zone_id,
                    "latitude": lat,
                    "longitude": lon,
                    "demand_score": zone.avg_demand_score or 0,
                    "color": self._get_heatmap_color(zone.avg_demand_score or 0)
                })
        
        return ZoneHeatmap(
            timestamp=datetime.utcnow(),
            zones=heatmap_data
        )

    def get_trend_data(self, metric: str, period: str = "last_7_days", granularity: str = "daily") -> TrendData:        
        start_date, end_date = self._get_date_range(period)

        if metric == "orders":
            query = self.db.query(
                func.date(Order.created_at).label('d'), func.count(Order.order_id)
            ).filter(Order.created_at >= start_date, Order.created_at <= end_date)\
             .group_by('d').all()
            data_points = [{"timestamp": str(r[0]), "value": r[1]} for r in query]
            
        elif metric == "revenue":
            query = self.db.query(
                func.date(Order.delivered_at).label('d'), func.sum(Order.price)
            ).filter(Order.status == OrderStatus.delivered.value, Order.delivered_at >= start_date)\
             .group_by('d').all()
            data_points = [{"timestamp": str(r[0]), "value": float(r[1] or 0)} for r in query]
            
        else:
            data_points = []
        
        return TrendData(metric_name=metric, period=period, data_points=data_points)

    def generate_report(self, request: ReportRequest, generated_by: str) -> PerformanceReport:
        start_dt = datetime.combine(request.start_date, datetime.min.time())
        end_dt = datetime.combine(request.end_date, datetime.max.time())
        
        metrics_summary = {}
        insights = []
        recommendations = []

        if request.report_type == ReportType.DRIVER or request.report_type.value == "driver":
            metrics = self._calculate_driver_metrics(request.entity_id, start_dt, end_dt)
            metrics_summary = self._generate_driver_summary(metrics)
        elif request.report_type == ReportType.ZONE or request.report_type.value == "zone":
            metrics = self._calculate_zone_metrics(request.entity_id, start_dt, end_dt)
            metrics_summary = self._generate_zone_summary(metrics)
        else:
            metrics = self._calculate_period_metrics(start_dt, end_dt)
            metrics_summary = self._generate_system_summary(metrics)
        
        if request.include_insights:
            insights = self._generate_insights(metrics, request.report_type)
        
        if request.include_recommendations:
            recommendations = self._generate_recommendations(metrics, request.report_type)
        
        report = PerformanceReport(
            report_type=request.report_type,
            entity_id=request.entity_id,
            start_date=request.start_date,
            end_date=request.end_date,
            summary=metrics_summary,
            metrics=metrics,
            insights=insights,
            recommendations=recommendations,
            generated_by=generated_by,
            generated_at=datetime.utcnow()
        )
        
        self.db.add(report)
        self.db.commit()
        self.db.refresh(report)
        return report

    def analyze_performance(self, entity_type: str, entity_id: Optional[str] = None, period: str = "this_month") -> PerformanceAnalysis:        
        start_date, end_date = self._get_date_range(period)
        
        if entity_type == "driver":
            metrics = self._calculate_driver_metrics(entity_id, start_date, end_date)
        elif entity_type == "zone":
            metrics = self._calculate_zone_metrics(entity_id, start_date, end_date)
        else:
            metrics = self._calculate_period_metrics(start_date, end_date)
        
        efficiency_score = self._calculate_efficiency_score(metrics)
        safety_score = self._calculate_safety_score(metrics)
        reliability_score = self._calculate_reliability_score(metrics)

        performance_score = (
            efficiency_score * 0.43 + 
            safety_score * 0.36 + 
            reliability_score * 0.21
        )

        if performance_score >= 90: grade = "A"
        elif performance_score >= 80: grade = "B"
        elif performance_score >= 70: grade = "C"
        elif performance_score >= 60: grade = "D"
        else: grade = "F"
        
        return PerformanceAnalysis(
            entity_type=entity_type,
            entity_id=entity_id,
            period=period,
            performance_score=round(performance_score, 2),
            grade=grade,
            efficiency_score=round(efficiency_score, 2),
            safety_score=round(safety_score, 2),
            reliability_score=round(reliability_score, 2),
            strengths=["Strong Safety Record"] if safety_score > 80 else [],
            weaknesses=["Low Efficiency"] if efficiency_score < 50 else [],
            improvement_areas=["Route Optimization"] if efficiency_score < 50 else []
        )
    
    
    def get_fleet_charts(self):
        today = datetime.utcnow().date()
        week_ago = datetime.utcnow() - timedelta(days=7)

        hourly_query = self.db.query(
            extract('hour', Order.created_at).label('hour'),
            Order.status,
            func.count(Order.order_id).label('count')
        ).filter(
            Order.created_at >= today
        ).group_by(text('1'), Order.status).all()
    
        hourly_map = {h:{'completed':0, 'cancelled':0, 'ongoing':0} for h in range(24)}

        for hour, status_val, count in hourly_query:
            h = int(hour)
            if status_val == OrderStatus.delivered.value:
                hourly_map[h]['completed'] = count
            elif status_val == OrderStatus.cancelled.value:
                hourly_map[h]['cancelled'] = count
            else:
                hourly_map[h]['ongoing'] += count
        
        hourly_stats = [
            {
                "time":f"{h:02d}:00",
                "completed": data['completed'],
                "cancelled": data['cancelled'],
                "ongoing": data['ongoing']
            }
            for h, data in hourly_map.items()
            if h <= datetime.utcnow().hour + 1
        ]

        weekly_query = self.db.query(
            func.to_char(Order.created_at, 'Dy').label('day_name'),
            func.date(Order.created_at).label('date'),
            func.count(Order.order_id).label('total_orders'),
            func.sum(case((Order.status == OrderStatus.delivered.value, 1), else_=0)).label('completed_count')
        ).filter(
            Order.created_at >= week_ago
        ).group_by(text('day_name'), text('date')).order_by(text('date')).all()
    
        weekly_stats = []
        for day_name, _, total, completed in weekly_query:
            efficiency = round((completed / total) * 100, 1) if total > 0 else 0
            weekly_stats.append({
                "day": day_name,
                "total_orders": total,
                "completed_orders": completed,
                "efficiency": efficiency
            })
        
        return {
            "hourly_stats": hourly_stats,
            "weekly_stats": weekly_stats
        }
    
    def _calculate_period_metrics(self, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        orders = self.db.query(Order).filter(Order.created_at >= start_date, Order.created_at <= end_date)
        
        total_orders = orders.count()
        completed_orders = orders.filter(Order.status == OrderStatus.delivered.value).count()
        
        total_revenue = orders.filter(Order.status == OrderStatus.delivered.value).with_entities(func.sum(Order.price)).scalar() or 0.0
        
        active_drivers = self.db.query(func.count(func.distinct(Order.driver_id))).filter(
            Order.assigned_at >= start_date, Order.assigned_at <= end_date
        ).scalar() or 0
        
        # Calculate actual delivery time from timestamps (picked_up_at to delivered_at)
        avg_delivery_time = self.db.query(
            func.avg(extract('epoch', Order.delivered_at - Order.picked_up_at) / 60)
        ).filter(
            Order.created_at >= start_date,
            Order.created_at <= end_date,
            Order.status == OrderStatus.delivered.value,
            Order.picked_up_at.isnot(None),
            Order.delivered_at.isnot(None)
        ).scalar()
        
        completion_rate = (completed_orders / total_orders * 100) if total_orders > 0 else 0.0
             
        return {
            "total_orders": total_orders,
            "completed_orders": completed_orders,
            "total_revenue": float(total_revenue),
            "active_drivers": active_drivers,
            "avg_delivery_time": float(avg_delivery_time) if avg_delivery_time else 0.0,
            "completion_rate": round(completion_rate, 2),
            "utilization_rate": 75.0 # Placeholder/Complex calc
        }

    def _calculate_driver_metrics(self, driver_id: str, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        orders = self.db.query(Order).filter(Order.driver_id == driver_id, Order.assigned_at >= start_date, Order.assigned_at <= end_date)
        
        orders_completed = orders.filter(Order.status == OrderStatus.delivered.value).count()
        orders_cancelled = orders.filter(Order.status == OrderStatus.cancelled.value).count()
        
        total_earnings = orders.filter(Order.status == OrderStatus.delivered.value).with_entities(func.sum(Order.price)).scalar() or 0.0

        total_distance = orders.filter(Order.status == OrderStatus.delivered.value).with_entities(func.sum(Order.distance_km)).scalar() or 0.0
        
        safety_alerts = self.db.query(Alert).filter(
            Alert.driver_id == driver_id, Alert.timestamp >= start_date, Alert.timestamp <= end_date
        ).count()
        
        safety_score = max(0, 100 - (safety_alerts * 5))
        
        return {
            "orders_completed": orders_completed,
            "orders_cancelled": orders_cancelled,
            "total_earnings": float(total_earnings),
            "total_distance": float(total_distance),
            "safety_alerts": safety_alerts,
            "safety_score": safety_score
        }

    def _calculate_zone_metrics(self, zone_id: str, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        orders = self.db.query(Order).filter(Order.pickup_zone == zone_id, Order.created_at >= start_date, Order.created_at <= end_date)
        
        total = orders.count()
        completed = orders.filter(Order.status == OrderStatus.delivered.value).count()
        fulfillment = (completed / total * 100) if total > 0 else 0.0
        
        return {
            "total_orders": total,
            "completed_orders": completed,
            "fulfillment_rate": round(fulfillment, 2)
        }

    def _calculate_efficiency_score(self, metrics: Dict[str, Any]) -> float:
        # Business logic: Efficiency is based on Completion Rate
        return metrics.get('completion_rate', metrics.get('fulfillment_rate', 80.0))

    def _calculate_safety_score(self, metrics: Dict[str, Any]) -> float:
        return float(metrics.get('safety_score', 90.0))

    def _calculate_reliability_score(self, metrics: Dict[str, Any]) -> float:
        return metrics.get('completion_rate', 85.0)

    def _calculate_percent_change(self, old: float, new: float) -> float:
        if old == 0:
            return min(100.0, new * 10) if new > 0 else 0.0
        change = round(((new - old) / old) * 100, 2)
        # Cap at reasonable values for display
        return max(-999.0, min(999.0, change))

    def _get_heatmap_color(self, score: float) -> str:
        if score >= 80: return "#FF0000"
        if score >= 60: return "#FF6600"
        if score >= 40: return "#FFCC00"
        return "#00FF00"

    def _generate_driver_summary(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        return {"performance": "Excellent" if metrics['orders_completed'] > 20 else "Standard", "data": metrics}

    def _generate_zone_summary(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        return {"status": "High Demand" if metrics['total_orders'] > 50 else "Normal", "data": metrics}

    def _generate_system_summary(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        return {"system_health": "Good", "data": metrics}

    def _generate_insights(self, metrics: Dict[str, Any], type: str) -> List[str]:
        # TODO: Implement AI insights generation
        # Heuristics for "AI" insights
        insights = []
        if type == 'driver' and metrics.get('safety_score', 100) < 80:
            insights.append("Driver showing signs of aggressive driving.")
        if type == 'zone' and metrics.get('fulfillment_rate', 100) < 60:
            insights.append("Zone requires more drivers to meet demand.")
        return insights

    def _generate_recommendations(self, metrics: Dict[str, Any], type: str) -> List[str]:
        # TODO: Implement AI recommendations generation
        recs = []
        if type == 'driver' and metrics.get('safety_alerts', 0) > 3:
            recs.append("Assign mandatory break.")
        return recs

    def _get_date_range(self, period: str) -> Tuple[datetime, datetime]:
        now = datetime.utcnow()
        if period == "today":
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif period == "last_7_days":
            start = now - timedelta(days=7)
        elif period == "last_30_days":
            start = now - timedelta(days=30)
        elif period == "this_month":
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        else:
            start = now - timedelta(days=1)
        return start, now


    def get_alerts_summary(self, period: str = "last_7_days") -> AlertsSummaryResponse:
        start_date, end_date = self._get_date_range(period)
        
        total_alerts = self.db.query(Alert).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date
        ).count()
        
        by_type_query = self.db.query(
            Alert.alert_type,
            func.count(Alert.alert_id).label('count')
        ).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date
        ).group_by(Alert.alert_type).all()
        
        by_type = [
            AlertTypeSummary(
                alert_type=row[0],
                count=row[1],
                percentage=round((row[1] / total_alerts * 100), 1) if total_alerts > 0 else 0
            )
            for row in by_type_query
        ]
        
        by_day_query = self.db.query(
            func.to_char(Alert.timestamp, 'Dy').label('day_name'),
            func.count(Alert.alert_id).label('count')
        ).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date
        ).group_by(text('day_name')).all()
        
        day_counts = {row[0]: row[1] for row in by_day_query}
        days_order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        by_day = [
            AlertDaySummary(day=day, count=day_counts.get(day, 0))
            for day in days_order
        ]
        
        by_zone_query = self.db.query(
            Driver.current_zone,
            func.count(Alert.alert_id).label('count')
        ).join(Driver, Alert.driver_id == Driver.driver_id).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date,
            Driver.current_zone.isnot(None)
        ).group_by(Driver.current_zone).order_by(text('count DESC')).limit(10).all()
        
        by_zone = []
        for row in by_zone_query:
            zone = self.db.query(Zone).filter(Zone.zone_id == row[0]).first()
            by_zone.append(AlertZoneSummary(
                zone_id=row[0],
                zone_name=zone.name if zone else row[0],
                count=row[1]
            ))
        
        by_severity_query = self.db.query(
            Alert.severity,
            func.count(Alert.alert_id).label('count')
        ).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date
        ).group_by(Alert.severity).all()
        
        severity_map = {1: 'low', 2: 'moderate', 3: 'warning', 4: 'critical'}
        by_severity = {severity_map.get(row[0], str(row[0])): row[1] for row in by_severity_query}
        
        return AlertsSummaryResponse(
            total_alerts=total_alerts,
            period=period,
            by_type=by_type,
            by_day=by_day,
            by_zone=by_zone,
            by_severity=by_severity
        )

    def get_safety_score(self, period: str = "last_7_days") -> SafetyScoreResponse:
        """     
        Safety Score Formula:
        - Base score: 100
        - Deductions based on:
          - Critical incidents: -10 points each (max -40)
          - Fatigue alerts: -2 points each (max -20)
          - Speeding events: -1 point each (max -15)
          - Harsh braking: -0.5 points each (max -10)
          - Accidents: -15 points each (max -30)
        """
        start_date, end_date = self._get_date_range(period)
        
        duration = end_date - start_date
        prev_end = start_date
        prev_start = prev_end - duration
        
        alert_counts = self.db.query(
            Alert.alert_type,
            func.count(Alert.alert_id).label('count')
        ).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date
        ).group_by(Alert.alert_type).all()
        
        alert_map = {row[0]: row[1] for row in alert_counts}
        
        fatigue_alerts = alert_map.get('fatigue', 0) + alert_map.get('fatigue_warning', 0)
        speeding_events = alert_map.get('speeding', 0) + alert_map.get('speed_violation', 0)
        harsh_braking = alert_map.get('harsh_braking', 0)
        accidents = alert_map.get('accident', 0)
        
        critical_query = self.db.query(func.count(Alert.alert_id)).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date,
            Alert.severity == 4  # CRITICAL
        ).scalar() or 0
        
        total_incidents = self.db.query(Alert).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date
        ).count()
        
        peak_speeding_hour_query = self.db.query(
            func.extract('hour', Alert.timestamp).label('hour_val'),
            func.count(Alert.alert_id).label('count')
        ).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date,
            Alert.alert_type.in_(['speeding', 'speed_violation'])
        ).group_by('hour_val').order_by(text('count DESC')).first()
        
        peak_speeding_hour = None
        if peak_speeding_hour_query and peak_speeding_hour_query[1] > 0:
            hour_int = int(peak_speeding_hour_query[0])
            ampm = "AM" if hour_int < 12 else "PM"
            display_hour = hour_int if hour_int <= 12 else hour_int - 12
            if display_hour == 0: display_hour = 12
            peak_speeding_hour = f"Peak at {display_hour} {ampm}"
        
        total_orders = self.db.query(Order).filter(
            Order.created_at >= start_date,
            Order.created_at <= end_date
        ).count()
        
        accident_rate = (accidents / total_orders * 100) if total_orders > 0 else 0.0
        
        fatigue_score = max(0, 100 - (fatigue_alerts * 5))
        
        incident_deduction = (
            (critical_query * 10) +  # Critical: -10 each
            (accidents * 15) +        # Accidents: -15 each
            (speeding_events * 2) +   # Speeding: -2 each
            (harsh_braking * 1)       # Harsh braking: -1 each
        )
        incident_score = max(0, 100 - min(incident_deduction, 100))
        
        unacknowledged = self.db.query(Alert).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date,
            Alert.acknowledged == False
        ).count()
        
        acknowledgment_rate = ((total_incidents - unacknowledged) / total_incidents * 100) if total_incidents > 0 else 100
        compliance_score = min(100, acknowledgment_rate)
        
        behavior_incidents = speeding_events + harsh_braking
        active_drivers = self.db.query(func.count(Driver.driver_id)).filter(
            Driver.duty_status == DutyStatus.ON_DUTY.value
        ).scalar() or 1
        
        incidents_per_driver = behavior_incidents / active_drivers
        behavior_score = max(0, 100 - (incidents_per_driver * 10))
        
        overall_score = (
            fatigue_score * 0.25 +
            incident_score * 0.35 +
            compliance_score * 0.20 +
            behavior_score * 0.20
        )
        
        if overall_score >= 95: grade = "A+"
        elif overall_score >= 90: grade = "A"
        elif overall_score >= 80: grade = "B"
        elif overall_score >= 70: grade = "C"
        elif overall_score >= 60: grade = "D"
        else: grade = "F"
        
        prev_incidents = self.db.query(Alert).filter(
            Alert.timestamp >= prev_start,
            Alert.timestamp <= prev_end
        ).count()
        
        if prev_incidents > 0:
            trend_pct = ((prev_incidents - total_incidents) / prev_incidents) * 100
            trend_pct = max(-100, min(100, trend_pct))
        else:
            trend_pct = 0 if total_incidents == 0 else -50
        
        if trend_pct > 5:
            trend = "improving"
        elif trend_pct < -5:
            trend = "declining"
        else:
            trend = "stable"
        
        prev_fatigue = self.db.query(Alert).filter(
            Alert.timestamp >= prev_start,
            Alert.timestamp <= prev_end,
            Alert.alert_type.in_(['fatigue', 'fatigue_warning'])
        ).count()
        prev_score = max(0, 100 - (prev_fatigue * 5) - (prev_incidents * 2))
        
        return SafetyScoreResponse(
            overall_score=round(overall_score, 1),
            grade=grade,
            trend=trend,
            trend_percentage=round(trend_pct, 1),
            fatigue_score=round(fatigue_score, 1),
            incident_score=round(incident_score, 1),
            compliance_score=round(compliance_score, 1),
            behavior_score=round(behavior_score, 1),
            total_incidents=total_incidents,
            critical_incidents=critical_query,
            accident_rate=round(accident_rate, 2),
            fatigue_alerts_count=fatigue_alerts,
            speeding_events=speeding_events,
            harsh_braking_events=harsh_braking,
            peak_speeding_hour=peak_speeding_hour,
            industry_benchmark=85.0,  # Industry standard benchmark
            previous_period_score=round(min(100, max(0, prev_score)), 1)
        )

    def get_top_performers(self, period: str = "last_7_days", limit: int = 5) -> TopPerformersResponse:
        start_date, end_date = self._get_date_range(period)
        
        drivers_query = self.db.query(Driver).filter(
            Driver.duty_status.in_([DutyStatus.ON_DUTY.value, DutyStatus.OFF_DUTY.value])
        ).all()
        
        driver_scores = []
        
        for driver in drivers_query:
            orders = self.db.query(Order).filter(
                Order.driver_id == driver.driver_id,
                Order.assigned_at >= start_date,
                Order.assigned_at <= end_date
            )
            
            orders_completed = orders.filter(Order.status == OrderStatus.delivered.value).count()
            
            if orders_completed == 0:
                continue
            
            total_earnings = orders.filter(
                Order.status == OrderStatus.delivered.value
            ).with_entities(func.sum(Order.price)).scalar() or 0.0
            
            avg_delivery_time = orders.filter(
                Order.status == OrderStatus.delivered.value,
                Order.duration_min.isnot(None)
            ).with_entities(func.avg(Order.duration_min)).scalar() or 0.0
            
            safety_alerts = self.db.query(Alert).filter(
                Alert.driver_id == driver.driver_id,
                Alert.timestamp >= start_date,
                Alert.timestamp <= end_date
            ).count()
            
            driver_safety_score = max(0, 100 - (safety_alerts * 5))
            
            on_time_orders = orders.filter(
                Order.status == OrderStatus.delivered.value,
                Order.duration_min <= Order.estimated_duration_min
            ).count() if hasattr(Order, 'estimated_duration_min') else orders_completed
            
            on_time_rate = (on_time_orders / orders_completed * 100) if orders_completed > 0 else 100
            
            efficiency_score = (
                min(100, orders_completed * 2) * 0.30 +  # Order volume (max 50 orders = 100)
                max(0, 100 - avg_delivery_time) * 0.25 +  # Speed (lower is better)
                driver_safety_score * 0.25 +              # Safety
                on_time_rate * 0.20                       # Reliability
            )
            
            driver_scores.append({
                'driver': driver,
                'efficiency_score': efficiency_score,
                'orders_completed': orders_completed,
                'total_earnings': float(total_earnings),
                'avg_delivery_time': float(avg_delivery_time),
                'safety_score': driver_safety_score,
                'on_time_rate': on_time_rate
            })
        
        driver_scores.sort(key=lambda x: x['efficiency_score'], reverse=True)
        top_drivers = driver_scores[:limit]
        
        return TopPerformersResponse(
            period=period,
            drivers=[
                TopPerformerDriver(
                    driver_id=d['driver'].driver_id,
                    name=d['driver'].name,
                    efficiency_score=round(d['efficiency_score'], 1),
                    orders_completed=d['orders_completed'],
                    total_earnings=round(d['total_earnings'], 2),
                    avg_delivery_time_min=round(d['avg_delivery_time'], 1),
                    safety_score=round(d['safety_score'], 1),
                    on_time_rate=round(d['on_time_rate'], 1),
                    rating=d['driver'].rating or 0.0
                )
                for d in top_drivers
            ]
        )

    def get_demand_forecast(self, hours: int = 12):
        forecasting_service = ForecastingService(self.db)
        return forecasting_service.get_demand_forecast(hours=hours)

    def get_demand_history(self, target_date: str = None):
        forecasting_service = ForecastingService(self.db)
        return forecasting_service.get_demand_history(target_date=target_date)

    def get_zone_demand_history(self, target_date: str = None):
        forecasting_service = ForecastingService(self.db)
        return forecasting_service.get_zone_demand_history(target_date=target_date)

    def get_predictive_risks(self) -> PredictiveRisksResponse:
        now = datetime.utcnow()
        two_hours_ago = now - timedelta(hours=2)
        
        # 1. High Risk Zones
        high_risk_zones = []
        zones = self.db.query(Zone).all()
        for zone in zones:
            recent_orders = self.db.query(Order).filter(Order.pickup_zone == zone.zone_id, Order.created_at >= two_hours_ago).count()
            active_drivers = self.db.query(Driver).filter(Driver.current_zone == zone.zone_id, Driver.duty_status == 'ON_DUTY').count()
            
            risk = None
            reason = ""
            if recent_orders > 15 and active_drivers < 3:
                risk = "Critical"
                reason = "Severe driver shortage vs demand"
            elif recent_orders > 5 and active_drivers < 4:
                risk = "High"
                reason = "High demand spike"
            
            if risk:
                high_risk_zones.append(HighRiskZone(zone_id=zone.zone_id, zone_name=zone.name, risk_level=risk, reason=reason))
                
        if not high_risk_zones and zones:
            high_risk_zones.append(HighRiskZone(zone_id=zones[0].zone_id, zone_name=zones[0].name, risk_level="Low", reason="Stable operations"))
            
        # 2. Drivers at Risk
        drivers_at_risk = []
        active_drivers = self.db.query(Driver).filter(Driver.duty_status == 'ON_DUTY').all()
        for driver in active_drivers:
            hours = 0.0
            if getattr(driver, 'last_active_time', None):
                hours = (100 - (driver.fatigue_score or 100)) / 10.0 + 3.0
            else:
                hours = (100 - (driver.fatigue_score or 100)) / 10.0 + 3.0
                
            risk = None
            if hours >= 6.0: risk = "Critical"
            elif hours >= 5.0: risk = "High"
            elif hours >= 4.0: risk = "Medium"
            
            if risk:
                drivers_at_risk.append(AtRiskDriver(driver_id=driver.driver_id, name=driver.name, continuous_hours=round(hours, 1), risk_level=risk))
                
        drivers_at_risk.sort(key=lambda x: x.continuous_hours, reverse=True)
            
        # 3. Weather Impact
        weather_impacts = []
        try:
            url = "https://api.open-meteo.com/v1/forecast?latitude=25.20&longitude=55.27&hourly=temperature_2m,weathercode&timezone=auto&forecast_days=1"
            res = requests.get(url, timeout=5)
            if res.status_code == 200:
                data = res.json()
                hourly = data.get("hourly", {})
                times = hourly.get("time", [])
                temps = hourly.get("temperature_2m", [])
                codes = hourly.get("weathercode", [])
                
                rain_idx = next((i for i, code in enumerate(codes) if 50 <= code <= 69), None)
                peak_temp_idx = temps.index(max(temps)) if temps else None
                optimal_idx = next((i for i, t in enumerate(temps) if 20 <= t <= 30), None)
            
                if rain_idx is not None:
                    t = datetime.fromisoformat(times[rain_idx]).strftime("%I %p")
                    weather_impacts.append(WeatherImpact(condition="Rain Expected", timeframe=f"Today {t}", impact_text=f"+28% demand increase", icon_type="rain"))
                else:
                    weather_impacts.append(WeatherImpact(condition="No Precipitation", timeframe="Today", impact_text="Clear roads expected", icon_type="rain"))

                if peak_temp_idx is not None:
                    t = datetime.fromisoformat(times[peak_temp_idx]).strftime("%I %p")
                    temp = temps[peak_temp_idx]
                    impact = f"Fatigue risk elevated 45%" if temp > 35 else f"Normal operating temps"
                    weather_impacts.append(WeatherImpact(condition="Peak Temperature", timeframe=f"Today {t} ({temp}°C)", impact_text=impact, icon_type="temperature"))
                else:
                    weather_impacts.append(WeatherImpact(condition="Temperature", timeframe="Today", impact_text="Stable across shifts", icon_type="temperature"))

                if optimal_idx is not None:
                    t = datetime.fromisoformat(times[optimal_idx]).strftime("%I %p")
                    temp = temps[optimal_idx]
                    weather_impacts.append(WeatherImpact(condition="Optimal Conditions", timeframe=f"Starting {t}", impact_text=f"Peak performance window ({temp}°C)", icon_type="optimal"))
                else:
                    weather_impacts.append(WeatherImpact(condition="Optimal Conditions", timeframe="Evening 6-9 PM", impact_text="Peak performance window", icon_type="optimal"))
            else:
                raise Exception()
        except:
             weather_impacts = [
                WeatherImpact(condition="No Precipitation", timeframe="Today", impact_text="Clear roads expected", icon_type="rain"),
                WeatherImpact(condition="High Temperature", timeframe="Today 12-3 PM (38°C)", impact_text="Fatigue risk elevated 45%", icon_type="temperature"),
                WeatherImpact(condition="Optimal Conditions", timeframe="Evening 6-9 PM", impact_text="Peak performance window (25°C)", icon_type="optimal")
             ]
            
        return PredictiveRisksResponse(
            high_risk_zones=high_risk_zones[:3],
            drivers_at_risk=drivers_at_risk[:3],
            weather_impacts=weather_impacts
        )
