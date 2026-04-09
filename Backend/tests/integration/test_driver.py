import pytest
from unittest.mock import patch, MagicMock
from app.schemas.driver import DriverStatus, DutyStatus
from app.models.user import User
from app.models.driver import Driver
from datetime import datetime

def create_mock_driver(driver_id, user_id, name):
    driver = Driver(
        driver_id=driver_id,
        user_id=user_id,
        name=name,
        status=DriverStatus.AVAILABLE.value,
        duty_status=DutyStatus.ON_DUTY.value,
        orders_received=0,
        rating=5.0,
        breaks=0,
        safety_alerts=0,
        fatigue_score=0.0,
        created_at=datetime.now()
    )
    return driver

def test_tc_drv_001_add_new_driver(client, db_session):
    test_user = User(
        user_id="test-new-user-id",
        email="driver@optiride.com",
        user_type="driver",
        phone_number="+1234567890",
    )
    
    mock_query = db_session.query.return_value
    mock_filter = mock_query.filter.return_value
    mock_filter.first.side_effect = [test_user, None]
    
    with patch("app.routers.driver.DriverService") as mock_ds:
        mock_service_instance = MagicMock()
        mock_ds.return_value = mock_service_instance
        
        mock_service_instance.get_driver_by_user_id.return_value = None
        mock_service_instance.create_driver.return_value = create_mock_driver("new-driver-id", "test-new-user-id", "New Driver QA")
        
        req_data = {
            "user_id": "test-new-user-id",
            "vehicle_type": "Sedan",
            "license_plate": "XYZ-9876",
            "name": "New Driver QA"
        }
        
        response = client.post("/drivers/", json=req_data)
        assert response.status_code == 200
        assert response.json()["driver_id"] == "new-driver-id"

def test_tc_drv_002_update_driver_status(client, db_session):
    with patch("app.routers.driver.socket_manager.notify_driver_status_change") as mock_notify, \
         patch("app.routers.driver.DriverService") as mock_ds:
        
        mock_service_instance = MagicMock()
        mock_ds.return_value = mock_service_instance
        
        req_data = {
            "status": "available"
        }
        
        response = client.post("/drivers/me/status", json=req_data)
        assert response.status_code == 200
        assert mock_service_instance.update_status.called
        assert mock_notify.called

def test_tc_drv_004_delete_driver_record(client, db_session):
    with patch("app.routers.driver.DriverService") as mock_ds:
        mock_service_instance = MagicMock()
        mock_ds.return_value = mock_service_instance
        
        response = client.delete("/drivers/driver-id-to-delete")
        assert response.status_code == 200
        assert "deleted successfully" in response.text
        assert mock_service_instance.delete_driver.called

def test_tc_drv_005_view_driver_performance(client, db_session):
    with patch("app.routers.driver.DriverService") as mock_ds:
        mock_service_instance = MagicMock()
        mock_ds.return_value = mock_service_instance
        
        mock_stats = {
            "driver_id": "driver-id",
            "name": "Driver Name",
            "fatigue_level": "NORMAL",
            "today_orders": 5,
            "today_earnings": 120.50,
            "today_breaks": 1,
            "today_distance": 50.0,
            "today_safety_alerts": 0,
            "today_safety_score": 100.0,
            "today_harsh_braking": 0,
            "today_speeding": 0,
            "today_fatigue_alerts": 0,
            "current_fatigue_score": 0.0,
            "current_speed": 0.0,
            "total_orders": 45,
            "total_assigned": 45,
            "total_breaks": 10,
            "total_distance": 500.0,
            "average_rating": 4.8,
            "completion_rate": 99.0,
            "orders_30d": 40,
            "breaks_30d": 8,
            "distance_30d": 450.0,
            "avg_30d_safety_score": 98.0,
            "total_30d_alerts": 1,
            "avg_30d_harsh_braking": 0.1,
            "avg_30d_speeding": 0.0,
            "avg_30d_fatigue_alerts": 0.0
        }
        mock_service_instance.get_performance_stats.return_value = mock_stats
        
        response = client.get("/drivers/driver-id/performance-stats")
        assert response.status_code == 200
        data = response.json()
        assert data["total_orders"] == 45
        assert data["average_rating"] == 4.8

def test_tc_drv_007_008_check_driver_profile(client, db_session):
    test_user = User(
        user_id="test-new-user-id",
        email="driver@optiride.com",
        user_type="driver",
        phone_number="+1234567890",
    )
    mock_query = db_session.query.return_value
    mock_filter = mock_query.filter.return_value
    mock_filter.first.return_value = test_user
    
    with patch("app.routers.driver.DriverService") as mock_ds:
        mock_service_instance = MagicMock()
        mock_ds.return_value = mock_service_instance
        
        mock_service_instance.get_driver_by_id.return_value = create_mock_driver("target-driver-id", "test-new-user-id", "Driver Name")
        
        response = client.get("/drivers/target-driver-id")
        assert response.status_code == 200
        data = response.json()
        assert data["driver_id"] == "target-driver-id"
        assert data["status"] == "available"
