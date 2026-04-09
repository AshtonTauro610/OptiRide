import pytest
from app.services.forecasting_service import ForecastingService
from datetime import datetime

class TestForecastingService:
    
    def test_build_features_fast(self):
        service = ForecastingService(db=None) 
        test_forecast_utc = datetime(2024, 8, 5, 8, 0, 0)
        
        mock_demand_data = {
            test_forecast_utc.replace(hour=7): 45,
            test_forecast_utc.replace(hour=6): 35,
        }
        
        features = service._build_features_fast(test_forecast_utc, mock_demand_data)
        
        assert features["hour"] == 12
        assert features["is_weekend"] == 0
        assert features["demand_lag_1"] == 45
        assert features["demand_lag_2"] == 35
        assert round(features["demand_rolling_mean_3"], 2) == 26.67

    def test_compute_calibration_factor(self):
        service = ForecastingService(db=None)
        zones = ["zone_A", "zone_B"]
        
        actual_map = {2: 200, 3: 200, 4: 0}
        pad = [(0.0, 0.0)] * 24
        pad_A = list(pad)
        pad_A[2] = (50.0, 0.8)
        pad_A[3] = (50.0, 0.8)
        pad_B = list(pad)
        pad_B[2] = (50.0, 0.8)
        pad_B[3] = (50.0, 0.8)
        
        zone_preds = {
            "zone_A": pad_A,
            "zone_B": pad_B
        }
        
        factor = service._compute_calibration_factor(zone_preds, actual_map, zones, local_now_hour=4, is_today=True)
        assert factor == 2.0
        
        actual_map_extreme = {2: 4000, 3: 4000}
        capped_factor = service._compute_calibration_factor(zone_preds, actual_map_extreme, zones, local_now_hour=4, is_today=True)
        assert capped_factor == 10.0
        
        actual_map_low = {2: 1, 3: 1}  
        min_factor = service._compute_calibration_factor(zone_preds, actual_map_low, zones, local_now_hour=4, is_today=True)
        assert min_factor == 0.1

    def test_apply_calibration(self):
        service = ForecastingService(db=None)
        
        # Set up uncalibrated zone preds
        # Format: zone: [(predicted, confidence)]
        zone_preds = {
            "zone_1": [(10.0, 0.8), (20.0, 0.9)],
            "zone_2": [(5.0, 0.5), (15.0, 0.6)]
        }
        
        # Apply a factor of 2.0
        calibrated = service._apply_calibration(zone_preds, 2.0)
        
        assert calibrated["zone_1"][0][0] == 20.0
        assert calibrated["zone_1"][1][0] == 40.0
        assert calibrated["zone_2"][0][0] == 10.0
        # Check that confidence levels are entirely untouched
        assert calibrated["zone_1"][0][1] == 0.8
        
        # Apply factor of practically 1.0 (should skip math)
        calibrated_one = service._apply_calibration(zone_preds, 1.005)
        # Assuming our threshold skips close to 1.0 loops and returns original object
        assert calibrated_one == zone_preds

    def test_aggregate_city_wide_prediction(self):
        service = ForecastingService(db=None)
        
        zone_preds = {
            "North": [(20.0, 0.8), (15.0, 0.7)],
            "South": [(30.0, 0.9), (35.0, 0.6)],
            "East": [(0.0, 0.0), (5.0, 0.5)]
        }
        
        zones = ["North", "South", "East"]
        
        # Test index 0
        sum_0 = service._aggregate_city_wide_prediction(zone_preds, time_index=0, zones=zones, local_hour=0)
        assert sum_0 == 50.0  # (20 + 30 + 0)
        
        # Test index 1
        sum_1 = service._aggregate_city_wide_prediction(zone_preds, time_index=1, zones=zones, local_hour=1)
        assert sum_1 == 55.0  # (15 + 35 + 5)
        
        # Test empty zones protection
        sum_empty = service._aggregate_city_wide_prediction(zone_preds, time_index=0, zones=["GhostTown"], local_hour=0)
        assert sum_empty == 0.0
