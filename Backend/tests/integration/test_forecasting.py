import pytest
from unittest.mock import patch, MagicMock
from app.models.zone import Zone
from datetime import datetime

def test_tc_fore_001_train_model(client):
    with patch("app.routers.forecasting.ForecastingService") as mock_fs:
        mock_instance = MagicMock()
        mock_fs.return_value = mock_instance
        
        # Simulate successful training
        mock_instance.train_zone_models.return_value = {
            "status": "trained",
            "metrics": {"r2_score": 0.85, "mae": 2.5}
        }
        
        response = client.post("/forecasting/train/zone-123?days_history=30")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "trained"
        assert "metrics" in data

def test_tc_fore_002_train_model_insufficient_data(client):
    with patch("app.routers.forecasting.ForecastingService") as mock_fs:
        mock_instance = MagicMock()
        mock_fs.return_value = mock_instance
        
        # Simulate insufficient data error
        mock_instance.train_zone_models.return_value = {
            "error": "Not enough data to train model"
        }
        
        response = client.post("/forecasting/train/zone-123?days_history=7")
        assert response.status_code == 400
        data = response.json()
        assert data["detail"] == "Not enough data to train model"

def test_tc_fore_003_generate_demand_forecast(client):
    with patch("app.routers.forecasting.ForecastingService") as mock_fs:
        mock_instance = MagicMock()
        mock_fs.return_value = mock_instance
        
        # Create a mock forecast object
        mock_forecast = MagicMock()
        mock_forecast.zone_id = "zone-123"
        mock_forecast.forecast_time = datetime.now()
        mock_forecast.predicted_demand = 45.5
        mock_forecast.demand_score = 75.0
        mock_forecast.confidence = "high"
        mock_forecast.alert_level = "normal"
        mock_forecast.model_used = "ml_ensemble"
        
        mock_instance.generate_forecast.return_value = [mock_forecast]
        
        response = client.get("/forecasting/predict?zone_id=zone-123&horizon_minutes=60")
        assert response.status_code == 200
        data = response.json()
        assert data["zone_id"] == "zone-123"
        assert data["forecast_count"] == 1
        assert data["forecasts"][0]["predicted_demand"] == 45.5
        assert data["forecasts"][0]["confidence"] == "high"

def test_tc_fore_004_update_live_demand(client):
    with patch("app.routers.forecasting.ForecastingService") as mock_fs:
        mock_instance = MagicMock()
        mock_fs.return_value = mock_instance
        
        mock_instance.update_live_demand.return_value = {
            "status": "updated",
            "zone_id": "zone-123",
            "demand_score": 82.5,
            "drivers_needed": 3
        }
        
        response = client.post("/forecasting/update-live/zone-123")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "updated"
        assert data["demand_score"] == 82.5

def test_tc_fore_005_get_demand_patterns(client):
    with patch("app.routers.forecasting.ForecastingService") as mock_fs:
        mock_instance = MagicMock()
        mock_fs.return_value = mock_instance
        
        mock_instance.get_demand_patterns.return_value = {
            "hourly_pattern": {"08:00": 15, "09:00": 30},
            "daily_pattern": {"Monday": 120, "Tuesday": 130}
        }
        
        response = client.get("/forecasting/patterns/zone-123")
        assert response.status_code == 200
        data = response.json()
        assert "hourly_pattern" in data
        assert "daily_pattern" in data
        assert data["daily_pattern"]["Monday"] == 120

def test_tc_fore_006_train_all_zones(client, db_session):
    # Mock the DB directly inside the test route finding zones
    zone1 = Zone(zone_id="zone-1", name="Downtown")
    zone2 = Zone(zone_id="zone-2", name="Suburb")
    
    mock_query = db_session.query.return_value
    mock_query.all.return_value = [zone1, zone2]
    
    with patch("app.routers.forecasting.ForecastingService") as mock_fs:
        mock_instance = MagicMock()
        mock_fs.return_value = mock_instance
        
        # training zone 1 success, zone 2 fail
        mock_instance.train_zone_models.side_effect = [
            {"status": "trained", "metrics": {"r2_score": 0.9}},
            {"error": "Not enough data"}
        ]
        
        response = client.post("/forecasting/train-all")
        assert response.status_code == 200
        data = response.json()
        assert data["total_zones"] == 2
        assert data["trained"] == 1
        assert data["failed"] == 1
        assert data["results"][0]["status"] == "trained"
        assert "error" in data["results"][1]
