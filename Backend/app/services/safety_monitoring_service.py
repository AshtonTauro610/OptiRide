from geoalchemy2.shape import to_shape
import asyncio
import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import logging
import math
import os
import numpy as np
import base64
import os
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Tuple
import sys

# Silence MediaPipe/TF logs as early as possible
os.environ['GLOG_minloglevel'] = '2'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
from sqlalchemy.orm import Session
from sqlalchemy import func
import logging
import math
from geoalchemy2.functions import ST_Distance, ST_MakePoint, ST_SetSRID
from geoalchemy2.elements import WKTElement
from app.models.sensor_record import SensorRecord
from app.models.alert import Alert
from app.models.driver import Driver
from app.models.order import Order
from app.services.order_service import OrderService
from app.services.driver_service import DriverService
from app.schemas.driver import DriverStatus
import asyncio
from ml.crash_fall_detection import RiskDetectionEngine
from app.schemas.sensor import (
    SensorDataBatch, FatigueAnalysisResult, MovementAnalysisResult, 
    AccelerometerData, GyroscopeData
)
from app.schemas.alert import AlertCreate, AlertType, AlertSeverity
from app.services.genai_service import GenAIService
from app.core.kafka import kafka_producer
from app.core.socket_manager import socket_manager, emit_sync
import redis
from app.core.redis_client import redis_client

logger = logging.getLogger(__name__)
EMERGENCY_KEY_PREFIX = "emergency_active:"

