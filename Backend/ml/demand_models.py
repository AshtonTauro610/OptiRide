import pandas as pd
import numpy as np
from datetime import datetime
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
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

        # Use shuffled split
        from sklearn.model_selection import train_test_split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, shuffle=True
        )

        scores = {}

        rf = RandomForestRegressor(
            n_estimators=300,
            max_depth=12,
            min_samples_split=4,
            min_samples_leaf=2,
            max_features='sqrt',
            random_state=42,
            n_jobs=-1
        )
        rf.fit(X_train, y_train)
        self.models['random_forest'] = rf
        scores['random_forest'] = rf.score(X_test, y_test)

        gb = GradientBoostingRegressor(
            n_estimators=300,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            min_samples_leaf=3,
            random_state=42
        )
        gb.fit(X_train, y_train)
        self.models['gradient_boosting'] = gb
        scores['gradient_boosting'] = gb.score(X_test, y_test)

        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)

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


        if not self.models:
            return 0.0, 0.0

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
                weights.append(0.5)
            elif model_name == 'gradient_boosting':
                weights.append(0.4)
            else:
                weights.append(0.1)

        if use_weights:
            final_pred = np.average(predictions, weights=weights)
        else:
            final_pred = np.mean(predictions)
        
        confidence = 1.0 - min(0.5, np.std(predictions) / (final_pred + 1))

        return round(final_pred, 2), round(confidence, 2)

    def predict_ensemble_batch(
        self,
        features: pd.DataFrame,
        use_weights: bool = True
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Vectorized batch prediction for multiple rows at once.
        Returns (predictions_array, confidences_array) with one value per row.
        """
        if not self.models:
            n = len(features)
            return np.zeros(n), np.zeros(n)

        n = len(features)
        all_preds = []  # list of arrays, one per model
        weights = []

        for model_name, model in self.models.items():
            if model_name == 'ridge':
                X_scaled = self.scalers['ridge'].transform(features)
                preds = model.predict(X_scaled)
            else:
                preds = model.predict(features)
            preds = np.maximum(0, preds)
            all_preds.append(preds)

            if model_name == 'random_forest':
                weights.append(0.5)
            elif model_name == 'gradient_boosting':
                weights.append(0.4)
            else:
                weights.append(0.1)

        # Stack: shape (n_models, n_rows) -> weighted average along axis 0
        preds_matrix = np.array(all_preds)  # (n_models, n_rows)
        weights_arr = np.array(weights)

        if use_weights and len(weights) == len(all_preds):
            final_preds = np.average(preds_matrix, axis=0, weights=weights_arr)
        else:
            final_preds = np.mean(preds_matrix, axis=0)

        # Confidence per row
        stds = np.std(preds_matrix, axis=0)
        confidences = 1.0 - np.minimum(0.5, stds / (final_preds + 1))

        return np.round(final_preds, 2), np.round(confidences, 2)
    
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
