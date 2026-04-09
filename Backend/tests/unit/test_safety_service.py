import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime
from app.services.safety_monitoring_service import SafetyMonitoringService
from app.schemas.sensor import SensorDataBatch, LocationData, AccelerometerData, GyroscopeData, FatigueAnalysisResult, MovementAnalysisResult
from app.schemas.alert import AlertType, AlertSeverity
from app.models.driver import Driver
from app.models.alert import Alert

class TestSafetyService:

    def test_calculate_distance(self):
        service = SafetyMonitoringService(db=None)
        p1 = (0.0, 0.0)
        p2 = (3.0, 4.0)
        assert service.calculate_distance(p1, p2) == 5.0

    def test_estimate_fatigue_score(self):
        service = SafetyMonitoringService(db=None)
        
        # Alert state (EAR high, tilt low, no yawn)
        assert service.estimate_fatigue_score(0.3, 5.0, False) == 0.0
        
        # Partially fatigued (EAR mid)
        score_mid = service.estimate_fatigue_score(0.2, 5.0, False)
        assert 0.3 < score_mid < 0.5
        
        # Heavy fatigue (EAR low + yawn)
        score_high = service.estimate_fatigue_score(0.1, 5.0, True)
        assert score_high >= 0.8
        
        # Severe fatigue (All factors)
        score_max = service.estimate_fatigue_score(0.1, 30.0, True)
        assert score_max == 1.0

    def test_analyze_movement(self):
        service = SafetyMonitoringService(db=None)
        
        # Normal movement
        accel_normal = [AccelerometerData(x=1.0, y=0.0, z=9.8, timestamp=datetime.utcnow())]
        gyro_normal = [GyroscopeData(x=0.0, y=0.0, z=0.0, timestamp=datetime.utcnow())]
        res = service.analyze_movement(accel_normal, gyro_normal)
        assert res.risk_level == "low"
        
        # Harsh braking
        accel_brake = [AccelerometerData(x=-10.0, y=0.0, z=9.8, timestamp=datetime.utcnow())]
        res_brake = service.analyze_movement(accel_brake, gyro_normal)
        assert res_brake.harsh_braking is True
        
        # Sudden impact
        accel_impact = [AccelerometerData(x=20.0, y=0.0, z=9.8, timestamp=datetime.utcnow())]
        res_impact = service.analyze_movement(accel_impact, gyro_normal)
        assert res_impact.sudden_impact is True

    @patch("app.services.safety_monitoring_service.SafetyMonitoringService.calculate_ear")
    def test_get_avg_ear(self, mock_ear):
        service = SafetyMonitoringService(db=None)
        mock_ear.return_value = 0.25
        
        face_landmarks = MagicMock()
        face_landmarks.landmark = [MagicMock()] * 500
        
        ear = service.get_avg_ear(face_landmarks, 100, 100)
        assert ear == 0.25

    def test_generate_alerts_accident(self):
        mock_db = MagicMock()
        service = SafetyMonitoringService(mock_db)
        
        driver_id = "test-driver"
        mock_db.query.return_value.filter.return_value.first.return_value = None
        
        fatigue_res = FatigueAnalysisResult(fatigue_score=0.1, recommendation="Good", alert_level="none")
        move_res = MovementAnalysisResult(harsh_braking=False, harsh_acceleration=False, sharp_turn=False, sudden_impact=True, risk_level="high", description="CRASH")
        loc_data = LocationData(latitude=0, longitude=0, timestamp=datetime.utcnow())
        
        with patch("app.services.safety_monitoring_service.WKTElement"), \
             patch("app.services.safety_monitoring_service.emit_sync"), \
             patch("app.services.safety_monitoring_service.redis_client"):
            
            alerts = service.generate_alerts(driver_id, fatigue_res, move_res, loc_data)
            assert any(a.alert_type == AlertType.ACCIDENT.value for a in alerts)
