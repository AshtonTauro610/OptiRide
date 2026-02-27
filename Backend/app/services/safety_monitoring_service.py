import cv2
import numpy as np
import base64
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func
import math
from geoalchemy2.functions import ST_Distance, ST_MakePoint, ST_SetSRID
from geoalchemy2.elements import WKTElement
from app.models.sensor_record import SensorRecord
from app.models.alert import Alert
from app.schemas.sensor import (
    SensorDataBatch, FatigueAnalysisResult, MovementAnalysisResult, 
    AccelerometerData, GyroscopeData
)
from app.schemas.alert import AlertCreate, AlertType, AlertSeverity
from app.services.genai_service import GenAIService
from app.core.kafka import kafka_producer

class SafetyMonitoringService:
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

        self.load_models()
    
    def load_models(self):
        try:
            self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            self.eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
            print("Models loaded successfully.")
        except Exception as e:
            print(f"Error loading models: {e}")
            self.face_cascade = None
            self.eye_cascade = None
    
    def process_sensor_data_batch(self, batch: SensorDataBatch) -> Dict[str, Any]:
        results = {
            "driver_id": batch.driver_id,
            "session_id": batch.session_id,
            "timestamp": datetime.utcnow(),
            "fatigue_analysis": None,
            "movement_analysis": None,
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
        
        record = self.store_sensor_record(batch, results)
        results["record_id"] = record.record_id

        alerts = self.generate_alerts(
            batch.driver_id,
            fatigue_analysis,
            movement_analysis,
            batch.location_data
        )
        results["alerts"] = alerts

        safety_data = {
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

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
            )

            if len(faces) == 0:
                return FatigueAnalysisResult(
                    fatigue_score=0.0,
                    eye_blink_rate=0.0,
                    yawn_detected=False,
                    head_tilt_rate=0.0,
                    recommendation="No face detected. Please ensure proper camera placement.",
                    alert_level="none"
                )
            
            (x, y, w, h) = max(faces, key=lambda f: f[2] * f[3])
            face_roi = gray[y:y+h, x:x+w]

            eyes = self.eye_cascade.detectMultiScale(
                face_roi, scaleFactor=1.1, minNeighbors=10, minSize=(15, 15)
            )
            num_eyes_detected = len(eyes)

            eye_blink_rate = self.calculate_eye_blink_rate(num_eyes_detected)
            head_tilt_rate = self.detect_head_tilt(face_roi)
            yawn_detected = self.detect_yawn(face_roi)

            fatigue_score = self.estimate_fatigue_score(
                eye_blink_rate, head_tilt_rate, yawn_detected, num_eyes_detected
            )

            if fatigue_score >= 0.7:
                recommendation = "High fatigue detected. Please take a break immediately."
                alert_level = "critical"
            elif fatigue_score >= 0.4:
                recommendation = "Moderate fatigue detected. Consider taking a short break."
                alert_level = "warning"
            else:
                recommendation = "No fatigue detected. Driver is alert."
                alert_level = "none"
            
            return FatigueAnalysisResult(
                fatigue_score=fatigue_score,
                eye_blink_rate=eye_blink_rate,
                yawn_detected=yawn_detected,
                head_tilt_rate=head_tilt_rate,
                recommendation=recommendation,
                alert_level=alert_level
            )

        except Exception as e:
            print(f"Error in fatigue analysis: {e}")
            return FatigueAnalysisResult(
                fatigue_score=0.0,
                eye_blink_rate=0.0,
                yawn_detected=False,
                head_tilt_rate=0.0,
                recommendation="Error in processing frame data.",
                alert_level="none"
            )
        
    def calculate_eye_blink_rate(self, num_eyes_detected: int) -> float:
        if num_eyes_detected >= 2:
            return self.NORMAL_BLINK_RATE
        elif num_eyes_detected == 1:
            return self.NORMAL_BLINK_RATE * 0.7
        else:
            return self.DROWSY_BLINK_RATE
    
    def detect_head_tilt(self, face_roi) -> float:
        # TODO: Implement head tilt detection logic
        return 0.0
    
    def detect_yawn(self, face_roi) -> bool:
        # TODO: Implement yawn detection logic
        return False
    
    def estimate_fatigue_score(self, eye_blink_rate: float, head_tilt_rate: float, 
        yawn_detected: bool, num_eyes_detected: int) -> float:
        # TODO: Implement ML-based fatigue detection
        score = 0.0

        if eye_blink_rate < self.DROWSY_BLINK_RATE:
            score += 0.4
        elif eye_blink_rate < self.NORMAL_BLINK_RATE:
            score += 0.2

        if abs(head_tilt_rate) > self.HEAD_TILT_THRESHOLD:
            score += 0.3

        if yawn_detected:
            score += 0.2
        
        if num_eyes_detected == 0:
            score += 0.1

        return min(score, 1.0)
    
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

        harsh_braking = latest_accel.x < self.HARSH_BRAKING_THRESHOLD
        harsh_acceleration = latest_accel.x > self.HARSH_ACCELERATION_THRESHOLD

        angular_velocity = math.sqrt(
            latest_gyro.x**2 + latest_gyro.y**2 + latest_gyro.z**2
        )
        sharp_turn = angular_velocity > self.SHARP_TURN_THRESHOLD

        sudden_impact = (
            abs(latest_accel.x) > self.SUDDEN_IMPACT_THRESHOLD or
            abs(latest_accel.y) > self.SUDDEN_IMPACT_THRESHOLD or
            abs(latest_accel.z) > self.SUDDEN_IMPACT_THRESHOLD
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
        movement_result: MovementAnalysisResult, location_data) -> list:

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
        return alerts
    
    
