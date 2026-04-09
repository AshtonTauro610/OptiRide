import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from app.services.allocation_service import AllocationService
from app.schemas.driver import DriverStatus, DutyStatus
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

@pytest.mark.asyncio
async def test_tc_na_001_surge_notification_triggered(db_session):
    # Setup: 1 zone with high demand, 1 available driver nearby
    service = AllocationService(db_session)
    
    mock_zone = MagicMock()
    mock_zone.zone_id = "zone_A"
    mock_zone.name = "Zone A"
    mock_zone.demand_score = 0.9
    mock_zone.centroid = from_shape(Point(55.2708, 25.2048))
    
    # Mocking zone stats to trigger surge (pressure > 3.0)
    zone_stats = {
        "zone_A": {
            "zone_id": "zone_A",
            "demand_pressure": 5.0,
            "pending_orders": 10,
            "available_drivers": 1
        }
    }
    
    mock_driver = MagicMock()
    mock_driver.driver_id = "driver_1"
    mock_driver.status = DriverStatus.AVAILABLE.value
    mock_driver.duty_status = DutyStatus.ON_DUTY.value
    mock_driver.location = from_shape(Point(55.2710, 25.2050))
    # Explicitly set numerical values to avoid MagicMock comparison errors
    mock_driver.fatigue_score = 0.2
    mock_driver.battery_level = 80
    
    mock_query = MagicMock()
    db_session.query.return_value = mock_query
    mock_query.filter.return_value.all.side_effect = [
        [mock_driver],  # all_on_duty query (for notifications)
        [mock_driver],  # surplus_zones query (drivers in zone)
        []              # unzoned drivers
    ]
    mock_query.all.return_value = [mock_zone]
    
    with patch("app.services.allocation_service.socket_manager") as mock_socket_mgr, \
         patch("app.services.allocation_service.emit_sync"), \
         patch("app.services.allocation_service.kafka_producer") as mock_kafka, \
         patch("app.services.allocation_service.to_shape") as mock_to_shape:
        
        mock_to_shape.side_effect = lambda x: Point(55.27, 25.2)
        service._get_zone_stats = MagicMock(return_value=zone_stats)
        
        service.reallocation()
        
        # Verify TC-NA-001: Verification of surge alert emission
        assert mock_socket_mgr.notify_surge_alert.called

@pytest.mark.asyncio
async def test_tc_na_002_no_notification_when_busy(db_session):
    service = AllocationService(db_session)
    
    mock_zone = MagicMock()
    mock_zone.zone_id = "zone_A"
    mock_zone.name = "Zone A"
    mock_zone.centroid = from_shape(Point(55.2708, 25.2048))
    
    zone_stats = {
        "zone_A": { "zone_id": "zone_A", "demand_pressure": 5.0, "pending_orders": 10, "available_drivers": 0 }
    }
    
    mock_driver = MagicMock()
    mock_driver.driver_id = "driver_busy"
    mock_driver.status = DriverStatus.BUSY.value
    mock_driver.duty_status = DutyStatus.ON_DUTY.value
    mock_driver.location = from_shape(Point(55.2710, 25.2050))
    mock_driver.fatigue_score = 0.1
    mock_driver.battery_level = 90
    
    mock_query = MagicMock()
    db_session.query.return_value = mock_query
    mock_query.filter.return_value.all.side_effect = [
        [mock_driver], [], []
    ]
    mock_query.all.return_value = [mock_zone]
    
    with patch("app.services.allocation_service.socket_manager") as mock_socket_mgr, \
         patch("app.services.allocation_service.emit_sync"):
        
        service._get_zone_stats = MagicMock(return_value=zone_stats)
        service.reallocation()
        
        mock_socket_mgr.notify_surge_alert.assert_not_called()
