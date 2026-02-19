from sqlalchemy.orm import Session
from sqlalchemy import func, and_, case, extract, text
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timedelta
import os
import pandas as pd

from app.models.analytics import DailyMetrics, ZoneMetrics, PerformanceReport, Demand
from app.models.order import Order
from app.models.driver import Driver
from app.models.alert import Alert
from app.models.zone import Zone

from app.schemas.alert import AlertSeverity
from app.schemas.driver import DriverStatus, DutyStatus
from app.schemas.order import OrderStatus
from app.schemas.analytics import (
    DashboardOverview, RealtimeMetrics, ZoneHeatmap,
    TrendData, ReportRequest, ReportResponse, PerformanceAnalysis,
    ReportType, AlertsSummaryResponse, AlertTypeSummary, AlertDaySummary,
    AlertZoneSummary, SafetyScoreResponse, TopPerformersResponse,
    TopPerformerDriver, DemandForecastResponse, DemandForecastPoint
)

import joblib
import pandas as pd
import os

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

    # ============================================
    # NEW AGGREGATED ANALYTICS METHODS
    # ============================================

    def get_alerts_summary(self, period: str = "last_7_days") -> AlertsSummaryResponse:
        """Get aggregated alerts summary for analytics dashboard"""
        start_date, end_date = self._get_date_range(period)
        
        # Total alerts in period
        total_alerts = self.db.query(Alert).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date
        ).count()
        
        # Group by alert type
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
        
        # Group by day of week
        by_day_query = self.db.query(
            func.to_char(Alert.timestamp, 'Dy').label('day_name'),
            func.count(Alert.alert_id).label('count')
        ).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date
        ).group_by(text('day_name')).all()
        
        # Ensure all days are represented
        day_counts = {row[0]: row[1] for row in by_day_query}
        days_order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        by_day = [
            AlertDaySummary(day=day, count=day_counts.get(day, 0))
            for day in days_order
        ]
        
        # Group by zone (using driver's current_zone)
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
        
        # Group by severity
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
        Calculate fleet-wide safety score based on multiple factors.
        
        Safety Score Formula:
        - Base score: 100
        - Deductions based on:
          - Critical incidents: -10 points each (max -40)
          - Fatigue alerts: -2 points each (max -20)
          - Speeding events: -1 point each (max -15)
          - Harsh braking: -0.5 points each (max -10)
          - Accidents: -15 points each (max -30)
        
        Component scores calculated separately for detailed breakdown.
        """
        start_date, end_date = self._get_date_range(period)
        
        # Get previous period for trend comparison
        duration = end_date - start_date
        prev_end = start_date
        prev_start = prev_end - duration
        
        # Count alerts by type for current period
        alert_counts = self.db.query(
            Alert.alert_type,
            func.count(Alert.alert_id).label('count')
        ).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date
        ).group_by(Alert.alert_type).all()
        
        alert_map = {row[0]: row[1] for row in alert_counts}
        
        # Extract specific alert counts
        fatigue_alerts = alert_map.get('fatigue', 0) + alert_map.get('fatigue_warning', 0)
        speeding_events = alert_map.get('speeding', 0) + alert_map.get('speed_violation', 0)
        harsh_braking = alert_map.get('harsh_braking', 0)
        accidents = alert_map.get('accident', 0)
        
        # Count by severity
        critical_query = self.db.query(func.count(Alert.alert_id)).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date,
            Alert.severity == 4  # CRITICAL
        ).scalar() or 0
        
        total_incidents = self.db.query(Alert).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date
        ).count()
        
        # Get total orders for accident rate calculation
        total_orders = self.db.query(Order).filter(
            Order.created_at >= start_date,
            Order.created_at <= end_date
        ).count()
        
        accident_rate = (accidents / total_orders * 100) if total_orders > 0 else 0.0
        
        # ============================================
        # SAFETY SCORE CALCULATION
        # ============================================
        
        # Component 1: Fatigue Score (25% weight)
        # Base 100, -5 per fatigue alert, min 0
        fatigue_score = max(0, 100 - (fatigue_alerts * 5))
        
        # Component 2: Incident Score (35% weight)
        # Base 100, weighted by severity
        incident_deduction = (
            (critical_query * 10) +  # Critical: -10 each
            (accidents * 15) +        # Accidents: -15 each
            (speeding_events * 2) +   # Speeding: -2 each
            (harsh_braking * 1)       # Harsh braking: -1 each
        )
        incident_score = max(0, 100 - min(incident_deduction, 100))
        
        # Component 3: Compliance Score (20% weight)
        # Based on acknowledged vs unacknowledged alerts
        unacknowledged = self.db.query(Alert).filter(
            Alert.timestamp >= start_date,
            Alert.timestamp <= end_date,
            Alert.acknowledged == False
        ).count()
        
        acknowledgment_rate = ((total_incidents - unacknowledged) / total_incidents * 100) if total_incidents > 0 else 100
        compliance_score = min(100, acknowledgment_rate)
        
        # Component 4: Behavior Score (20% weight)
        # Based on driving behavior patterns
        behavior_incidents = speeding_events + harsh_braking
        active_drivers = self.db.query(func.count(Driver.driver_id)).filter(
            Driver.duty_status == DutyStatus.ON_DUTY.value
        ).scalar() or 1
        
        incidents_per_driver = behavior_incidents / active_drivers
        behavior_score = max(0, 100 - (incidents_per_driver * 10))
        
        # Overall Safety Score (weighted average)
        overall_score = (
            fatigue_score * 0.25 +
            incident_score * 0.35 +
            compliance_score * 0.20 +
            behavior_score * 0.20
        )
        
        # Calculate grade
        if overall_score >= 95: grade = "A+"
        elif overall_score >= 90: grade = "A"
        elif overall_score >= 80: grade = "B"
        elif overall_score >= 70: grade = "C"
        elif overall_score >= 60: grade = "D"
        else: grade = "F"
        
        # Calculate trend from previous period
        prev_incidents = self.db.query(Alert).filter(
            Alert.timestamp >= prev_start,
            Alert.timestamp <= prev_end
        ).count()
        
        if prev_incidents > 0:
            trend_pct = ((prev_incidents - total_incidents) / prev_incidents) * 100
            # Cap trend percentage to reasonable bounds
            trend_pct = max(-100, min(100, trend_pct))
        else:
            trend_pct = 0 if total_incidents == 0 else -50  # Default to -50% if no prior data
        
        if trend_pct > 5:
            trend = "improving"
        elif trend_pct < -5:
            trend = "declining"
        else:
            trend = "stable"
        
        # Previous period score (simplified calculation)
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
            industry_benchmark=85.0,  # Industry standard benchmark
            previous_period_score=round(min(100, max(0, prev_score)), 1)
        )

    def get_top_performers(self, period: str = "last_7_days", limit: int = 5) -> TopPerformersResponse:
        """Get top performing drivers based on efficiency, safety, and reliability"""
        start_date, end_date = self._get_date_range(period)
        
        # Get all active drivers with their metrics
        drivers_query = self.db.query(Driver).filter(
            Driver.duty_status.in_([DutyStatus.ON_DUTY.value, DutyStatus.OFF_DUTY.value])
        ).all()
        
        driver_scores = []
        
        for driver in drivers_query:
            # Get order stats for this driver
            orders = self.db.query(Order).filter(
                Order.driver_id == driver.driver_id,
                Order.assigned_at >= start_date,
                Order.assigned_at <= end_date
            )
            
            orders_completed = orders.filter(Order.status == OrderStatus.delivered.value).count()
            
            # Skip drivers with no orders in period
            if orders_completed == 0:
                continue
            
            total_earnings = orders.filter(
                Order.status == OrderStatus.delivered.value
            ).with_entities(func.sum(Order.price)).scalar() or 0.0
            
            avg_delivery_time = orders.filter(
                Order.status == OrderStatus.delivered.value,
                Order.duration_min.isnot(None)
            ).with_entities(func.avg(Order.duration_min)).scalar() or 0.0
            
            # Safety score based on alerts
            safety_alerts = self.db.query(Alert).filter(
                Alert.driver_id == driver.driver_id,
                Alert.timestamp >= start_date,
                Alert.timestamp <= end_date
            ).count()
            
            driver_safety_score = max(0, 100 - (safety_alerts * 5))
            
            # On-time rate (orders delivered within estimated time)
            on_time_orders = orders.filter(
                Order.status == OrderStatus.delivered.value,
                Order.duration_min <= Order.estimated_duration_min
            ).count() if hasattr(Order, 'estimated_duration_min') else orders_completed
            
            on_time_rate = (on_time_orders / orders_completed * 100) if orders_completed > 0 else 100
            
            # Calculate efficiency score
            # Factors: orders completed, avg delivery time, safety, on-time rate
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
        
        # Sort by efficiency score and get top performers
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

    # ========================================
    # ML-POWERED DEMAND PREDICTION (OPTIMIZED)
    # ========================================
    #
    # Performance: pre-fetches ALL demand data in 1 SQL query, computes
    # features in-memory, and caches loaded models. Reduces ~2,880 DB
    # queries to 1-2 per endpoint call.

    # Class-level cache for loaded ML models (shared across requests)
    _ml_models_cache = {}   # {zone_id: DemandForecaster or None}
    _zones_cache = None
    _zones_cache_time = None

    @classmethod
    def _get_base_model_dir(cls):
        """Get absolute path to ml/models directory."""
        this_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(this_dir, '..', '..', 'ml', 'models')

    @staticmethod
    def clear_model_cache():
        """Clear the ML model cache to force reload from disk."""
        AnalyticsService._ml_models_cache = {}

    def _get_forecaster(self, zone_id: str):
        print(f"[DEBUG] Loading forecaster for zone: {zone_id}")
        """Load and cache DemandForecaster for a zone."""
        if zone_id in AnalyticsService._ml_models_cache:
            return AnalyticsService._ml_models_cache[zone_id]

        try:
            from ml.demand_models import DemandForecaster
            forecaster = DemandForecaster()
            model_dir = os.path.normpath(os.path.join(
                self._get_base_model_dir(), f'zone_{zone_id}'
            ))
            if not os.path.isdir(model_dir):
                print(f"[DEBUG] Model dir not found for zone {zone_id}: {model_dir}")
                AnalyticsService._ml_models_cache[zone_id] = None
                return None
            forecaster.load_models(model_dir)
            if not forecaster.models:
                print(f"[DEBUG] No models loaded for zone {zone_id} from {model_dir}")
                AnalyticsService._ml_models_cache[zone_id] = None
                return None
            print(f"[DEBUG] Loaded models for zone {zone_id}: {list(forecaster.models.keys())}")
            print(f"[DEBUG] Feature columns for zone {zone_id}: {getattr(forecaster, 'feature_columns', None)}")
            # Print feature importances for each model if available
            for model_name, model in forecaster.models.items():
                if hasattr(model, 'feature_importances_'):
                    print(f"[DEBUG] Feature importances for {model_name} in zone {zone_id}:")
                    for col, imp in zip(forecaster.feature_columns, model.feature_importances_):
                        print(f"    {col}: {imp:.4f}")
                elif hasattr(model, 'coef_'):
                    print(f"[DEBUG] Coefficients for {model_name} in zone {zone_id}:")
                    for col, coef in zip(forecaster.feature_columns, model.coef_):
                        print(f"    {col}: {coef:.4f}")
                else:
                    print(f"[DEBUG] No feature importances or coefficients for {model_name} in zone {zone_id}")
            AnalyticsService._ml_models_cache[zone_id] = forecaster
            return forecaster
        except Exception as e:
            print(f"[DEBUG] Exception loading forecaster for zone {zone_id}: {e}")
            AnalyticsService._ml_models_cache[zone_id] = None
            return None

    def _get_all_zones(self) -> list:
        """Get all zone IDs (cached for 60s)."""
        now = datetime.utcnow()
        if (AnalyticsService._zones_cache is not None and
                AnalyticsService._zones_cache_time and
                (now - AnalyticsService._zones_cache_time).seconds < 60):
            return AnalyticsService._zones_cache
        zones = [z[0] for z in self.db.query(Zone.zone_id).all()]
        AnalyticsService._zones_cache = zones
        AnalyticsService._zones_cache_time = now
        return zones

    def _prefetch_demand_data(self, zones: list, start_utc: datetime, end_utc: datetime) -> dict:
        """
        Pre-fetch ALL order counts by (zone, hour_bucket) in ONE query.
        Returns: {zone_id: {hour_bucket_datetime: count}}
        """
        import numpy as np
        results = self.db.query(
            Order.pickup_zone,
            func.date_trunc('hour', Order.created_at).label('hour_bucket'),
            func.count(Order.order_id).label('cnt')
        ).filter(
            Order.pickup_zone.in_(zones),
            Order.created_at >= start_utc,
            Order.created_at < end_utc
        ).group_by(
            Order.pickup_zone,
            func.date_trunc('hour', Order.created_at)
        ).all()

        data = {}
        for zone_id, hour_bucket, cnt in results:
            if zone_id not in data:
                data[zone_id] = {}
            data[zone_id][hour_bucket] = cnt
        return data

    def _build_features_fast(self, forecast_time: datetime, zone_demand: dict) -> dict:
        """
        Build ML features entirely in-memory (no DB queries).
        zone_demand: {hour_bucket_datetime: count} for one specific zone.
        """
        import numpy as np
        f = {}

        # Time features
        # Convert UTC forecast_time to Dubai Local Time (+4)
        local_time = forecast_time + timedelta(hours=4)

        f['hour'] = local_time.hour
        f['day_of_week'] = local_time.weekday()
        f['day_of_month'] = local_time.day
        f['week_of_year'] = local_time.isocalendar()[1]
        f['month'] = local_time.month
        f['quarter'] = (local_time.month - 1) // 3 + 1
        f['year'] = local_time.year
        f['is_weekend'] = 1 if local_time.weekday() >= 5 else 0
        f['is_breakfast'] = 1 if 7 <= local_time.hour < 11 else 0
        f['is_lunch'] = 1 if 12 <= local_time.hour < 15 else 0
        f['is_dinner'] = 1 if 18 <= local_time.hour < 21 else 0
        f['is_late_night'] = 1 if local_time.hour >= 22 or local_time.hour < 3 else 0
        f['is_workday'] = 1 if local_time.weekday() < 5 else 0

        # Cyclical features
        f['hour_sin'] = np.sin(2 * np.pi * f['hour'] / 24)
        f['hour_cos'] = np.cos(2 * np.pi * f['hour'] / 24)
        f['dow_sin'] = np.sin(2 * np.pi * f['day_of_week'] / 7)
        f['dow_cos'] = np.cos(2 * np.pi * f['day_of_week'] / 7)
        f['dom_sin'] = np.sin(2 * np.pi * f['day_of_month'] / 30)
        f['dom_cos'] = np.cos(2 * np.pi * f['day_of_month'] / 30)
        f['woy_sin'] = np.sin(2 * np.pi * f['week_of_year'] / 52)
        f['woy_cos'] = np.cos(2 * np.pi * f['week_of_year'] / 52)
        f['month_sin'] = np.sin(2 * np.pi * f['month'] / 12)
        f['month_cos'] = np.cos(2 * np.pi * f['month'] / 12)
        f['quarter_sin'] = np.sin(2 * np.pi * f['quarter'] / 4)
        f['quarter_cos'] = np.cos(2 * np.pi * f['quarter'] / 4)
        f['year_sin'] = np.sin(2 * np.pi * f['year'] / 100)
        f['year_cos'] = np.cos(2 * np.pi * f['year'] / 100)

        # Lag features from pre-fetched data
        ft_truncated = forecast_time.replace(minute=0, second=0, microsecond=0)
        for lag in [1, 2, 3, 6, 12, 24, 48, 168]:
            lag_time = ft_truncated - timedelta(hours=lag)
            f[f'demand_lag_{lag}'] = float(zone_demand.get(lag_time, 0))

        # Rolling features from pre-fetched data
        for window in [3, 6, 12, 24]:
            values = []
            for h in range(1, window + 1):
                t = ft_truncated - timedelta(hours=h)
                values.append(zone_demand.get(t, 0))
            f[f'demand_rolling_mean_{window}'] = float(np.mean(values)) if values else 0.0
            f[f'demand_rolling_std_{window}'] = float(np.std(values)) if len(values) > 1 else 0.0
            f[f'demand_rolling_min_{window}'] = float(min(values)) if values else 0.0
            f[f'demand_rolling_max_{window}'] = float(max(values)) if values else 0.0

        # cv = std / (mean + 1)
        mean_24 = f.get('demand_rolling_mean_24', 0.0)
        std_24 = f.get('demand_rolling_std_24', 0.0)
        f['demand_cv'] = std_24 / (mean_24 + 1)

        # Derived features
        f['weekend_dinner'] = f['is_weekend'] * f['is_dinner']
        f['workday_lunch'] = f['is_workday'] * f['is_lunch']
        if 'demand_lag_1' in f and 'demand_lag_2' in f:
            f['demand_momentum'] = f['demand_lag_1'] - f['demand_lag_2']

        # Defaults for price/distance/duration columns
        f['price'] = 0.0
        f['distance_km'] = 0.0
        f['duration_min'] = 0.0

        print(f"[DEBUG] Features for forecast_time {forecast_time}: {f}")
        return f

    def _batch_predict_all_zones(
        self, zones: list, forecast_times_utc: list, demand_data: dict
    ) -> dict:
        """
        Run ML predictions for all zones × all forecast hours using BATCH inference.
        Builds 1 DataFrame per zone (N rows = N forecast times), runs prediction once.
        Returns: {zone_id: [(predicted, confidence), ...]}
        """
        import numpy as np
        n = len(forecast_times_utc)
        results = {}

        for zone_id in zones:
            forecaster = self._get_forecaster(zone_id)
            if forecaster is None:
                print(f"[DEBUG] No forecaster for zone {zone_id}, predictions will be zero.")
                results[zone_id] = [(0.0, 0.0)] * n
                continue

            zone_demand = demand_data.get(zone_id, {})

            try:
                # Build all feature rows at once
                feature_rows = [self._build_features_fast(ft, zone_demand) for ft in forecast_times_utc]
                features_df = pd.DataFrame(feature_rows)

                # Align columns
                for col in forecaster.feature_columns:
                    if col not in features_df.columns:
                        features_df[col] = 0
                features_df = features_df[forecaster.feature_columns]
                
                # print(f"[DEBUG] Predicting for zone {zone_id} with features shape {features_df.shape}")
                preds, confs = forecaster.predict_ensemble_batch(features_df)
                # print(f"[DEBUG] Predictions for zone {zone_id}: {preds}")
                results[zone_id] = [(max(0, float(p)), float(c)) for p, c in zip(preds, confs)]
            except Exception as e:
                print(f"[DEBUG] Exception during prediction for zone {zone_id}: {e}")
                results[zone_id] = [(0.0, 0.0)] * n

        return results

    def _compute_calibration_factor(
        self, zone_preds: dict, actual_map: dict,
        zones: list, local_now_hour: int, is_today: bool
    ) -> float:
        """
        Compute scaling factor by comparing ML predictions to actual orders
        for ALL completed hours with data (not just last 3).
        Now calibrates for all dates, not just today.
        Returns factor clamped to [0.5, 4.0].
        """
        # For today, only use completed hours; for past days, use all 24
        if is_today and local_now_hour < 1:
            print(f"[DEBUG] Calibration: not enough hours for today, factor=1.0")
            return 1.0

        total_actual = 0
        total_predicted = 0.0
        hours_with_data = 0

        if is_today:
            hour_range = range(0, local_now_hour)
        else:
            hour_range = range(0, 24)

        for h in hour_range:
            actual = actual_map.get(h, 0)
            if actual == 0:
                continue
            predicted = sum(zone_preds.get(z, [(0, 0)] * 24)[h][0] for z in zones)
            if predicted <= 0:
                continue
            total_actual += actual
            total_predicted += predicted
            hours_with_data += 1

        if hours_with_data < 2:
            print(f"[DEBUG] Calibration: not enough data (hours_with_data={hours_with_data}), factor=1.0")
            return 1.0
        
        # If total predicted is very low, don't calibrate (avoid division by zero or huge factors)
        if total_predicted < 5.0:
             return 1.0

        factor = total_actual / total_predicted
        print(f"[DEBUG] Calibration: total_actual={total_actual}, total_predicted={total_predicted}, factor={factor}")
        
        # If actual is 0 and predicted is high (e.g. midnight spike), the factor will be 0.0.
        # We must clamp it, but allow it to go low to suppress the spike.
        # INCREASED CAP: Sparse data causes 8x underprediction. Allow scale up to 10.0.
        return max(0.1, min(10.0, factor))

    def _apply_calibration(
        self, zone_preds: dict, factor: float
    ) -> dict:
        """Scale all predictions by the given calibration factor."""
        if abs(factor - 1.0) < 0.01:
            print(f"[DEBUG] Calibration factor ~1.0, no scaling applied.")
            return zone_preds
        print(f"[DEBUG] Applying calibration factor {factor} to all predictions.")
        calibrated = {}
        for zone_id, preds in zone_preds.items():
            calibrated[zone_id] = [
                (round(p * factor, 2), c) for p, c in preds
            ]
            print(f"[DEBUG] Calibrated predictions for zone {zone_id}: {calibrated[zone_id]}")
        return calibrated

    # ========================================
    # DEMAND FORECAST (Next N hours)
    # ========================================

    def get_demand_forecast(self, hours: int = 12) -> DemandForecastResponse:
        """
        Get demand forecast for the next N hours using ML models.
        Uses batch prediction for fast response.
        """
        now = datetime.utcnow()
        current_hour = now.hour
        hour_start = now.replace(minute=0, second=0, microsecond=0)

        # Current hour's actual orders
        current_hour_orders = self.db.query(Order).filter(
            Order.created_at >= hour_start,
            Order.created_at < hour_start + timedelta(hours=1)
        ).count()

        total_active_orders = self.db.query(Order).filter(
            Order.status.in_([OrderStatus.pending.value, OrderStatus.assigned.value, OrderStatus.picked_up.value])
        ).count()

        zones = self._get_all_zones()

        # Build forecast times in UTC
        forecast_times = [hour_start + timedelta(hours=i) for i in range(hours + 1)]

        # Pre-fetch demand data for lag/rolling features (need up to 168h back)
        data_start = hour_start - timedelta(hours=170)
        data_end = hour_start + timedelta(hours=hours + 1)
        demand_data = self._prefetch_demand_data(zones, data_start, data_end)

        # Batch predict + calibrate
        zone_preds = self._batch_predict_all_zones(zones, forecast_times, demand_data)

        # Calibrate: fetch today's completed hours actuals for comparison
        local_now_hour = (now.hour + 4) % 24
        today_dubai = (now + timedelta(hours=4)).date()
        today_start_utc = datetime(today_dubai.year, today_dubai.month, today_dubai.day, 0, 0, 0) - timedelta(hours=4)
        today_end_utc = today_start_utc + timedelta(hours=24)
        cal_actual = self.db.query(
            extract('hour', Order.created_at + text("interval '4 hours'")).label('local_hour'),
            func.count(Order.order_id).label('count')
        ).filter(
            Order.created_at >= today_start_utc,
            Order.created_at < today_end_utc
        ).group_by(text('local_hour')).all()
        cal_map = {int(row[0]): row[1] for row in cal_actual}

        # Build a mapping from forecast index to local hour for calibration
        # We need zone_preds indexed by local_hour for the calibration function
        # Remap zone_preds to local_hour indices for calibration
        forecast_local_hours = [(ft.hour + 4) % 24 for ft in forecast_times]
        zone_preds_by_local = {}
        for z in zones:
            preds_list = zone_preds.get(z, [(0, 0)] * len(forecast_times))
            by_hour = [(0, 0)] * 24
            for idx, lh in enumerate(forecast_local_hours):
                if idx < len(preds_list):
                    by_hour[lh] = preds_list[idx]
            zone_preds_by_local[z] = by_hour

        cal_factor = self._compute_calibration_factor(
            zone_preds_by_local, cal_map, zones, local_now_hour, True
        )
        zone_preds = self._apply_calibration(zone_preds, cal_factor)

        # Aggregate city-wide totals per hour
        forecasts = []
        peak_hour = current_hour
        peak_demand = 0.0

        for i, ft in enumerate(forecast_times):
            forecast_hour_utc = ft.hour
            local_hour = (forecast_hour_utc + 4) % 24
            hour_label = f"{local_hour:02d}:00"

            # Sum predictions across zones
            total_pred = sum(zone_preds.get(z, [(0, 0)] * (hours + 1))[i][0] for z in zones)
            avg_conf = (sum(zone_preds.get(z, [(0, 0)] * (hours + 1))[i][1] for z in zones)
                        / len(zones)) if zones else 0.0

            predicted = round(total_pred, 0)
            confidence = round(avg_conf, 2)

            if i == 0:
                actual = current_hour_orders
                if predicted == 0:
                    predicted = float(current_hour_orders)
            else:
                actual = None

            forecasts.append(DemandForecastPoint(
                hour=hour_label,
                actual=actual,
                predicted=predicted,
                confidence=confidence
            ))

            if predicted > peak_demand:
                peak_demand = predicted
                peak_hour = forecast_hour_utc

        peak_local = (peak_hour + 4) % 24

        recommendations = []
        if peak_demand > current_hour_orders * 1.5 and peak_demand > 3:
            recommendations.append(
                f"Demand expected to peak at {peak_local:02d}:00 with ~{int(peak_demand)} orders. "
                f"Consider deploying additional drivers."
            )
        available_drivers = self.db.query(Driver).filter(
            Driver.status == DriverStatus.AVAILABLE.value
        ).count()
        if peak_demand > available_drivers * 5:
            shortage = int((peak_demand / 5) - available_drivers)
            if shortage > 0:
                recommendations.append(
                    f"Driver shortage expected. Need approximately {shortage} more drivers for peak demand."
                )

        return DemandForecastResponse(
            generated_at=now,
            forecast_hours=hours,
            current_demand=total_active_orders,
            peak_predicted_hour=f"{peak_local:02d}:00",
            peak_predicted_demand=round(peak_demand, 0),
            forecasts=forecasts,
            recommendations=recommendations
        )

    # ========================================
    # DEMAND HISTORY (24h for a specific date) — City-wide
    # ========================================

    def get_demand_history(self, target_date: str = None) -> dict:
        """
        Get hourly actual vs ML-predicted demand for a specific date (city-wide).
        Optimized: 1 bulk query for features, in-memory computation.
        """
        now = datetime.utcnow()
        local_now_hour = (now.hour + 4) % 24

        if target_date:
            from datetime import date as date_type
            parts = target_date.split('-')
            target = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
        else:
            dubai_now = now + timedelta(hours=4)
            target = dubai_now.date()

        today_dubai = (now + timedelta(hours=4)).date()
        is_today = (target == today_dubai)

        target_start_utc = datetime(target.year, target.month, target.day, 0, 0, 0) - timedelta(hours=4)
        target_end_utc = target_start_utc + timedelta(hours=24)

        # Get actual hourly counts
        hourly_actual = self.db.query(
            extract('hour', Order.created_at + text("interval '4 hours'")).label('local_hour'),
            func.count(Order.order_id).label('count')
        ).filter(
            Order.created_at >= target_start_utc,
            Order.created_at < target_end_utc
        ).group_by(text('local_hour')).all()
        actual_map = {int(row[0]): row[1] for row in hourly_actual}

        zones = self._get_all_zones()

        # Build 24 forecast times in UTC
        forecast_times = []
        for h in range(24):
            utc_hour = (h - 4) % 24
            ft = datetime(target.year, target.month, target.day, utc_hour, 0, 0)
            if h < 4:
                ft = ft - timedelta(days=1)
            forecast_times.append(ft)


        # Pre-fetch demand data (170h before earliest forecast to cover lags)
        data_start = min(forecast_times) - timedelta(hours=170)
        data_end = max(forecast_times) + timedelta(hours=1)
        demand_data = self._prefetch_demand_data(zones, data_start, data_end)

        # Batch predict all zones × 24 hours + calibrate
        zone_preds = self._batch_predict_all_zones(zones, forecast_times, demand_data)
        cal_factor = self._compute_calibration_factor(
            zone_preds, actual_map, zones, local_now_hour, is_today
        )
        zone_preds = self._apply_calibration(zone_preds, cal_factor)

        data = []
        total_actual = 0
        total_predicted = 0.0

        for h in range(24):
            hour_label = f"{h:02d}:00"

            # Sum zone predictions for city-wide total
            raw_sum = 0
            for z in zones:
                p = zone_preds.get(z, [(0, 0)] * 24)[h][0]
                # FILTER CHANGE: Removed per-zone noise gate (p < 0.5) because it was killing
                # valid low-volume signals during morning ramp-up (e.g. 0.4 * 10 zones = 4 orders).
                raw_sum += p
            
            predicted_val = raw_sum

            # --- Layer 2: Time-of-Day Dampening (The "Midnight Fix") ---
            # If strictly off-peak (00:00 - 05:00), demand should be minimal.
            # We assume high predictions here are "phantom" noise from the model.
            if h < 5:
                # If sum is significant, crush it.
                if predicted_val > 1.0:
                    predicted_val *= 0.15 
            
            # --- Layer 3: Calibration Safety (prevent < 0) ---
            predicted = max(0.0, round(predicted_val, 0))

            if is_today:
                actual = actual_map.get(h, 0) if h <= local_now_hour else None
            else:
                actual = actual_map.get(h, 0)

            print(f"[DEBUG] Hour {hour_label}: actual={actual}, predicted={predicted}")

            if actual is not None:
                total_actual += actual
            total_predicted += predicted

            data.append({"hour": hour_label, "actual": actual, "predicted": predicted})

        return {
            "date": target.isoformat(),
            "date_label": target.strftime("%b %d, %Y"),
            "is_today": is_today,
            "current_hour": local_now_hour if is_today else None,
            "data": data,
            "total_actual": total_actual,
            "total_predicted": total_predicted
        }

    # ========================================
    # ZONE-WISE DEMAND HISTORY
    # ========================================

    def get_zone_demand_history(self, target_date: str = None) -> dict:
        """
        Get hourly actual vs ML-predicted demand per zone.
        Optimized: 1 bulk query + batch prediction.
        """
        now = datetime.utcnow()
        local_now_hour = (now.hour + 4) % 24

        if target_date:
            from datetime import date as date_type
            parts = target_date.split('-')
            target = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
        else:
            dubai_now = now + timedelta(hours=4)
            target = dubai_now.date()

        today_dubai = (now + timedelta(hours=4)).date()
        is_today = (target == today_dubai)

        target_start_utc = datetime(target.year, target.month, target.day, 0, 0, 0) - timedelta(hours=4)
        target_end_utc = target_start_utc + timedelta(hours=24)

        zones = self._get_all_zones()

        # Actual counts per zone per hour (1 query)
        hourly_actual_by_zone = self.db.query(
            Order.pickup_zone,
            extract('hour', Order.created_at + text("interval '4 hours'")).label('local_hour'),
            func.count(Order.order_id).label('count')
        ).filter(
            Order.created_at >= target_start_utc,
            Order.created_at < target_end_utc
        ).group_by(Order.pickup_zone, text('local_hour')).all()

        zone_actual_map = {}
        for row in hourly_actual_by_zone:
            zone_actual_map.setdefault(row[0], {})[int(row[1])] = row[2]

        # Build 24 forecast times in UTC
        forecast_times = []
        for h in range(24):
            utc_hour = (h - 4) % 24
            ft = datetime(target.year, target.month, target.day, utc_hour, 0, 0)
            if h < 4:
                ft = ft - timedelta(days=1)
            forecast_times.append(ft)

        # Pre-fetch demand data + batch predict
        data_start = min(forecast_times) - timedelta(hours=170)
        data_end = max(forecast_times) + timedelta(hours=1)
        demand_data = self._prefetch_demand_data(zones, data_start, data_end)
        zone_preds = self._batch_predict_all_zones(zones, forecast_times, demand_data)

        # Build combined actual map for calibration
        combined_actual_map = {}
        for zone_id, hours in zone_actual_map.items():
            for h, cnt in hours.items():
                combined_actual_map[h] = combined_actual_map.get(h, 0) + cnt
        cal_factor = self._compute_calibration_factor(
            zone_preds, combined_actual_map, zones, local_now_hour, is_today
        )
        zone_preds = self._apply_calibration(zone_preds, cal_factor)

        zone_data = []
        for zone_id in zones:
            actual_map = zone_actual_map.get(zone_id, {})
            zone_name = zone_id.replace('zone_', '').replace('_', ' ').title()
            preds = zone_preds.get(zone_id, [(0, 0)] * 24)

            hourly_data = []
            zone_total_actual = 0
            zone_total_predicted = 0.0

            for h in range(24):
                hour_label = f"{h:02d}:00"
                predicted = round(preds[h][0], 0)

                if is_today:
                    actual = actual_map.get(h, 0) if h <= local_now_hour else None
                else:
                    actual = actual_map.get(h, 0)

                if actual is not None:
                    zone_total_actual += actual
                zone_total_predicted += predicted

                hourly_data.append({"hour": hour_label, "actual": actual, "predicted": predicted})

            zone_data.append({
                "zone_id": zone_id,
                "zone_name": zone_name,
                "data": hourly_data,
                "total_actual": zone_total_actual,
                "total_predicted": zone_total_predicted
            })

        return {
            "date": target.isoformat(),
            "date_label": target.strftime("%b %d, %Y"),
            "is_today": is_today,
            "current_hour": local_now_hour if is_today else None,
            "zones": zone_data
        }

