import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.weather import Weather
from app.models.zone import Zone
from app.models.order import Order


class FeatureEngineer:
    def __init__(self, db: Session):
        self.db = db
    
    def create_training_dataset(
        self,
        zone_id: str,
        start_date: datetime,
        end_date: datetime,
        aggregation: str = "hourly",
    ) -> pd.DataFrame:
        
        orders = self.db.query(Order).filter(
            Order.pickup_zone == zone_id,
            Order.created_at >= start_date,
            Order.created_at <= end_date,
        ).all()

        df = pd.DataFrame([{
            'timestamp': o.created_at,
            'order_id': o.order_id,
            'price': o.price,
            'distance_km': o.distance_km,
            'duration_min': o.duration_min
        } for o in orders])

        if df.empty:
            return pd.DataFrame()
        
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df.set_index('timestamp', inplace=True)
        
        if aggregation == "hourly":
            agg_df = df.resample('H').agg({
                'order_id': 'count',
                'price': 'mean',
                'distance_km': 'mean',
                'duration_min': 'mean'
            })
        else:
            agg_df = df.resample('15T').agg({
                'order_id': 'count',
                'price': 'mean',
                'distance_km': 'mean',
                'duration_min': 'mean'
            })
        
        agg_df.rename(columns={'order_id' : 'demand'}, inplace=True)
        agg_df.fillna(0, inplace=True)

        features_df = self._create_time_features(agg_df)
        features_df = self._create_lag_features(features_df)
        features_df = self._create_rolling_features(features_df)
        features_df = self._create_cyclical_features(features_df)
        features_df = self._add_external_factors(features_df, zone_id)
        features_df = self._create_derived_features(features_df)

        return features_df.dropna()
    
    def _create_time_features(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()

        df['hour'] = df.index.hour
        df['day_of_week'] = df.index.dayofweek
        df['day_of_month'] = df.index.day
        df['week_of_year'] = df.index.isocalendar().week
        df['month'] = df.index.month
        df['quarter'] = df.index.quarter
        df['year'] = df.index.year
        
        df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)

        df['is_breakfast'] = ((df['hour'] >= 7) & (df['hour'] < 11)).astype(int)
        df['is_lunch'] = ((df['hour'] >= 12) & (df['hour'] < 15)).astype(int)
        df['is_dinner'] = ((df['hour'] >= 18) & (df['hour'] < 21)).astype(int)
        df['is_late_night'] = ((df['hour'] >= 22) | (df['hour'] < 3)).astype(int)

        df['is_workday'] = ((df['day_of_week'] < 5) & (~df['is_holiday'])).astype(int) if 'is_holiday' in df else (df['day_of_week'] < 5).astype(int)

        return df
    
    def _create_rolling_features(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        
        windows = [3, 6, 12, 24]

        for window in windows:
            df[f'demand_rolling_mean_{window}'] = df['demand'].rolling(window=window).mean()
            df[f'demand_rolling_std_{window}'] = df['demand'].rolling(window=window).std()
            df[f'demand_rolling_min_{window}'] = df['demand'].rolling(window=window).min()
            df[f'demand_rolling_max_{window}'] = df['demand'].rolling(window=window).max()

        return df

    def _create_lag_features(self, df: pd.DataFrame, lags: List[int] = None) -> pd.DataFrame:
        df = df.copy()
        
        if lags is None:
            lags = [1, 2, 3, 6, 12, 24, 48, 168]

        for lag in lags:
            df[f'demand_lag_{lag}'] = df['demand'].shift(lag)
        
        return df
    
    def _create_cyclical_features(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()

        df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
        df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
        
        df['dow_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
        df['dow_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)
        
        df['dom_sin'] = np.sin(2 * np.pi * df['day_of_month'] / 30)
        df['dom_cos'] = np.cos(2 * np.pi * df['day_of_month'] / 30)
        
        df['woy_sin'] = np.sin(2 * np.pi * df['week_of_year'] / 52)
        df['woy_cos'] = np.cos(2 * np.pi * df['week_of_year'] / 52)
        
        df['month_sin'] = np.sin(2 * np.pi * df['month'] / 12)
        df['month_cos'] = np.cos(2 * np.pi * df['month'] / 12)
        
        df['quarter_sin'] = np.sin(2 * np.pi * df['quarter'] / 4)
        df['quarter_cos'] = np.cos(2 * np.pi * df['quarter'] / 4)
        
        df['year_sin'] = np.sin(2 * np.pi * df['year'] / 100)
        df['year_cos'] = np.cos(2 * np.pi * df['year'] / 100)
        
        return df

    def _add_external_factors(self, df:pd.DataFrame, zone_id: str) -> pd.DataFrame:
        df = df.copy()

        # TODO: Add weather factors
        
        return df
    
    def _create_derived_features(self, df:pd.DataFrame) -> pd.DataFrame:
        df = df.copy()

        df['weekend_dinner'] = df['is_weekend'] * df['is_dinner']
        df['workday_lunch'] = df['is_workday'] * df['is_lunch']

        if 'demand_lag_1' in df and 'demand_lag_2' in df:
            df['demand_momentum'] = df['demand_lag_1'] - df['demand_lag_2']

        if 'demand_rolling_std_24' in df and 'demand_rolling_mean_24' in df:
            df['demand_cv'] = df['demand_rolling_std_24'] / (df['demand_rolling_mean_24'] + 1)
        
        return df
    
    def create_prediction_features(
        self,
        zone_id: str,
        forecast_time: datetime
    ) -> Dict[str, Any]:

        features = {}

        features['hour'] = forecast_time.hour
        features['day_of_week'] = forecast_time.weekday()
        features['day_of_month'] = forecast_time.day
        features['month'] = forecast_time.month
        features['is_weekend'] = 1 if forecast_time.weekday() >= 5 else 0
        features['is_breakfast'] = 1 if 7 <= forecast_time.hour <= 11 else 0
        features['is_lunch'] = 1 if 12 <= forecast_time.hour <= 15 else 0
        features['is_dinner'] = 1 if 18 <= forecast_time.hour <= 21 else 0     

        features['hour_sin'] = np.sin(2 * np.pi * features['hour'] / 24)
        features['hour_cos'] = np.cos(2 * np.pi * features['hour'] / 24)     
        features['dow_sin'] = np.sin(2 * np.pi * features['day_of_week'] / 7)
        features['dow_cos'] = np.cos(2 * np.pi * features['day_of_week'] / 7)
        
        recent_demand = self._get_recent_demand(zone_id, forecast_time)
        features.update(recent_demand)
        
        return features
    
    def _get_recent_demand(self, zone_id: str, current_time: datetime) -> Dict[str, Any]:
        lags = {}

        for lag_hours in [1, 2, 3, 6, 12, 24]:
            lag_time = current_time - timedelta(hours=lag_hours)
            window_start = lag_time - timedelta(minutes=30)
            window_end = lag_time + timedelta(minutes=30)
            
            count = self.db.query(Order).filter(
                Order.pickup_zone == zone_id,
                Order.created_at >= window_start,
                Order.created_at <= window_end
            ).count()
            
            lags[f'demand_lag_{lag_hours}'] = float(count)
            
        return lags
            