import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from statsmodels.tsa.arima.model import ARIMA
from prophet import Prophet
import joblib
from typing import Dict, Tuple, Any
import warnings
warnings.filterwarnings("ignore")

class DemandForecaster:
    def __init__(self):
        self.models = {}
        self.scalers = {}
        self.feature_columns = []
    
    def train_ensemble(
        self,
        df: pd.DataFrame,
        target_col: str = 'demand'
    ) -> Dict[str, float]:

        X = df.drop(columns=[target_col])
        y = df[target_col]

        self.feature_columns = X.columns.tolist()

        split_idx = int(len(df) * 0.8)
        X_train, X_test = X[:split_idx], X[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]

        scores = {}

        rf = RandomForestRegressor(
            n_estimators=200,
            max_depth=15,
            min_samples_split=5,
            random_state=42,
            n_jobs=-1
        )
        rf.fit(X_train, y_train)
        self.models['random_forest'] = rf
        scores['random_forest'] = rf.score(X_test, y_test)

        gb = GradientBoostingRegressor(
            n_estimators=200,
            max_depth=5,
            learning_rate=0.1,
            random_state=42
        )
        gb.fit(X_train, y_train)
        self.models['gradient_boosting'] = gb
        scores['gradient_boosting'] = gb.score(X_test, y_test)

        scaler = StandardScaler()
        x_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.fit_transform(X_test)

        ridge = Ridge(alpha=1.0)
        ridge.fit(X_train_scaled, y_train)
        self.models['ridge'] = ridge
        self.scalers['ridge'] = scaler
        scores['ridge'] = ridge.score(X_test_scaled, y_test)

        return scores
    
    def predict_ensemble(
        self,
        features: pd.DataFrame,
        use_weights: bool = True
    ) -> Tuple[float, float]:

        predictions = []
        weights = []

        for model_name, model in self.models.items():
            if model_name == 'ridge':
                X_scaled = self.scalers['ridge'].transform(features)
                pred = model.predict(X_scaled)[0]
            else:
                pred = model.predict(features)[0]
            
            predictions.append(max(0, pred))

            if model_name == 'random_forest':
                weights.append(0.4)
            elif model_name == 'gradient_boosting':
                weights.append(0.4)
            else:
                weights.append(0.2)

        if use_weights:
            final_pred = np.average(predictions, weights=weights)
        else:
            final_pred = np.mean(predictions)
        
        confidence = 1.0 - min(0.5, np.std(predictions) / (final_pred + 1))

        return round(final_pred, 2), round(confidence, 2)
    
    def save_models(self, path: str = 'ml/models'):
        import os
        os.makedirs(path, exist_ok=True)

        for name, model in self.models.items():
            joblib.dump(model, f'{path}/{name}_model.pkl')

        for name, scaler in self.scalers.items():
            joblib.dump(scaler, f'{path}/{name}_scaler.pkl')
        
        joblib.dump(self.feature_columns, f'{path}/feature_columns.pkl')

    def load_models(self, path: str = 'ml/models'):
        import os
        
        model_files = {
            'random_forest': f'{path}/random_forest_model.pkl',
            'gradient_boosting': f'{path}/gradient_boosting_model.pkl',
            'ridge': f'{path}/ridge_model.pkl'
        }
        
        for name, file_path in model_files.items():
            if os.path.exists(file_path):
                self.models[name] = joblib.load(file_path)
        
        ridge_scaler_path = f'{path}/ridge_scaler.pkl'
        if os.path.exists(ridge_scaler_path):
            self.scalers['ridge'] = joblib.load(ridge_scaler_path)
        
        feature_path = f'{path}/feature_columns.pkl'
        if os.path.exists(feature_path):
            self.feature_columns = joblib.load(feature_path)


class TimeSeriesForecaster:
    def __init__(self):
        self.arima_model = None
        self.prophet_model = None
    
    def train_arima(self, df: pd.DataFrame, order=(2,1,2)):
        ts = df['demand'].asfreq('H', fill_value=0)

        model = ARIMA(ts, order=order)
        self.arima_model = model.fit()

    def train_prophet(self, df: pd.DataFrame):
        prophet_df = df.reset_index()
        prophet_df = prophet_df.rename(columns={'timestamp': 'ds', 'demand':'y'})

        model = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=True,
            daily_seasonality=True
        )
        model.add_seasonality(name='hourly', period=1, fourier_order=8)

        model.fit(prophet_df)
        self.prophet_model = model

    def predict_arima(self, steps: int = 1) -> float:
        if not self.arima_model:
            return 0.0

        forecast = self.arima_model.forecast(steps=steps)
        return max(0, forecast[-1])
    
    def predict_prophet(self, future_time: datetime) -> float:
        if not self.prophet_model:
            return 0.0

        future_df = pd.DataFrame({'ds': [future_time]})
        forecast = self.prophet_model.predict(future_df)

        return max(0, forecast['yhat'].values[0])