from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import pandas as pd
import numpy as np

from app.models.zone import Zone, DemandForecast, DemandPattern
from app.models.order import Order
from app.ml.feature_engineering import FeatureEngineer
from app.ml.demand_models import DemandForecaster, TimeSeriesForecaster

class ForecastingService:
    def __init__(self, db: Session):
        self.db = db
        self.feature_engineer = FeatureEngineer(db)
        self.ml_forecaster = DemandForecaster()
        self.ts_forecaster = TimeSeriesForecaster()

        try:
            self.ml_forecaster.load_models()
        except Exception as e:
            print(f"Warning: Could not load ML models: {e}")
    
    def train_zone_models(
        self,
        zone_id: str,
        days_history: int = 60
    ) -> Dict[str, Any]:

        end_date = datetime.now()
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

        self.ts_forecaster.train_arima(df)
        self.ts_forecaster.train_prophet(df)
        self.ml_forecaster.save_models(f'ml/models/zone_{zone_id}')
        self._learn_demand_patterns(zone_id, df)

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
                
                if method == "ensemble":
                    ml_pred, ml_conf = self.ml_forecaster.predict_ensemble(features_df)
                    ts_pred_arima = self.ts_forecaster.predict_arima(steps=minutes_ahead//60 or 1)
                    ts_pred_prophet = self.ts_forecaster.predict_prophet(forecast_time)

                    final_pred = (ml_pred * 0.5) + (ts_pred_arima * 0.25) + (ts_pred_prophet * 0.25)
                    confidence = ml_conf
                    model_used = "ensemble"
                elif method == "ml_only":
                    final_pred, confidence = self.ml_forecaster.predict_ensemble(features_df)
                    model_used = "ml_ensemble"
                else:
                    final_pred = (self.ts_forecaster.predict_arima() + self.ts_forecaster.predict_prophet()) / 2
                    confidence = 0.75
                    model_used = "ts_ensemble"
                
                demand_score = min(1.0, final_pred / 50.0)

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

        zone.demand_score = min(1.0, blended_demand / 50.0)
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