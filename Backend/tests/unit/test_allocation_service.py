import pytest
from app.services.allocation_service import AllocationService
from app.models.zone import Zone
from geoalchemy2.elements import WKTElement

class MockDriver:
    def __init__(self, d_id, fatigue=0.0, battery=100, lat=None, lon=None):
        self.driver_id = d_id
        self.fatigue_score = fatigue
        self.battery_level = battery
        
        if lat is not None and lon is not None:
             self.location = WKTElement(f'POINT({lon} {lat})', srid=4326)
        else:
             self.location = None

class TestAllocationService:

    def test_tc_alloc_003_route_optimization_math(self):
        lat1, lon1 = 25.0805, 55.1403
        lat2, lon2 = 25.1972, 55.2744
        
        minutes = AllocationService._calculate_haversine_distance(lat1, lon1, lat2, lon2)
        assert 23.0 < minutes < 27.0
        
        minutes_zero = AllocationService._calculate_haversine_distance(lat1, lon1, lat1, lon1)
        assert minutes_zero == 0.0

    def test_tc_alloc_004_compute_driver_budget(self):
        service = AllocationService(db=None)
        
        zone_A = Zone(zone_id="A")
        zone_B = Zone(zone_id="B")
        zones = [zone_A, zone_B]
        
        zone_demand = {"A": 80.0, "B": 20.0}
        total_demand = 100.0
        total_drivers = 10
        
        budget = service._compute_driver_budget(zones, zone_demand, total_demand, total_drivers)
        
        assert budget["A"] == 7
        assert budget["B"] == 3
        assert sum(budget.values()) == 10

    def test_tc_alloc_005_assignment_with_no_available_drivers_math(self):
        service = AllocationService(db=None)
        
        assignments_no_drivers = service._assign_drivers_to_zones_optimized(drivers=[], zone_slots=[Zone(zone_id="A")])
        assert assignments_no_drivers == []
        
        assignments_no_zones = service._assign_drivers_to_zones_optimized(drivers=[MockDriver("d1")], zone_slots=[])
        assert assignments_no_zones == []

    def test_calculate_driver_penalties(self):
        service = AllocationService(db=None)
        
        # Fresh driver
        driver1 = MockDriver("d1", fatigue=0.0, battery=100)
        penalty1 = service._calculate_driver_penalties(driver1)
        assert penalty1 == 0.0
        
        # High fatigue (> 0.65)
        driver2 = MockDriver("d2", fatigue=0.7, battery=100)
        penalty2 = service._calculate_driver_penalties(driver2)
        assert penalty2 == 60.0
        
        # Low battery (< 20)
        driver3 = MockDriver("d3", fatigue=0.0, battery=15)
        penalty3 = service._calculate_driver_penalties(driver3)
        assert penalty3 == 30.0
        
        # Both (Should stack penalties)
        driver4 = MockDriver("d4", fatigue=0.8, battery=10)
        penalty4 = service._calculate_driver_penalties(driver4)
        assert penalty4 == 90.0
        
        # Mid fatigue (> 0.4, <= 0.65)
        driver5 = MockDriver("d5", fatigue=0.5, battery=100)
        penalty5 = service._calculate_driver_penalties(driver5)
        assert penalty5 == (0.5 * 50) # 25.0

    def test_get_travel_time_fallback(self):
        service = AllocationService(db=None)
        
        driver = MockDriver("d1") # No location
        zone = Zone(zone_id="z1", centroid=None)
        
        # Missing location returns 999.0
        assert service._get_travel_time(driver, zone) == 999.0
        
        driver_loc = MockDriver("d2", lat=25.0, lon=55.0)
        zone_loc = Zone(zone_id="z2", centroid=WKTElement('POINT(55.1 25.1)', srid=4326))
        
        # Valid location successfully calls haversine calculation
        time = service._get_travel_time(driver_loc, zone_loc)
        assert time < 999.0
