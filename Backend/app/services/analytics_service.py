from sqlalchemy.orm import Session
from sqlalchemy import func, and_, case, extract, text
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timedelta

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
    ReportType
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
        
        duration = end_date - start_date
        prev_end = start_date
        prev_start = prev_end - duration

        current = self._calculate_period_metrics(start_date, end_date)
        prev = self._calculate_period_metrics(prev_start, prev_end)
        

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
        orders_in_progress = self.db.query(Order).filter(Order.status.in_([OrderStatus.assigned.value, OrderStatus.picked_up.value, OrderStatus.in_transit.value])).count()
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
            drivers_busy=d_map.get(DriverStatus.BUSY.value, 0) + d_map.get(DriverStatus.ON_DELIVERY.value, 0),
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
        
        avg_delivery_time = orders.filter(
            Order.status == OrderStatus.delivered.value,
            Order.duration_min.isnot(None)
        ).with_entities(func.avg(Order.duration_min)).scalar()
        
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
        if old == 0: return 100.0 if new > 0 else 0.0
        return round(((new - old) / old) * 100, 2)

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
        elif period == "this_month":
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        else:
            start = now - timedelta(days=1)
        return start, now