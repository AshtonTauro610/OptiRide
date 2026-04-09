import pytest
from unittest.mock import MagicMock
from fastapi import HTTPException
from app.services.driver_service import DriverService
from app.schemas.driver import DriverCreate, DriverUpdate, DriverStatus, DutyStatus

class TestDriverService:
    
    def test_get_fatigue_level(self):
        assert DriverService.get_fatigue_level(0.0, 0) == "NORMAL"
        assert DriverService.get_fatigue_level(0.64, 4) == "NORMAL"
        assert DriverService.get_fatigue_level(0.65, 0) == "WARNING"
        assert DriverService.get_fatigue_level(0.0, 5) == "WARNING"
        assert DriverService.get_fatigue_level(0.8, 0) == "SEVERE"
        assert DriverService.get_fatigue_level(0.0, 10) == "SEVERE"

    def test_calculate_safety_score(self):
        assert DriverService.calculate_safety_score() == 100.0
        score = DriverService.calculate_safety_score(heavy_deductions=1, speeding_events=1, harsh_braking_events=1)
        assert score == 80.0
        score = DriverService.calculate_safety_score(fatigue_score=0.7)
        assert score == 69.0
        score = DriverService.calculate_safety_score(heavy_deductions=10, speeding_events=10)
        assert score == 5.0 # Min floor

    def test_create_driver(self):
        mock_db = MagicMock()
        service = DriverService(mock_db)
        
        req = DriverCreate(user_id="u123", name="John", current_zone="North", vehicle_type="Car", license_plate="ABC")
        driver = service.create_driver(req)
        
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()
        assert driver.user_id == "u123"
        assert driver.status == "offline"

    def test_get_driver_by_id(self):
        mock_db = MagicMock()
        service = DriverService(mock_db)
        service.get_driver_by_id("d123")
        mock_db.query.return_value.filter.assert_called_once()

    def test_update_driver(self):
        mock_db = MagicMock()
        service = DriverService(mock_db)
        
        # Mock finding driver
        mock_driver = MagicMock()
        service.get_driver_by_id = MagicMock(return_value=mock_driver)
        
        update_data = DriverUpdate(user_id="u123", name="New Name", current_zone="South")
        driver = service.update_driver("d123", update_data)
        
        assert mock_driver.name == "New Name"
        assert mock_driver.current_zone == "South"
        mock_db.commit.assert_called_once()

    def test_update_driver_not_found(self):
        mock_db = MagicMock()
        service = DriverService(mock_db)
        service.get_driver_by_id = MagicMock(return_value=None)
        
        with pytest.raises(HTTPException) as exc:
            service.update_driver("d123", DriverUpdate(user_id="u123", name="tester"))
        assert exc.value.status_code == 404

    def test_update_status(self):
        mock_db = MagicMock()
        service = DriverService(mock_db)
        
        mock_driver = MagicMock()
        mock_driver.status = DriverStatus.OFFLINE.value
        service.get_driver_by_id = MagicMock(return_value=mock_driver)
        
        # Bypassing allocation component for unit test
        with pytest.MonkeyPatch.context() as m:
            m.setattr("app.services.driver_service.AllocationService", MagicMock())
            service.update_status("d123", DriverStatus.AVAILABLE)
            
        assert mock_driver.status == DriverStatus.AVAILABLE.value
        mock_db.commit.assert_called_once()
