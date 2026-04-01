from sqlalchemy.orm import Session
from sqlalchemy import func, and_, case, extract, text
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import pandas as pd
import numpy as np
import os

from app.models.zone import Zone, DemandForecast, DemandPattern

from app.models.order import Order
from app.models.driver import Driver
from app.schemas.driver import DriverStatus
from app.schemas.order import OrderStatus
from app.schemas.analytics import DemandForecastResponse, DemandForecastPoint
from app.services.genai_service import GenAIService
from ml.feature_engineering import FeatureEngineer
from ml.demand_models import DemandForecaster

class ForecastingService:
    _ml_models_cache = {}
    _zones_cache = None
    _zones_cache_time = None

    def __init__(self, db: Session):
        self.db = db
        self.feature_engineer = FeatureEngineer(db)
        self.ml_forecaster = DemandForecaster()

        try:
            self.ml_forecaster.load_models()
        except Exception as e:
            print(f"Warning: Could not load ML models: {e}")
    
    def train_zone_models(
        self,
        zone_id: str,
        days_history: int = 60
    ) -> Dict[str, Any]:

        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days_history)

        df = self.feature_engineer.create_training_dataset(
            zone_id=zone_id,
            start_date=start_date,
            end_date=end_date,
            aggregation="hourly"
        )

        if df.empty or len(df) < 100:
            return {'error': 'Not enough data to train models'}
        
        scores = self.ml_forecaster.train_ensemble(df)

        self.ml_forecaster.save_models(f'ml/models/zone_{zone_id}')
        self._learn_demand_patterns(zone_id, df)

        self.clear_model_cache()

        return {
            "zone_id": zone_id,
            "samples": len(df),
            "features": len(df.columns),
            "scores": scores,
            "status": "trained"
        }
    
    def _learn_demand_patterns(self, zone_id: str, df: pd.DataFrame):
        self.db.query(DemandPattern).filter(
            DemandPattern.zone_id == zone_id
        ).delete()
        
        hourly_stats = df.groupby('hour')['demand'].agg(['mean', 'std', 'max', 'min', 'count'])

        for hour, stats in hourly_stats.iterrows():
            pattern = DemandPattern(
                zone_id=zone_id,
                pattern_type="hourly",
                hour_of_day=int(hour),
                avg_demand=float(stats['mean']),
                std_demand=float(stats['std']),
                peak_demand=float(stats['max']),
                min_demand=float(stats['min']),
                sample_size=int(stats['count']),
                last_updated=datetime.utcnow()
            )
            self.db.add(pattern)

        dow_stats = df.groupby('day_of_week')['demand'].agg(['mean', 'std', 'max', 'min', 'count'])
        
        for dow, stats in dow_stats.iterrows():
            pattern = DemandPattern(
                zone_id=zone_id,
                pattern_type="daily",
                day_of_week=int(dow),
                avg_demand=float(stats['mean']),
                std_demand=float(stats['std']),
                peak_demand=float(stats['max']),
                min_demand=float(stats['min']),
                sample_size=int(stats['count']),
                last_updated=datetime.utcnow()
            )
            self.db.add(pattern)
        
        self.db.commit()
    
    def generate_forecast(
        self,
        zone_id: Optional[str] = None,
        horizon_minutes: int = 60,
        method: str = "ensemble"
    ) -> List[DemandForecast]:
        zones = [zone_id] if zone_id else [z.zone_id for z in self.db.query(Zone).all()]
        
        forecasts = []
        current_time = datetime.utcnow()
        
        for zid in zones:
            zone_model_path = f'ml/models/zone_{zid}'
            self.ml_forecaster.load_models(zone_model_path)

            for minutes_ahead in [15, 30, 60]:
                if minutes_ahead > horizon_minutes:
                    break

                forecast_time = current_time + timedelta(minutes=minutes_ahead)
                features_dict = self.feature_engineer.create_prediction_features(zid, forecast_time)
                features_df = pd.DataFrame([features_dict])
                
                for col in self.ml_forecaster.feature_columns:
                    if col not in features_df.columns:
                        features_df[col] = 0
                
                features_df = features_df[self.ml_forecaster.feature_columns]

                
                if method == "ensemble" or method == "ml_only":
                    final_pred, confidence = self.ml_forecaster.predict_ensemble(features_df)
                    model_used = "ml_ensemble"
                else:
                    final_pred, confidence = self.ml_forecaster.predict_ensemble(features_df)
                    model_used = "ml_ensemble"
                
                demand_score = min(1.0, final_pred / 2.0)

                if demand_score >= 0.9:
                    alert_level = "critical"
                elif demand_score >= 0.7:
                    alert_level = "high"
                elif demand_score >= 0.5:
                    alert_level = "elevated"
                else:
                    alert_level = "normal"
                    
                forecast = DemandForecast(
                    zone_id=zid,
                    forecast_time=forecast_time,
                    forecast_horizon=minutes_ahead,
                    predicted_demand=round(final_pred, 2),
                    demand_score=round(demand_score, 3),
                    confidence=round(confidence, 3),
                    model_used=model_used,
                    model_version="v2.0",
                    threshold_exceeded=(demand_score > 0.8),
                    alert_level=alert_level,
                    features=features_dict,
                    created_at=current_time
                )
                
                self.db.add(forecast)
                forecasts.append(forecast)
        
        self.db.commit()
        return forecasts
    
    def update_live_demand(self, zone_id: str) -> Dict[str, Any]:
        zone = self.db.query(Zone).filter(Zone.zone_id == zone_id).first()
        if not zone:
            return {"error": "Zone not found"}
        
        window_start = datetime.utcnow() - timedelta(minutes=15)
        recent_orders = self.db.query(Order).filter(
            Order.pickup_zone == zone_id,
            Order.created_at >= window_start
        ).count()

        pending = self.db.query(Order).filter(
            Order.pickup_zone == zone_id,
            Order.status == "pending"
        ).count()
        
        latest_forecast = self.db.query(DemandForecast).filter(
            DemandForecast.zone_id == zone_id,
            DemandForecast.forecast_time >= datetime.utcnow()
        ).order_by(DemandForecast.forecast_time).first()
        
        predicted_demand = latest_forecast.predicted_demand if latest_forecast else 10.0

        blended_demand = (predicted_demand * 0.4) + (recent_orders * 4 * 0.6)

        zone.demand_score = min(1.0, blended_demand / 2.0)
        zone.pending_orders = pending

        self.db.commit()

        return {
            "zone_id": zone_id,
            "demand_score": round(zone.demand_score, 3),
            "recent_orders_15min": recent_orders,
            "pending_orders": pending,
            "predicted_demand": round(predicted_demand, 2)
        }

    def get_demand_patterns(self, zone_id: str) -> Dict[str, Any]:        
        patterns = self.db.query(DemandPattern).filter(DemandPattern.zone_id == zone_id).all()
        
        hourly = {}
        daily = {}

        for p in patterns:
            if p.pattern_type == "hourly":
                hourly[p.hour_of_day] = {
                    'avg': p.avg_demand,
                    'peak': p.peak_demand,
                    'std': p.std_demand
                }
            elif p.pattern_type == "daily":
                daily[p.day_of_week] = {
                    'avg': p.avg_demand,
                    'peak': p.peak_demand
                }
        
        return {
            "zone_id": zone_id,
            "hourly_patterns": hourly,
            "daily_patterns": daily
        }

    @classmethod
    def _get_base_model_dir(cls):
        this_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(this_dir, '..', '..', 'ml', 'models')

    @classmethod
    def clear_model_cache(cls):
        cls._ml_models_cache = {}

    def _get_forecaster(self, zone_id: str) -> Optional[DemandForecaster]:
        if zone_id in self._ml_models_cache:
            return self._ml_models_cache[zone_id]

        model_dir = self._get_base_model_dir()
        zone_model_path = os.path.join(model_dir, f'zone_{zone_id}')

        if os.path.exists(zone_model_path):
            try:
                forecaster = DemandForecaster()
                forecaster.load_models(zone_model_path)
                self._ml_models_cache[zone_id] = forecaster
                return forecaster
            except Exception as e:
                print(f"[DEBUG] Failed to load model for {zone_id}: {e}")
        
        self._ml_models_cache[zone_id] = None
        return None

    def _get_all_zones(self) -> List[str]:
        now = datetime.utcnow()
        if self._zones_cache and self._zones_cache_time and (now - self._zones_cache_time).total_seconds() < 60:
            return self._zones_cache
        
        zones = [z.zone_id for z in self.db.query(Zone).all()]
        self._zones_cache = zones
        self._zones_cache_time = now
        return zones

    def _prefetch_demand_data(self, zones: list, start_utc: datetime, end_utc: datetime) -> dict:
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
            data[zone_id][hour_bucket.replace(tzinfo=None)] = cnt
        return data

    def _build_features_fast(self, forecast_time: datetime, zone_demand: dict) -> dict:
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

        ft_truncated = forecast_time.replace(minute=0, second=0, microsecond=0)
        for lag in [1, 2, 3, 6, 12, 24, 48, 168]:
            lag_time = ft_truncated - timedelta(hours=lag)
            f[f'demand_lag_{lag}'] = float(zone_demand.get(lag_time, 0))

        for window in [3, 6, 12, 24]:
            values = []
            for h in range(1, window + 1):
                t = ft_truncated - timedelta(hours=h)
                values.append(zone_demand.get(t, 0))
            f[f'demand_rolling_mean_{window}'] = float(np.mean(values)) if values else 0.0
            f[f'demand_rolling_std_{window}'] = float(np.std(values)) if len(values) > 1 else 0.0
            f[f'demand_rolling_min_{window}'] = float(min(values)) if values else 0.0
            f[f'demand_rolling_max_{window}'] = float(max(values)) if values else 0.0

        mean_24 = f.get('demand_rolling_mean_24', 0.0)
        std_24 = f.get('demand_rolling_std_24', 0.0)
        f['demand_cv'] = std_24 / (mean_24 + 1)

        f['weekend_dinner'] = f['is_weekend'] * f['is_dinner']
        f['workday_lunch'] = f['is_workday'] * f['is_lunch']
        if 'demand_lag_1' in f and 'demand_lag_2' in f:
            f['demand_momentum'] = f['demand_lag_1'] - f['demand_lag_2']

        f['price'] = 0.0
        f['distance_km'] = 0.0
        f['duration_min'] = 0.0

        return f

    def _batch_predict_all_zones(
        self, zones: list, forecast_times_utc: list, demand_data: dict
    ) -> dict:
        n = len(forecast_times_utc)
        results = {}
        
        now_utc = datetime.utcnow()
        now_utc_truncated = now_utc.replace(minute=0, second=0, microsecond=0)

        for zone_id in zones:
            forecaster = self._get_forecaster(zone_id)
            if forecaster is None:
                results[zone_id] = [(0.0, 0.0)] * n
                continue

            zone_demand = dict(demand_data.get(zone_id, {}))
            preds_list = []

            # Split into robust batch processing for the past, and sequential for the future
            past_fts = []
            future_fts = []
            for ft in forecast_times_utc:
                if ft.replace(minute=0, second=0, microsecond=0) < now_utc_truncated:
                    past_fts.append(ft)
                else:
                    future_fts.append(ft)

            try:
                # 1. High-performance batch prediction for historical data
                if past_fts:
                    feature_rows = [self._build_features_fast(ft, zone_demand) for ft in past_fts]
                    features_df = pd.DataFrame(feature_rows)
                    for col in forecaster.feature_columns:
                        if col not in features_df.columns:
                            features_df[col] = 0
                    features_df = features_df[forecaster.feature_columns]
                    
                    p_arr, c_arr = forecaster.predict_ensemble_batch(features_df)
                    for p, c in zip(p_arr, c_arr):
                        preds_list.append((max(0, float(p)), float(c)))

                # 2. Auto-regressive sequential prediction for future data
                for ft in future_fts:
                    f = self._build_features_fast(ft, zone_demand)
                    features_df = pd.DataFrame([f])

                    for col in forecaster.feature_columns:
                        if col not in features_df.columns:
                            features_df[col] = 0
                    features_df = features_df[forecaster.feature_columns]
                    
                    p_arr, c_arr = forecaster.predict_ensemble_batch(features_df)
                    pred_val = max(0, float(p_arr[0]))
                    conf_val = float(c_arr[0])
                    
                    preds_list.append((pred_val, conf_val))
                    
                    # Cascade prediction back for auto-regressive lags in the future
                    ft_truncated = ft.replace(minute=0, second=0, microsecond=0)
                    if ft_truncated >= now_utc_truncated or ft_truncated not in zone_demand:
                        zone_demand[ft_truncated] = pred_val

                results[zone_id] = preds_list
            except Exception as e:
                print(f"Error predicting zone {zone_id}: {e}")
                results[zone_id] = [(0.0, 0.0)] * n

        return results

    def _compute_calibration_factor(
        self, zone_preds: dict, actual_map: dict,
        zones: list, local_now_hour: int, is_today: bool
    ) -> float:
        if is_today and local_now_hour < 1:
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
            return 1.0
        
        if total_predicted < 5.0:
             return 1.0

        factor = total_actual / total_predicted
        return max(0.1, min(10.0, factor))

    def _apply_calibration(
        self, zone_preds: dict, factor: float
    ) -> dict:
        if abs(factor - 1.0) < 0.01:
            return zone_preds
        calibrated = {}
        for zone_id, preds in zone_preds.items():
            calibrated[zone_id] = [
                (round(p * factor, 2), c) for p, c in preds
            ]
        return calibrated

    def _aggregate_city_wide_prediction(self, zone_preds: dict, time_index: int, zones: list, local_hour: int) -> float:
        total_sum = 0.0
        for z in zones:
            preds = zone_preds.get(z)
            if preds and time_index < len(preds):
                total_sum += preds[time_index][0]
        
        return round(max(0.0, total_sum), 0)

    def get_demand_forecast(self, hours: int = 12) -> DemandForecastResponse:
        now = datetime.utcnow()
        current_hour = now.hour
        hour_start = now.replace(minute=0, second=0, microsecond=0)
        
        # Dubai is UTC+4
        dubai_now = now + timedelta(hours=4)
        today_date = dubai_now.date()
        today_start_utc = datetime(today_date.year, today_date.month, today_date.day, 0, 0, 0) - timedelta(hours=4)

        zones = self._get_all_zones()

        current_hour_orders = self.db.query(Order).filter(
            Order.created_at >= hour_start,
            Order.created_at < hour_start + timedelta(hours=1),
            Order.pickup_zone.in_(zones)
        ).count()

        total_active_orders = self.db.query(Order).filter(
            Order.status.in_([OrderStatus.pending.value, OrderStatus.assigned.value, OrderStatus.picked_up.value]),
            Order.pickup_zone.in_(zones)
        ).count()
        forecast_end = hour_start + timedelta(hours=hours + 1)
        distinct_hours = int((forecast_end - today_start_utc).total_seconds() / 3600)
        distinct_hours = max(1, distinct_hours)
        
        forecast_times_full = [today_start_utc + timedelta(hours=i) for i in range(distinct_hours)]

        data_start = today_start_utc - timedelta(hours=192)
        data_end = forecast_end
        demand_data = self._prefetch_demand_data(zones, data_start, data_end)

        zone_preds = self._batch_predict_all_zones(zones, forecast_times_full, demand_data)

        local_now_hour = (now.hour + 4) % 24
        cal_actual = self.db.query(
            func.date_trunc('hour', Order.created_at).label('utc_hour_bucket'),
            func.count(Order.order_id).label('count')
        ).filter(
            Order.created_at >= today_start_utc,
            Order.created_at < forecast_end,
            Order.pickup_zone.in_(zones)
        ).group_by(text('utc_hour_bucket')).all()
        
        cal_map = {}
        for row in cal_actual:
            utc_h = row[0].replace(tzinfo=None).hour
            local_h = (utc_h + 4) % 24
            cal_map[local_h] = cal_map.get(local_h, 0) + row[1]

        forecast_local_hours = [(ft.hour + 4) % 24 for ft in forecast_times_full]
        zone_preds_by_local = {}
        
        for z in zones:
            preds_list = zone_preds.get(z, [(0, 0)] * len(forecast_times_full))
            by_hour = [(0, 0)] * 24
            for idx, lh in enumerate(forecast_local_hours):
                if idx < len(preds_list) and idx < 24: 
                    by_hour[lh] = preds_list[idx]
            zone_preds_by_local[z] = by_hour

        cal_factor = self._compute_calibration_factor(
            zone_preds_by_local, cal_map, zones, local_now_hour, True
        )
        zone_preds = self._apply_calibration(zone_preds, cal_factor)

        forecasts = []
        overall_peak_val = 0.0
        overall_peak_hour = "00:00"

        start_index = max(0, int((hour_start - today_start_utc).total_seconds() // 3600))
            
        target_times = [hour_start + timedelta(hours=i) for i in range(hours + 1)]

        for i, ft in enumerate(target_times):
            local_hour = (ft.hour + 4) % 24
            hour_label = f"{local_hour:02d}:00"
            full_idx = start_index + i
            
            total_pred = self._aggregate_city_wide_prediction(zone_preds, full_idx, zones, local_hour)
            
            def get_conf(z, idx):
                p_list = zone_preds.get(z, [])
                if idx < len(p_list):
                    return p_list[idx][1]
                return 0.0

            avg_conf = (sum(get_conf(z, full_idx) for z in zones) / len(zones)) if zones else 0.0
            confidence = round(avg_conf, 2)

            if i == 0:
                actual = current_hour_orders
                if total_pred == 0:
                    total_pred = float(current_hour_orders)
            else:
                actual = None

            forecasts.append(DemandForecastPoint(
                hour=hour_label,
                actual=actual,
                predicted=total_pred,
                confidence=confidence
            ))

            if total_pred > overall_peak_val:
                overall_peak_val = total_pred
                overall_peak_hour = hour_label
        
        imminent_peak_val = max([f.predicted for f in forecasts[:4]] or [0.0])
        daily_peak_val = max([f.predicted for f in forecasts] or [0.0])
        relevant_peak = imminent_peak_val if imminent_peak_val > 15 else daily_peak_val
        demand_score = min(1.0, relevant_peak / 60.0)
        
        if demand_score >= 0.8: alert_level = "CRITICAL"
        elif demand_score >= 0.6: alert_level = "HIGH"
        elif demand_score >= 0.4: alert_level = "ELEVATED"
        else: alert_level = "NORMAL"

        forecast_summary = {
            "active_backlog": total_active_orders,
            "current_arrival_rate": current_hour_orders,
            "daily_peak_hour": overall_peak_hour,
            "daily_peak_demand": int(overall_peak_val),
            "demand_score": round(demand_score, 2),
            "alert_level": alert_level,
            "available_drivers": self.db.query(Driver).filter(Driver.status == DriverStatus.AVAILABLE.value).count()
        }
        
        recommendations = GenAIService.generate_demand_insights(forecast_summary)

        return DemandForecastResponse(
            generated_at=now,
            forecast_hours=hours,
            current_demand=total_active_orders,
            peak_predicted_hour=overall_peak_hour,
            peak_predicted_demand=round(overall_peak_val, 0),
            forecasts=forecasts,
            recommendations=recommendations
        )

    def get_demand_history(self, target_date: str = None) -> dict:
        now = datetime.utcnow()
        local_now_hour = (now.hour + 4) % 24

        if target_date:
            from datetime import date as date_type
            parts = target_date.split('-')
            target = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
        else:
            target = (now + timedelta(hours=4)).date()

        today_dubai = (now + timedelta(hours=4)).date()
        is_today = (target == today_dubai)

        target_start_utc = datetime(target.year, target.month, target.day, 0, 0, 0) - timedelta(hours=4)
        target_end_utc = target_start_utc + timedelta(hours=24)

        zones = self._get_all_zones()

        hourly_actual = self.db.query(
            func.date_trunc('hour', Order.created_at).label('utc_hour_bucket'),
            func.count(Order.order_id).label('count')
        ).filter(
            Order.created_at >= target_start_utc,
            Order.created_at < target_end_utc,
            Order.pickup_zone.in_(zones)
        ).group_by(text('utc_hour_bucket')).all()
        
        actual_map = {}
        for row in hourly_actual:
            utc_h = row[0].replace(tzinfo=None).hour
            local_h = (utc_h + 4) % 24
            actual_map[local_h] = actual_map.get(local_h, 0) + row[1]

        forecast_times = []
        for h in range(24):
            utc_hour = (h - 4) % 24
            ft = datetime(target.year, target.month, target.day, utc_hour, 0, 0)
            if h < 4:
                ft = ft - timedelta(days=1)
            forecast_times.append(ft)

        data_start = min(forecast_times) - timedelta(hours=192)
        data_end = max(forecast_times) + timedelta(hours=1)
        demand_data = self._prefetch_demand_data(zones, data_start, data_end)

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
            predicted = self._aggregate_city_wide_prediction(zone_preds, h, zones, h)
            
            if is_today:
                actual = actual_map.get(h, 0) if h <= local_now_hour else None
            else:
                actual = actual_map.get(h, 0)

            if actual is not None:
                total_actual += actual
            total_predicted += predicted

            data.append({"hour": hour_label, "actual": actual, "predicted": predicted})

        # Recommendations (only for today)
        recommendations = []
        if is_today:
             # Imminent peak (next 7 hours)
             current_idx = local_now_hour
             imminent_forecasts = []
             for i in range(8):
                 idx = (current_idx + i) % 24
                 imminent_forecasts.append(self._aggregate_city_wide_prediction(zone_preds, idx, zones, idx))
             
             imminent_peak_val = max(imminent_forecasts) if imminent_forecasts else 0.0
             imminent_peak_hour = f"{(current_idx + imminent_forecasts.index(imminent_peak_val)) % 24:02d}:00"

             # Overall peak
             overall_peak_val = 0.0
             overall_peak_hour = "00:00"
             for h in range(24):
                 p = self._aggregate_city_wide_prediction(zone_preds, h, zones, h)
                 if p > overall_peak_val:
                     overall_peak_val = p
                     overall_peak_hour = f"{h:02d}:00"

             # Live data
             hour_start = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
             current_hour_orders = self.db.query(Order).filter(
                 Order.created_at >= hour_start,
                 Order.created_at < hour_start + timedelta(hours=1),
                 Order.pickup_zone.in_(zones)
             ).count()

             total_active_orders = self.db.query(Order).filter(
                 Order.status.in_([OrderStatus.pending.value, OrderStatus.assigned.value, OrderStatus.picked_up.value]),
                 Order.pickup_zone.in_(zones)
             ).count()

             from app.models.driver import Driver
             from app.schemas.driver import DriverStatus
             available_drivers = self.db.query(Driver).filter(Driver.status == DriverStatus.AVAILABLE.value).count()

             forecast_summary = {
                 "active_backlog": total_active_orders,
                 "current_arrival_rate": current_hour_orders,
                 "imminent_peak_hour": imminent_peak_hour,
                 "imminent_peak_demand": int(imminent_peak_val),
                 "daily_peak_hour": overall_peak_hour,
                 "daily_peak_demand": int(overall_peak_val),
                 "demand_score": round(max(0, overall_peak_val) / 60.0, 2),
                 "available_drivers": available_drivers
             }
             
             # Only recommend if there is actual activity or expected peak
             if total_active_orders > 0 or overall_peak_val > 10:
                 recommendations = GenAIService.generate_demand_insights(forecast_summary)

        return {
            "date": target.isoformat(),
            "date_label": target.strftime("%b %d, %Y"),
            "is_today": is_today,
            "current_hour": local_now_hour if is_today else None,
            "data": data,
            "total_actual": total_actual,
            "total_predicted": total_predicted,
            "recommendations": recommendations
        }

    def get_zone_demand_history(self, target_date: str = None) -> dict:
        now = datetime.utcnow()
        local_now_hour = (now.hour + 4) % 24

        if target_date:
            from datetime import date as date_type
            parts = target_date.split('-')
            target = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
        else:
            target = (now + timedelta(hours=4)).date()

        today_dubai = (now + timedelta(hours=4)).date()
        is_today = (target == today_dubai)

        target_start_utc = datetime(target.year, target.month, target.day, 0, 0, 0) - timedelta(hours=4)
        target_end_utc = target_start_utc + timedelta(hours=24)

        zones = self._get_all_zones()

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

        forecast_times = []
        for h in range(24):
            utc_hour = (h - 4) % 24
            ft = datetime(target.year, target.month, target.day, utc_hour, 0, 0)
            if h < 4:
                ft = ft - timedelta(days=1)
            forecast_times.append(ft)

        demand_data = self._prefetch_demand_data(zones, min(forecast_times) - timedelta(hours=170), max(forecast_times) + timedelta(hours=1))
        zone_preds = self._batch_predict_all_zones(zones, forecast_times, demand_data)
        


        combined_actual_map = {}
        for zid, hours in zone_actual_map.items():
            for h, cnt in hours.items():
                combined_actual_map[h] = combined_actual_map.get(h, 0) + cnt

        cal_factor = self._compute_calibration_factor(zone_preds, combined_actual_map, zones, local_now_hour, is_today)
        zone_preds = self._apply_calibration(zone_preds, cal_factor)

        # Create a dictionary mapping zone_id -> {utc_hour: prediction_value} AFTER calibration
        prediction_map = {}
        for zone_id, preds in zone_preds.items():
            prediction_map[zone_id] = {}
            for i, ft in enumerate(forecast_times):
                prediction_map[zone_id][ft.hour] = preds[i]

        zone_data = []
        for zone_id in zones:
            actual_map = zone_actual_map.get(zone_id, {})
            zone_name = zone_id.replace('zone_', '').replace('_', ' ').title()
            
            # Retrieve map for this specific zone
            zone_hour_preds = prediction_map.get(zone_id, {})

            hourly_data = []
            zone_total_actual = 0
            zone_total_predicted = 0.0

            for h in range(24):
                hour_label = f"{h:02d}:00"
                utc_hour = (h - 4) % 24
                
                # Retrieve the prediction explicitly mapped to the generated UTC hour for this local hour
                pred_tuple = zone_hour_preds.get(utc_hour, (0, 0))
                predicted = round(pred_tuple[0], 0)
                
                actual = actual_map.get(h, 0) if (not is_today or h <= local_now_hour) else None

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