class SafetyMonitoringService:
    _risk_engine: Optional[RiskDetectionEngine] = None
    _face_mesh: Any = None


    def __init__(self, db: Session):
        self.db = db
        self.HARSH_BRAKING_THRESHOLD = -8.0
        self.HARSH_ACCELERATION_THRESHOLD = 5.0
        self.SHARP_TURN_THRESHOLD = 2.5
        self.SUDDEN_IMPACT_THRESHOLD = 15.0
        self.NORMAL_BLINK_RATE = 15
        self.DROWSY_BLINK_RATE = 8
        self.HEAD_TILT_THRESHOLD = 20
        self.SPEED_LIMIT_KMH = 100
        self.risk_engine = SafetyMonitoringService._risk_engine
        # Fatigue Thresholds
        self.HEAD_TILT_THRESHOLD = 20.0
        self.YAWN_MAR_THRESHOLD = 0.6  # Mouth Aspect Ratio
        self.DROWSY_EAR_THRESHOLD = 0.22  # Eye Aspect Ratio (below this means eyes are closed/drowsy)
        
        self.load_models()
    
    def load_models(self):
        if SafetyMonitoringService._face_mesh and SafetyMonitoringService._risk_engine:
            self.face_mesh = SafetyMonitoringService._face_mesh
            self.risk_engine = SafetyMonitoringService._risk_engine
            return

        try:
            model_path = os.path.join(os.path.dirname(__file__), '..', '..', 'ml', 'face_landmarker.task')
            base_options = python.BaseOptions(model_asset_path=os.path.abspath(model_path))
            options = vision.FaceLandmarkerOptions(
                base_options=base_options,
                num_faces=1,
                min_face_detection_confidence=0.5,
                min_face_presence_confidence=0.5,
                min_tracking_confidence=0.5
            )
            SafetyMonitoringService._face_mesh = vision.FaceLandmarker.create_from_options(options)
            self.face_mesh = SafetyMonitoringService._face_mesh
            
            self._load_risk_engine()
            # self.risk_engine is set inside _load_risk_engine
            
            logger.info("Safety models initialized (Singleton).")
        except Exception as e:
            logger.error(f"Error loading models: {e}")
            self.face_mesh = None

    def calculate_distance(self, p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
        """Euclidean distance between two points."""
        return math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)

    def calculate_tilt(self, p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
        """Calculates angle of line between two points relative to horizontal."""
        delta_y = p2[1] - p1[1]
        delta_x = p2[0] - p1[0]
        return math.degrees(math.atan2(delta_y, delta_x))

    def calculate_ear(self, eye_landmarks, w: int, h: int) -> float:
        """Calculates Eye Aspect Ratio (EAR) for a single eye."""
        pts = [(int(pt.x * w), int(pt.y * h)) for pt in eye_landmarks]
        
        dist_v1 = self.calculate_distance(pts[1], pts[5])
        dist_v2 = self.calculate_distance(pts[2], pts[4])
        dist_h = self.calculate_distance(pts[0], pts[3])
        
        if dist_h == 0:
            return 0.0
        return (dist_v1 + dist_v2) / (2.0 * dist_h)

    def _load_risk_engine(self):
        if SafetyMonitoringService._risk_engine is not None:
            self.risk_engine = SafetyMonitoringService._risk_engine
            return

        try:
            risk_engine = RiskDetectionEngine()
            this_dir = os.path.dirname(os.path.abspath(__file__))
            model_dir = os.path.join(this_dir, "..", "..", "ml", "models")
            risk_engine.load_models(model_dir)
            SafetyMonitoringService._risk_engine = risk_engine
            self.risk_engine = risk_engine
        except Exception as e:
            logger.warning(f"RiskDetectionEngine load failed: {e}")
            self.risk_engine = None

    def _build_risk_feature_row(
        self,
        batch: SensorDataBatch,
        movement_result: MovementAnalysisResult,
    ) -> Dict[str, Any]:
        accel_mags = [math.sqrt(a.x**2 + a.y**2 + a.z**2) for a in batch.accelerometer_data]
        gyro_mags = [math.sqrt(g.x**2 + g.y**2 + g.z**2) for g in batch.gyroscope_data]
        
        if not accel_mags:
            return {}

        # Find the most "alarming" index in the batch (highest acceleration)
        peak_idx = int(np.argmax(accel_mags))
        
        # Extract features around this peak (up to 5 samples including the peak)
        window_start = max(0, peak_idx - 4)
        window_end = peak_idx + 1
        window_accel = accel_mags[window_start:window_end]
        window_gyro = gyro_mags[window_start:window_end]

        row = {
            "driver_id": batch.driver_id,
            "recorded_at": batch.location_data.timestamp,
            "acceleration_magnitude": accel_mags[peak_idx],
            "angular_velocity_magnitude": gyro_mags[peak_idx],
            "speed": batch.location_data.speed or 0.0,
            "harsh_braking": int(movement_result.harsh_braking),
            "harsh_acceleration": int(movement_result.harsh_acceleration),
            "sharp_turn": int(movement_result.sharp_turn),
            "sudden_impact": int(movement_result.sudden_impact),
            # Rolling features around the peak
            "acceleration_magnitude_mean_5": sum(window_accel) / len(window_accel),
            "acceleration_magnitude_max_5": max(window_accel),
            "acceleration_magnitude_std_5": np.std(window_accel) if len(window_accel) > 1 else 0.0,
            "angular_velocity_magnitude_mean_5": sum(window_gyro) / len(window_gyro),
            "angular_velocity_magnitude_max_5": max(window_gyro),
            "angular_velocity_magnitude_std_5": np.std(window_gyro) if len(window_gyro) > 1 else 0.0,
            "speed_mean_5": batch.location_data.speed or 0.0,
            "speed_std_5": 0.0,
        }
        return row
    
    def detect_head_tilt(self, face_landmarks, w: int, h: int) -> float:
        pt_left_eye = face_landmarks.landmark[468] 
        pt_right_eye = face_landmarks.landmark[473]

        p1_px = (pt_left_eye.x * w, pt_left_eye.y * h)
        p2_px = (pt_right_eye.x * w, pt_right_eye.y * h)

        return abs(self.calculate_tilt(p1_px, p2_px))

    def _predict_risk(
        self,
        batch: SensorDataBatch,
        movement_result: MovementAnalysisResult,
    ) -> Dict[str, Any]:
        if self.risk_engine is None:
            return {
                "crash_probability": 0.0,
                "crash_action": "LOG/OBSERVE",
                "crash_fuzzy": 0.0,
                "fall_probability": 0.0,
                "fall_action": "LOG/OBSERVE",
                "fall_fuzzy": 0.0,
            }

        risk_row = self._build_risk_feature_row(batch, movement_result)
        return self.risk_engine.predict_row(risk_row)

    def detect_yawn(self, face_landmarks, w: int, h: int) -> bool:
        up_px = (face_landmarks.landmark[13].x * w, face_landmarks.landmark[13].y * h)
        low_px = (face_landmarks.landmark[14].x * w, face_landmarks.landmark[14].y * h)
        left_px = (face_landmarks.landmark[61].x * w, face_landmarks.landmark[61].y * h)
        right_px = (face_landmarks.landmark[291].x * w, face_landmarks.landmark[291].y * h)

        vert_dist = self.calculate_distance(up_px, low_px)
        horz_dist = self.calculate_distance(left_px, right_px)

        ratio = 0.0 if horz_dist == 0 else (vert_dist / horz_dist)
        return ratio > self.YAWN_MAR_THRESHOLD

    def get_avg_ear(self, face_landmarks, w: int, h: int) -> float:
        left_eye_indices = [33, 160, 158, 133, 153, 144]
        left_eye_pts = [face_landmarks.landmark[i] for i in left_eye_indices]
        left_ear = self.calculate_ear(left_eye_pts, w, h)

        right_eye_indices = [362, 385, 387, 263, 373, 380]
        right_eye_pts = [face_landmarks.landmark[i] for i in right_eye_indices]
        right_ear = self.calculate_ear(right_eye_pts, w, h)

        return (left_ear + right_ear) / 2.0

    def estimate_fatigue_score(self, avg_ear: float, head_tilt: float, yawn_detected: bool) -> float:
        score = 0.0
        # EAR Mapping (normal > 0.28 = 0 penalty, drowsy < 0.15 = 0.6 penalty)
        if avg_ear < 0.28:
            if avg_ear <= 0.15:
                score += 0.6
            else:
                score += 0.6 * ((0.28 - avg_ear) / (0.28 - 0.15))
        # Head Tilt Mapping (normal < 10 degrees = 0 penalty, severe > 25 degrees = 0.4 penalty)
        if head_tilt > 10.0:
            if head_tilt >= 25.0:
                score += 0.4
            else:
                score += 0.4 * ((head_tilt - 10.0) / (25.0 - 10.0))

        if yawn_detected:
            score += 0.2

        logger.info(f"Fatigue score calculation -> Total: {score:.2f} | EAR: {avg_ear:.3f}, Head Tilt: {head_tilt:.1f}deg, Yawn: {yawn_detected}")
        return min(score, 1.0)
    
    def process_sensor_data_batch(self, batch: SensorDataBatch, background_tasks=None) -> Dict[str, Any]:
        results = {
            "driver_id": batch.driver_id,
            "session_id": batch.session_id,
            "timestamp": datetime.utcnow(),
            "fatigue_analysis": None,
            "movement_analysis": None,
            "risk_analysis": None,
            "alerts": [],
            "record_id" : None
        }

        movement_analysis = self.analyze_movement(
            batch.accelerometer_data, 
            batch.gyroscope_data
        )
        results["movement_analysis"] = movement_analysis

        if batch.camera_frame_data:
            fatigue_analysis = self.analyze_fatigue(
                batch.camera_frame_data.frame_data
            )
            results["fatigue_analysis"] = fatigue_analysis
        else:
            fatigue_analysis = self.fatigue_analysis_from_movement(
                batch.accelerometer_data,
                batch.gyroscope_data
            )
            results["fatigue_analysis"] = fatigue_analysis

        risk_analysis = self._predict_risk(batch, movement_analysis)
        results["risk_analysis"] = risk_analysis
        
        record = self.store_sensor_record(batch, results)
        results["record_id"] = record.record_id

        alerts = self.generate_alerts(
            batch.driver_id,
            fatigue_analysis,
            movement_analysis,
            batch.location_data,
            risk_analysis,
            background_tasks
        )
        results["alerts"] = alerts

        # 1. Update driver's live fatigue score in DB
        driver = self.db.query(Driver).filter(Driver.driver_id == batch.driver_id).first()
        if driver and fatigue_analysis:
            driver.fatigue_score = fatigue_analysis.fatigue_score
            self.db.commit()

        # 2. Enforce automated break actions on critical fatigue
        if fatigue_analysis.alert_level == "critical":
            self.enforce_fatigue_break(batch.driver_id, batch.location_data)

        # 3. Integrate GenAI Safety Insights
        safety_data = {
            "driver_id": batch.driver_id,
            "fatigue_score": fatigue_analysis.fatigue_score,
            "fatigue_alert_level": fatigue_analysis.alert_level,
            "harsh_braking": movement_analysis.harsh_braking,
            "harsh_acceleration": movement_analysis.harsh_acceleration,
            "sharp_turn": movement_analysis.sharp_turn,
            "sudden_impact": movement_analysis.sudden_impact,
            "movement_risk_level": movement_analysis.risk_level,
            "speed": batch.location_data.speed if batch.location_data else 0,
        }
        results["genai_insights"] = GenAIService.generate_safety_insights(safety_data)

        return results
    
    def analyze_fatigue(self, frame_data: str) -> FatigueAnalysisResult:
        try:
            image_data = base64.b64decode(frame_data)
            np_arr = np.frombuffer(image_data, np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

            if frame is None:
                raise ValueError("Decoded frame is None")

            img_h, img_w, _ = frame.shape
            rgb_image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            if not self.face_mesh:
                raise ValueError("MediaPipe Face Mesh is not initialized")

            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_image)
            mp_results = self.face_mesh.detect(mp_image)

            if not mp_results.face_landmarks:
                return FatigueAnalysisResult(
                    fatigue_score=0.0,
                    eye_blink_rate=0.0,
                    yawn_detected=False,
                    head_tilt_rate=0.0,
                    recommendation="No face detected. Please ensure proper camera placement.",
                    alert_level="none"
                )
            
            class FaceLandmarksWrapper:
                def __init__(self, landmarks_list):
                    self.landmark = landmarks_list
                    
            face_landmarks = FaceLandmarksWrapper(mp_results.face_landmarks[0])

            avg_ear = self.get_avg_ear(face_landmarks, img_w, img_h)
            head_tilt = self.detect_head_tilt(face_landmarks, img_w, img_h)
            yawn_detected = self.detect_yawn(face_landmarks, img_w, img_h)

            fatigue_score = self.estimate_fatigue_score(avg_ear, head_tilt, yawn_detected)

            if fatigue_score >= 0.8:
                recommendation = "Critical fatigue detected! You have been placed on break and your active order was unassigned."
                alert_level = "critical"
            elif fatigue_score >= 0.65:
                recommendation = "Moderate fatigue detected. Consider taking a short break."
                alert_level = "warning"
            else:
                recommendation = "No fatigue detected. Driver is alert."
                alert_level = "none"
            
            simulated_blink_rate = 8.0 if avg_ear < self.DROWSY_EAR_THRESHOLD else 15.0
            
            logger.info(f"Fatigue Analysis - Score: {fatigue_score:.2f}, Avg EAR: {avg_ear:.3f}, Head Tilt: {head_tilt:.1f}deg, Yawn: {yawn_detected}")
            
            return FatigueAnalysisResult(
                fatigue_score=fatigue_score,
                eye_blink_rate=simulated_blink_rate,
                yawn_detected=yawn_detected,
                head_tilt_rate=head_tilt,
                recommendation=recommendation,
                alert_level=alert_level
            )

        except Exception as e:
            logger.error(f"Error in fatigue analysis: {e}")
            return FatigueAnalysisResult(
                fatigue_score=0.0,
                eye_blink_rate=0.0,
                yawn_detected=False,
                head_tilt_rate=0.0,
                recommendation="Error in processing frame data.",
                alert_level="none"
            )
        
    def enforce_fatigue_break(self, driver_id: str, location_data):
        try:
            driver_service = DriverService(self.db)
            driver = driver_service.get_driver_by_id(driver_id)
            if driver and driver.status != DriverStatus.ON_BREAK.value:
                driver.status = DriverStatus.ON_BREAK.value
                driver.breaks += 1
                self.db.commit()
            order_service = OrderService(self.db)
            active_orders = self.db.query(Order).filter(
                Order.driver_id == driver_id,
                Order.status.in_(["assigned", "offered", "picked_up"])
            ).all()

            for order in active_orders:
                logger.info(f"Unassigning order {order.order_id} from driver {driver_id} due to critical fatigue.")
                if order.status in ["assigned", "offered"]:
                    order.status = "pending"
                    order.driver_id = None
                    order.pickup_time = None
                    order.dropoff_time = None
                    self.db.commit()
                    try:
                        order_service.auto_assign_order(order.order_id)
                    except Exception as e:
                        logger.error(f"Failed to auto-reassign order {order.order_id}: {e}")
                elif order.status == "picked_up":
                    order.pickup_latitude = location_data.latitude if location_data else 0.0
                    order.pickup_longitude = location_data.longitude if location_data else 0.0
                    order.pickup_address = "EMERGENCY RETRIEVAL: Fatigued Driver"
                    order.pickup = WKTElement(f'POINT({order.pickup_longitude} {order.pickup_latitude})', srid=4326)
                    order.status = "pending"
                    order.driver_id = None
                    self.db.commit()

                    nearby_drivers = order_service._get_drivers_with_capacity(
                        latitude=order.pickup_latitude,
                        longitude=order.pickup_longitude,
                        radius_km=15.0,
                        limit=1,
                        exclude_driver_ids=[driver_id]
                    )

                    if nearby_drivers:
                        rescue_driver = nearby_drivers[0]
                        from app.services.routing_service import RoutingEngine
                        routing_engine = RoutingEngine(self.db)
                        routing_engine.dispatch(rescue_driver.driver_id, [order.order_id], is_emergency=True)
                        emit_sync(socket_manager.notify_driver_status_change(
                            rescue_driver.driver_id,
                            "EMERGENCY_DISPATCH"
                        ))

            emit_sync(socket_manager.notify_safety_alert(driver_id, {
                "type": "FATIGUE_BREAK_ENFORCED",
                "message": "Critical fatigue has been detected. For your safety, you have been placed on break and your active orders were unassigned.",
                "timeout_seconds": 0
            }))

            logger.info(f"Successfully enforced fatigue break on driver {driver_id}")
        except Exception as e:
            logger.error(f"Failed to enforce fatigue break for driver {driver_id}: {e}")

    def fatigue_analysis_from_movement(self, 
        accelerometer_data: list, 
        gyroscope_data: list
    ) -> FatigueAnalysisResult:
        if len(accelerometer_data) < 5:
            return FatigueAnalysisResult(
                fatigue_score=0.0,
                eye_blink_rate=0.0,
                yawn_detected=False,
                head_tilt_rate=0.0,
                recommendation="Insufficient data for fatigue analysis.",
                alert_level="none"
            )
        
        accel_magnitudes = [
            math.sqrt(a.x**2 + a.y**2 + a.z**2) for a in accelerometer_data
        ]

        variance = np.var(accel_magnitudes)

        if variance > 5.0:
            fatigue_score = 0.6
            recommendation = "Moderate fatigue detected from movement patterns."
            alert_level = "warning"
        else:
            fatigue_score = 0.2
            recommendation = "No significant fatigue detected from movement patterns."
            alert_level = "none"
        
        return FatigueAnalysisResult(
            fatigue_score=fatigue_score,
            eye_blink_rate=15.0,
            yawn_detected=False,
            head_tilt_rate=0.0,
            recommendation=recommendation,
            alert_level=alert_level
        )
    
    def analyze_movement(self, 
        accelerometer_data: list, 
        gyroscope_data: list
    ) -> MovementAnalysisResult:
        if not accelerometer_data or not gyroscope_data:
            return MovementAnalysisResult(
                harsh_braking=False,
                harsh_acceleration=False,
                sharp_turn=False,
                sudden_impact=False,
                risk_level="low",
                description="Insufficient data for movement analysis."
            )
        
        latest_accel = accelerometer_data[-1]
        latest_gyro = gyroscope_data[-1]

        # Check for peaks in the entire batch, not just the latest sample
        harsh_braking = any(a.x < self.HARSH_BRAKING_THRESHOLD for a in accelerometer_data)
        harsh_acceleration = any(a.x > self.HARSH_ACCELERATION_THRESHOLD for a in accelerometer_data)

        def get_gyro_mag(g):
            return math.sqrt(g.x**2 + g.y**2 + g.z**2)

        sharp_turn = any(get_gyro_mag(g) > self.SHARP_TURN_THRESHOLD for g in gyroscope_data)

        sudden_impact = any(
            abs(a.x) > self.SUDDEN_IMPACT_THRESHOLD or
            abs(a.y) > self.SUDDEN_IMPACT_THRESHOLD or
            abs(a.z) > self.SUDDEN_IMPACT_THRESHOLD
            for a in accelerometer_data
        )

        events_count = sum([harsh_braking, harsh_acceleration, sharp_turn, sudden_impact])

        if sudden_impact:
            risk_level = "high"
            description = "Sudden impact detected."
        elif events_count >= 2:
            risk_level = "high"
            description = "Multiple harsh driving events detected."
        elif events_count == 1:
            risk_level = "medium"
            if harsh_braking:
                description = "Harsh braking detected."
            elif harsh_acceleration:
                description = "Harsh acceleration detected."
            elif sharp_turn:
                description = "Sharp turn detected."
        else:
            risk_level = "low"
            description = "No significant harsh driving events detected."
        
        return MovementAnalysisResult(
            harsh_braking=harsh_braking,
            harsh_acceleration=harsh_acceleration,
            sharp_turn=sharp_turn,
            sudden_impact=sudden_impact,
            risk_level=risk_level,
            description=description
        )
    
    def store_sensor_record(self, batch: SensorDataBatch, results: Dict[str, Any]) -> SensorRecord:
        movement_result = results["movement_analysis"]
        fatigue_result = results["fatigue_analysis"]

        avg_accel = self.calculate_average_acceleration(batch.accelerometer_data)
        avg_gyro = self.calculate_average_gyroscope(batch.gyroscope_data)

        accel_magnitude = math.sqrt(
            avg_accel.x**2 + avg_accel.y**2 + avg_accel.z**2
        )
        gyro_magnitude = math.sqrt(
            avg_gyro.x**2 + avg_gyro.y**2 + avg_gyro.z**2
        )

        record = SensorRecord(
            driver_id=batch.driver_id,
            accelerometer_x=avg_accel.x,
            accelerometer_y=avg_accel.y,
            accelerometer_z=avg_accel.z,
            acceleration_magnitude=accel_magnitude,
            gyroscope_x=avg_gyro.x,
            gyroscope_y=avg_gyro.y,
            gyroscope_z=avg_gyro.z,
            angular_velocity_magnitude=gyro_magnitude,
            fatigue_score=fatigue_result.fatigue_score,
            eye_blink_rate=fatigue_result.eye_blink_rate,
            yawn_detected=fatigue_result.yawn_detected,
            head_tilt_rate=fatigue_result.head_tilt_rate,
            harsh_braking=movement_result.harsh_braking,
            harsh_acceleration=movement_result.harsh_acceleration,
            sharp_turn=movement_result.sharp_turn,
            sudden_impact=movement_result.sudden_impact,
            latitude=batch.location_data.latitude,
            longitude=batch.location_data.longitude,
            speed=batch.location_data.speed,
            recorded_at=batch.location_data.timestamp,
            processed_at=datetime.utcnow()
        )
        
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)

        return record

    def calculate_average_acceleration(self, data: list) -> AccelerometerData:
        if not data:
            return AccelerometerData(x=0.0, y=0.0, z=0.0, timestamp=datetime.utcnow())
        n = len(data)
        sum_x = sum(a.x for a in data)
        sum_y = sum(a.y for a in data)
        sum_z = sum(a.z for a in data)

        return AccelerometerData(
            x=sum_x / n,
            y=sum_y / n,
            z=sum_z / n,
            timestamp=datetime.utcnow()
        )
    
    def calculate_average_gyroscope(self, data: list) -> GyroscopeData:
        if not data:
            return GyroscopeData(x=0.0, y=0.0, z=0.0, timestamp=datetime.utcnow())
        n = len(data)
        sum_x = sum(g.x for g in data)
        sum_y = sum(g.y for g in data)
        sum_z = sum(g.z for g in data)

        return GyroscopeData(
            x=sum_x / n,
            y=sum_y / n,
            z=sum_z / n,
            timestamp=datetime.utcnow()
        )
    
    def generate_alerts(self, driver_id: str, fatigue_result: FatigueAnalysisResult,
        movement_result: MovementAnalysisResult, location_data, risk_result: Optional[Dict[str, Any]] = None, background_tasks = None) -> list:

        alerts = []
        if fatigue_result.alert_level == "critical":
            alert = Alert(
                driver_id=driver_id,
                alert_type=AlertType.FATIGUE.value,
                severity=AlertSeverity.CRITICAL.value,
                location= WKTElement(f'POINT({location_data.longitude} {location_data.latitude})', srid=4326),
                acknowledged=False
            )
            
            self.db.add(alert)
            alerts.append(alert)
        elif fatigue_result.alert_level == "warning":
            alert = Alert(
                driver_id=driver_id,
                alert_type=AlertType.FATIGUE.value,
                severity=AlertSeverity.WARNING.value,
                location= WKTElement(f'POINT({location_data.longitude} {location_data.latitude})', srid=4326),
                acknowledged=False
            )
            self.db.add(alert)
            alerts.append(alert)
        
        if movement_result.sudden_impact:
            alert = Alert(
                driver_id=driver_id,
                alert_type=AlertType.ACCIDENT.value,
                severity=AlertSeverity.CRITICAL.value,
                location= WKTElement(f'POINT({location_data.longitude} {location_data.latitude})', srid=4326),
                acknowledged=False
            )
            self.db.add(alert)
            alerts.append(alert)

        crash_action = (risk_result or {}).get("crash_action", "LOG/OBSERVE")
        crash_prob = float((risk_result or {}).get("crash_probability", 0.0) or 0.0)
        if crash_action in {"ESCALATE", "WARN"} and not any(a.alert_type == AlertType.ACCIDENT.value for a in alerts):
            severity = AlertSeverity.CRITICAL.value if crash_action == "ESCALATE" or crash_prob >= 0.9 else AlertSeverity.WARNING.value
            alert = Alert(
                driver_id=driver_id,
                alert_type=AlertType.ACCIDENT.value,
                severity=severity,
                location=WKTElement(f'POINT({location_data.longitude} {location_data.latitude})', srid=4326),
                acknowledged=False
            )
            self.db.add(alert)
            alerts.append(alert)

        fall_action = (risk_result or {}).get("fall_action", "LOG/OBSERVE")
        if fall_action in {"ESCALATE", "WARN"}:
            severity = AlertSeverity.CRITICAL.value if fall_action == "ESCALATE" else AlertSeverity.WARNING.value
            alert = Alert(
                driver_id=driver_id,
                alert_type=AlertType.UNUSUAL_MOVEMENT.value,
                severity=severity,
                location=WKTElement(f'POINT({location_data.longitude} {location_data.latitude})', srid=4326),
                acknowledged=False
            )
            self.db.add(alert)
            alerts.append(alert)
        elif movement_result.risk_level == "high":
            alert = Alert(
                driver_id=driver_id,
                alert_type=AlertType.HARSH_BRAKING.value if movement_result.harsh_braking else AlertType.UNUSUAL_MOVEMENT.value,
                severity=AlertSeverity.WARNING.value,
                location= WKTElement(f'POINT({location_data.longitude} {location_data.latitude})', srid=4326),
                acknowledged=False
            )
            self.db.add(alert)
            alerts.append(alert)
        
        if location_data and location_data.speed and location_data.speed > self.SPEED_LIMIT_KMH:
            recent_alert = self.db.query(Alert).filter(
                Alert.driver_id == driver_id,
                Alert.alert_type == AlertType.SPEEDING.value,
                Alert.acknowledged == False
            ).first()
            if not recent_alert:
                alert = Alert(
                    driver_id=driver_id,
                    alert_type=AlertType.SPEEDING.value,
                    severity=AlertSeverity.WARNING.value,
                    location= WKTElement(f'POINT({location_data.longitude} {location_data.latitude})', srid=4326),
                    acknowledged=False
                )
                self.db.add(alert)
                alerts.append(alert) 
        
        if alerts:
            self.db.commit()

            for alert in alerts:
                kafka_producer.publish("safety-alerts", {
                    "alert_id": alert.alert_id,
                    "driver_id": alert.driver_id,
                    "alert_type": alert.alert_type,
                    "severity": alert.severity,
                    "latitude": location_data.latitude,
                    "longitude": location_data.longitude,
                    "acknowledged": alert.acknowledged,
                    "timestamp": str(datetime.now())
                })

        critical_alerts = [a for a in alerts if a.severity == AlertSeverity.CRITICAL.value 
                           or a.alert_type in {AlertType.ACCIDENT.value, AlertType.UNUSUAL_MOVEMENT.value}]
        
        logger.info(f"Generated {len(alerts)} alerts. Critical/Unusual: {len(critical_alerts)}")
        for a in critical_alerts:
            logger.info(f" - Critical Alert: {a.alert_type} (Severity: {a.severity})")
        
        if critical_alerts:
            primary_alert = critical_alerts[0]
            redis_key = f"{EMERGENCY_KEY_PREFIX}{driver_id}"
            
            # Always notify the frontend about the latest critical event
            title = "FALL DETECTED!" if primary_alert.alert_type == AlertType.UNUSUAL_MOVEMENT.value else "CRASH DETECTED!"
            message = "A fall has been detected." if primary_alert.alert_type == AlertType.UNUSUAL_MOVEMENT.value else "A crash has been detected."
            message += " Are you okay? Emergency services will be contacted in 60s if you don't respond."
            
            emit_sync(socket_manager.notify_safety_alert(driver_id, {
                "type" : "CRASH_DETECTED",
                "alert_type" : "CRITICAL_CRASH" if primary_alert.alert_type == AlertType.ACCIDENT.value else "FALL",
                "title": title,
                "message" : message,
                "timeout_seconds" : 60
            }))

            if not redis_client.get(redis_key):
                redis_client.setex(redis_key, 600, "ACTIVE") # 10 mins ttl
                if background_tasks:
                    background_tasks.add_task(self._emergency_countdown, driver_id, location_data.latitude, location_data.longitude, primary_alert.alert_type)
                else:
                    import threading
                    threading.Thread(target=lambda: asyncio.run(self._emergency_countdown(driver_id, location_data.latitude, location_data.longitude, primary_alert.alert_type))).start()
    
        return alerts
    
    async def _emergency_countdown(self, driver_id : str, lat: float, lng: float, alert_type: str = "ACCIDENT"):
        logger.info(f"Starting 60s emergency countdown for driver {driver_id} due to {alert_type}")
        
        await asyncio.sleep(60)

        redis_key = f"{EMERGENCY_KEY_PREFIX}{driver_id}"
        if redis_client.get(redis_key) == "ACTIVE":
            logger.error(f"Driver {driver_id} is unresponsive. Executing SOS protocol!")
            self.execute_sos_protocol(driver_id, lat, lng)
            redis_client.delete(redis_key)
        
    def execute_sos_protocol(self, driver_id: str, lat: float, lng: float):
        logger.critical(f"CALLING EMERGENCY SERVICES FOR DRIVER {driver_id} AT {lat}, {lng}")
        emit_sync(socket_manager.broadcast_to_zone("admin_dashboard", "emergency_dispatch", {
            "driver_id": driver_id,
            "latitude": lat,
            "longitude": lng,
            "message": "URGENT: Driver is unresponsive. Executing SOS protocol!"
        }))

        try:
            order_service = OrderService(self.db)
            order_service.handle_driver_emergency(driver_id, lat, lng)
        except Exception as e:
            logger.error(f"Failed to recover fleet during emergency: {e}")
    
    def resolve_emergency(self, driver_id: str, status: str):
        redis_key = f"{EMERGENCY_KEY_PREFIX}{driver_id}"
        if not redis_client.get(redis_key):
            return { "message" : "No active emergency found for this driver." }
        
        status = status.lower()
        if status in {"ok", "false_alarm"}:
            logger.info(f"Driver {driver_id} is responsive (status={status}). Resolving emergency.")
            redis_client.delete(redis_key)
            
            return { "message" : "Driver is responsive. Resolving emergency."}
        elif status in {"sos", "confirmed"}:
            logger.critical(f"Driver {driver_id} requested SOS (status={status}). Executing SOS protocol!")

            redis_client.delete(redis_key)
            driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
            lat, lng = (0.0, 0.0)

            if driver and driver.location:
                shape = to_shape(driver.location)
                lat, lng = shape.y, shape.x
            
            self.execute_sos_protocol(driver_id, lat, lng)
            return { "message" : "SOS protocol engaged immediately."}

    def train_risk_models(self, data_path: str = "ml/data/training_data.csv") -> Dict[str, Any]:
        if not os.path.exists(data_path):
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            data_path = os.path.join(base_dir, data_path)
            
        if not os.path.exists(data_path):
            return {"error": f"Data file not found at {data_path}"}
        
        if self.risk_engine is None:
            self.risk_engine = RiskDetectionEngine()

        try:
            results = self.risk_engine.train_from_csv(data_path)
            
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            model_dir = os.path.join(base_dir, "ml", "models")
            self.risk_engine.save_models(model_dir)
            
            self.risk_engine.load_models(model_dir)
            SafetyMonitoringService._risk_engine = self.risk_engine
            
            return {
                "status": "success",
                "samples_processed": len(results.get("scored_df", [])),
                "crash_metrics": results["crash"].get("metrics"),
                "fall_metrics": results["fall"].get("metrics")
            }
        except Exception as e:
            logger.error(f"Risk model training failed: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {"error": str(e)}