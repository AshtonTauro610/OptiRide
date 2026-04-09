import pytest
from unittest.mock import MagicMock, patch

def test_tc_alloc_001_zone_clustering(client, db_session):
    with patch("app.routers.allocation.ZoneClusteringService") as mock_clustering:
        mock_instance = MagicMock()
        mock_instance.generate_zones.return_value = {
            "status": "success",
            "zones_created": 5,
            "message": "Clustering complete"
        }
        mock_clustering.return_value = mock_instance
        
        response = client.post("/allocation/zones/recalculate")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["zones_created"] == 5

def test_tc_alloc_002_zone_change_update(client, db_session):
    with patch("app.routers.allocation.AllocationService") as mock_alloc:
        mock_instance = MagicMock()
        mock_instance.manual_allocation.return_value = {
            "status": "ok",
            "message": "Driver allocated to zone"
        }
        mock_alloc.return_value = mock_instance
        
        payload = {
            "driver_id": "driver-123",
            "zone_id": "zone-A"
        }
        
        response = client.post("/allocation/manual", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        mock_instance.manual_allocation.assert_called_once_with("driver-123", "zone-A")

def test_tc_alloc_004_driver_reallocation_surge(client, db_session):
    with patch("app.routers.allocation.AllocationService") as mock_alloc:
        mock_instance = MagicMock()
        mock_instance.reallocation.return_value = {
            "status": "ok",
            "drivers_reallocated": 3,
            "surge_zones": ["zone-High-Demand"],
            "allocations": [{"driver_id": "d1", "zone_id": "zone-High-Demand"}]
        }
        mock_alloc.return_value = mock_instance
        
        response = client.post("/allocation/reallocate")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "zone-High-Demand" in data["surge_zones"]
        assert data["drivers_reallocated"] == 3

def test_tc_alloc_005_assignment_with_no_available_drivers_initial(client, db_session):
    with patch("app.routers.allocation.AllocationService") as mock_alloc:
        mock_instance = MagicMock()
        mock_instance.initial_allocation.return_value = {
            "status": "skipped",
            "message": "No allocatable drivers found"
        }
        mock_alloc.return_value = mock_instance
        
        response = client.post("/allocation/initial")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "skipped"
        assert data["message"] == "No allocatable drivers found"

def test_tc_alloc_005_assignment_with_no_available_drivers_single(client, db_session):
    with patch("app.routers.allocation.AllocationService") as mock_alloc:
        mock_instance = MagicMock()
        mock_instance.allocate_driver.return_value = {
            "status": "skipped",
            "message": "Driver is not available"
        }
        mock_alloc.return_value = mock_instance
        
        response = client.post("/allocation/drivers/busy-driver/reallocate")
        
        # When single allocations return 'skipped', the router raises an HTTPException 400
        assert response.status_code == 400
        assert response.json()["detail"] == "Driver is not available"
