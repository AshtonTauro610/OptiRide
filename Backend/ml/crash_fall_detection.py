import os
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    confusion_matrix,
    roc_auc_score,
)
from sklearn.metrics import precision_recall_curve
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


class RiskDetectionEngine:
    def __init__(self, roll_w: int = 5, top_n: int = 20):
        self.roll_w = roll_w
        self.top_n = top_n
        self.features_impact: List[str] = []
        self.crash_model = None
        self.fall_model = None
        self.crash_threshold = 0.65
        self.fall_threshold = 0.65

    def prepare_training_data(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        df["recorded_at"] = pd.to_datetime(df["recorded_at"], errors="coerce")
        df = df.dropna(subset=["recorded_at"])
        df["driver_id"] = df["driver_id"].astype(str)
        df = df.sort_values(["driver_id", "recorded_at"]).reset_index(drop=True)

        df["hour"] = df["recorded_at"].dt.hour
        df["dow"] = df["recorded_at"].dt.dayofweek

        roll_features = [
            "acceleration_magnitude",
            "angular_velocity_magnitude",
            "speed",
            "harsh_braking",
            "harsh_acceleration",
            "sharp_turn",
            "sudden_impact",
        ]

        grouped = df.groupby("driver_id", group_keys=False)
        for col in roll_features:
            if col in df.columns:
                df[f"{col}_mean_{self.roll_w}"] = grouped[col].transform(
                    lambda s: s.rolling(self.roll_w, min_periods=1).mean()
                )
                df[f"{col}_std_{self.roll_w}"] = grouped[col].transform(
                    lambda s: s.rolling(self.roll_w, min_periods=1).std().fillna(0.0)
                )
                df[f"{col}_max_{self.roll_w}"] = grouped[col].transform(
                    lambda s: s.rolling(self.roll_w, min_periods=1).max()
                )
                df[f"{col}_diff"] = grouped[col].transform(lambda s: s.diff().fillna(0.0))

        acc_thr_98 = df["acceleration_magnitude"].quantile(0.98)
        gyro_thr_98 = df["angular_velocity_magnitude"].quantile(0.98)
        acc_thr_max = df["acceleration_magnitude"].quantile(0.90)
        acc_thr_next = df["acceleration_magnitude"].quantile(0.40)

        df["label_crash"] = (
            (df[f"acceleration_magnitude_max_{self.roll_w}"] > acc_thr_98)
            & (df[f"angular_velocity_magnitude_max_{self.roll_w}"] > gyro_thr_98)
        ).astype(int)

        df["acceleration_mean_next"] = (
            df.groupby("driver_id")["acceleration_magnitude"].transform(
                lambda s: s.rolling(self.roll_w, min_periods=1).mean().shift(-self.roll_w)
            )
        )
        df["acceleration_mean_next"] = df["acceleration_mean_next"].fillna(
            df["acceleration_mean_next"].median()
        )

        df["label_fall"] = (
            (df[f"acceleration_magnitude_max_{self.roll_w}"] > acc_thr_max)
            & (df["acceleration_mean_next"] < acc_thr_next)
        ).astype(int)

        candidate_features = [
            "acceleration_magnitude",
            "angular_velocity_magnitude",
            "speed",
            "harsh_braking",
            "harsh_acceleration",
            "sharp_turn",
            "sudden_impact",
            f"acceleration_magnitude_mean_{self.roll_w}",
            f"acceleration_magnitude_std_{self.roll_w}",
            f"angular_velocity_magnitude_mean_{self.roll_w}",
            f"angular_velocity_magnitude_std_{self.roll_w}",
            f"speed_mean_{self.roll_w}",
            f"speed_std_{self.roll_w}",
            "acceleration_magnitude_diff",
            "angular_velocity_magnitude_diff",
            "speed_diff",
            "harsh_braking_diff",
            "harsh_acceleration_diff",
            "sharp_turn_diff",
            "sudden_impact_diff",
        ]

        self.features_impact = [
            col
            for col in candidate_features
            if col in df.columns and not df[col].isna().all()
        ]
        return df

    def _train_group_model(
        self,
        df: pd.DataFrame,
        y_col: str,
        group_col: str = "driver_id",
    ) -> Dict[str, Any]:
        y = df[y_col].astype(int).values
        if np.unique(y).size < 2:
            return {"model": None, "threshold": 0.65}

        X = df[self.features_impact].fillna(0)
        groups = df[group_col].values

        gss = GroupShuffleSplit(n_splits=1, test_size=0.3, random_state=42)
        train_idx, test_idx = next(gss.split(X, y, groups))

        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]

        model = Pipeline(
            [
                ("scale", StandardScaler()),
                (
                    "clf",
                    RandomForestClassifier(
                        n_estimators=250,
                        max_depth=10,
                        min_samples_leaf=10,
                        min_samples_split=20,
                        max_features="sqrt",
                        class_weight="balanced",
                        random_state=42,
                        n_jobs=-1,
                    ),
                ),
            ]
        )

        model.fit(X_train, y_train)
        proba = model.predict_proba(X_test)[:, 1]

        precisions, recalls, thresholds = precision_recall_curve(y_test, proba)
        valid_indices = np.where(precisions[:-1] >= 0.85)[0]
        if len(valid_indices) > 0:
            best_idx = valid_indices[np.argmax(recalls[valid_indices])]
            optimal_threshold = float(thresholds[best_idx])
        elif len(thresholds) > 0:
            f1_scores = 2 * (precisions * recalls) / (precisions + recalls + 1e-10)
            optimal_threshold = float(thresholds[np.argmax(f1_scores[:-1])])
        else:
            optimal_threshold = 0.65

        preds = (proba >= optimal_threshold).astype(int)
        metrics = {
            "classification_report": classification_report(
                y_test, preds, digits=4, output_dict=False
            ),
            "confusion_matrix": confusion_matrix(y_test, preds, labels=[0, 1]).tolist(),
        }
        try:
            metrics["roc_auc"] = float(roc_auc_score(y_test, proba))
            metrics["pr_auc"] = float(average_precision_score(y_test, proba))
        except Exception:
            pass

        return {
            "model": model,
            "threshold": optimal_threshold,
            "metrics": metrics,
            "X_test": X_test,
            "y_test": y_test,
            "preds": preds,
            "proba": proba,
        }

    def train_from_csv(self, data_path: str) -> Dict[str, Any]:
        df = pd.read_csv(data_path)
        prepared_df = self.prepare_training_data(df)

        crash_info = self._train_group_model(prepared_df, "label_crash")
        fall_info = self._train_group_model(prepared_df, "label_fall")

        self.crash_model = crash_info.get("model")
        self.fall_model = fall_info.get("model")
        self.crash_threshold = crash_info.get("threshold", 0.65)
        self.fall_threshold = fall_info.get("threshold", 0.65)

        scored = self.predict_batch(prepared_df)
        return {
            "crash": crash_info,
            "fall": fall_info,
            "scored_df": scored,
        }

    def _safe_predict_proba(self, model, X: pd.DataFrame) -> np.ndarray:
        if model is None:
            return np.zeros(len(X), dtype=float)
        return model.predict_proba(X)[:, 1]

    def predict_batch(self, df: pd.DataFrame) -> pd.DataFrame:
        if not self.features_impact:
            return df.copy()

        result = df.copy()
        X = result.reindex(columns=self.features_impact, fill_value=0).fillna(0)
        result["p_crash"] = self._safe_predict_proba(self.crash_model, X)
        result["p_fall"] = self._safe_predict_proba(self.fall_model, X)

        def compute_actions(row: pd.Series) -> pd.Series:
            sev_impact = row.get(
                f"acceleration_magnitude_max_{self.roll_w}",
                row.get("acceleration_magnitude", 0.0),
            )
            speed = row.get("speed", None)
            crash_level, crash_score = self.fuzzy_action_crash(row["p_crash"], sev_impact, speed)
            fall_level, fall_score = self.fuzzy_action_fall(row["p_fall"], sev_impact, speed)
            return pd.Series(
                {
                    "crash_action": crash_level,
                    "crash_fuzzy": crash_score,
                    "fall_action": fall_level,
                    "fall_fuzzy": fall_score,
                }
            )

        actions = result.apply(compute_actions, axis=1)
        return pd.concat([result, actions], axis=1)

    def predict_row(self, sensor_row: Dict[str, Any]) -> Dict[str, Any]:
        if not self.features_impact:
            return {
                "crash_probability": 0.0,
                "crash_action": "LOG/OBSERVE",
                "crash_fuzzy": 0.0,
                "fall_probability": 0.0,
                "fall_action": "LOG/OBSERVE",
                "fall_fuzzy": 0.0,
            }

        row_df = pd.DataFrame([sensor_row])
        X = row_df.reindex(columns=self.features_impact, fill_value=0).fillna(0)
        p_crash = float(self._safe_predict_proba(self.crash_model, X)[0])
        p_fall = float(self._safe_predict_proba(self.fall_model, X)[0])
        impact = sensor_row.get(
            f"acceleration_magnitude_max_{self.roll_w}",
            sensor_row.get("acceleration_magnitude", 0.0),
        )
        speed = sensor_row.get("speed", None)

        crash_action, crash_score = self.fuzzy_action_crash(p_crash, impact, speed)
        fall_action, fall_score = self.fuzzy_action_fall(p_fall, impact, speed)

        return {
            "crash_probability": round(p_crash, 4),
            "crash_action": crash_action,
            "crash_fuzzy": round(crash_score, 4),
            "fall_probability": round(p_fall, 4),
            "fall_action": fall_action,
            "fall_fuzzy": round(fall_score, 4),
        }

    def save_models(self, path: str = "ml/models"):
        os.makedirs(path, exist_ok=True)
        joblib.dump(self.crash_model, f"{path}/crash_model.pkl")
        joblib.dump(self.fall_model, f"{path}/fall_model.pkl")
        joblib.dump(self.features_impact, f"{path}/impact_features.pkl")
        joblib.dump(
            {
                "roll_w": self.roll_w,
                "top_n": self.top_n,
                "crash_threshold": self.crash_threshold,
                "fall_threshold": self.fall_threshold,
            },
            f"{path}/risk_config.pkl",
        )

    def load_models(self, path: str = "ml/models"):
        crash_path = f"{path}/crash_model.pkl"
        fall_path = f"{path}/fall_model.pkl"
        features_path = f"{path}/impact_features.pkl"
        config_path = f"{path}/risk_config.pkl"

        if os.path.exists(crash_path):
            self.crash_model = joblib.load(crash_path)
        if os.path.exists(fall_path):
            self.fall_model = joblib.load(fall_path)
        if os.path.exists(features_path):
            self.features_impact = joblib.load(features_path)
        if os.path.exists(config_path):
            config = joblib.load(config_path)
            self.roll_w = int(config.get("roll_w", self.roll_w))
            self.top_n = int(config.get("top_n", self.top_n))
            self.crash_threshold = float(config.get("crash_threshold", self.crash_threshold))
            self.fall_threshold = float(config.get("fall_threshold", self.fall_threshold))

    @staticmethod
    def trapmf(x: float, a: float, b: float, c: float, d: float) -> float:
        x = float(x)
        if x < a or x > d:
            return 0.0
        if b <= x <= c:
            return 1.0
        if a <= x < b:
            return (x - a) / (b - a) if b - a != 0 else 1.0
        return (d - x) / (d - c) if d - c != 0 else 1.0

    @staticmethod
    def fuzzy_action_crash(prob: float, impact_sev: float, speed: Optional[float] = None):
        p = float(np.clip(prob, 0.0, 1.0))
        s = float(impact_sev) if impact_sev is not None else 0.0
        spd = float(speed) if speed is not None and not np.isnan(speed) else 0.0

        p_low = RiskDetectionEngine.trapmf(p, 0.0, 0.0, 0.05, 0.20)
        p_med = RiskDetectionEngine.trapmf(p, 0.10, 0.25, 0.40, 0.60)
        p_high = RiskDetectionEngine.trapmf(p, 0.35, 0.50, 1.0, 1.0)

        s_low = RiskDetectionEngine.trapmf(s, 0.0, 0.0, 5.0, 12.0)
        s_med = RiskDetectionEngine.trapmf(s, 10.0, 15.0, 20.0, 25.0)
        s_high = RiskDetectionEngine.trapmf(s, 20.0, 25.0, 60.0, 60.0)

        speed_factor = np.clip((spd - 10) / 20, 0.0, 1.0)

        escalate = max(min(p_high, s_high), min(p_high, speed_factor * s_high))
        warn = max(min(p_med, s_med), min(p_high, s_med * speed_factor))
        observe = p_low

        score = float(np.clip(0.1 * observe + 0.6 * warn + 0.95 * escalate, 0.0, 1.0))
        level = "ESCALATE" if score >= 0.8 else ("WARN" if p >= 0.65 else "LOG/OBSERVE")
        return level, score

    @staticmethod
    def fuzzy_action_fall(
        prob: float,
        impact_sev: float,
        speed: Optional[float] = None,
        warn_threshold: float = 0.50,
    ):
        p = float(np.clip(prob, 0.0, 1.0))
        s = float(impact_sev) if impact_sev is not None else 0.0
        spd = float(speed) if speed is not None and not np.isnan(speed) else 0.0

        p_low = RiskDetectionEngine.trapmf(p, 0.0, 0.0, 0.15, 0.30)
        p_med = RiskDetectionEngine.trapmf(p, 0.25, 0.35, 0.50, 0.65)
        p_high = RiskDetectionEngine.trapmf(p, 0.55, 0.70, 1.0, 1.0)

        s_low = RiskDetectionEngine.trapmf(s, 0.0, 0.0, 8.0, 12.0)
        s_med = RiskDetectionEngine.trapmf(s, 10.0, 14.0, 20.0, 28.0)
        s_high = RiskDetectionEngine.trapmf(s, 22.0, 28.0, 60.0, 60.0)

        speed_factor = np.clip((spd - 10) / 20, 0.0, 1.0)

        escalate = max(min(p_high, s_high), min(p_high, s_high * speed_factor))
        warn = max(min(p_med, s_med), min(p_high, s_med * speed_factor))
        observe = p_low

        score = float(np.clip(0.10 * observe + 0.60 * warn + 0.95 * escalate, 0.0, 1.0))
        level = "ESCALATE" if score >= 0.80 else ("WARN" if p >= warn_threshold else "LOG/OBSERVE")
        return level, score