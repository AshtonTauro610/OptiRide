from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.database import get_db
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
from app.services.safety_monitoring_service import SafetyMonitoringService
from app.services.distance_tracking_service import DistanceTrackingService
from app.core.dependencies import get_current_driver
from app.core.socket_manager import socket_manager
from app.schemas.sensor import SensorDataBatch, DistanceStats, SensorDataBatchResponse
from app.models.alert import Alert
from app.models.driver import Driver
from app.schemas.alert import AlertResponse, AlertAcknowledge
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import desc

class EmergencyResponse(BaseModel):
    driver_id: str
    status: str

router = APIRouter()

@router.post("/sensor-data", response_model=SensorDataBatchResponse)
def submit_sensor_data(
    sensor_batch: SensorDataBatch,
    current_driver = Depends(get_current_driver),
    db: Session = Depends(get_db)
):
    if sensor_batch.driver_id != current_driver.driver_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to submit data for this driver.")
    
    safety_service = SafetyMonitoringService(db)
    results = safety_service.process_sensor_data_batch(sensor_batch)

    distance_service = DistanceTrackingService(db)
    distance_service.record_gps_point(
        driver_id=sensor_batch.driver_id,
        session_id=sensor_batch.session_id,
        location_data=sensor_batch.location_data
    )

    return SensorDataBatchResponse (
        status="processed",
        record_id=results["record_id"],
        fatigue_score=results["fatigue_analysis"].fatigue_score if results["fatigue_analysis"] else None,
        movement_risk=results["movement_analysis"].risk_level if results["movement_analysis"] else None,
        alerts_generated=len(results["alerts"]),
        recommendation=results["fatigue_analysis"].recommendation if results["fatigue_analysis"] else "Keep driving safely.",
        genai_insights=results.get("genai_insights", [])
    )

@router.get("/distance-stats/{session_id}", response_model=DistanceStats)
def get_distance_stats(
    session_id: str,
    current_driver = Depends(get_current_driver),
    db: Session = Depends(get_db)
):
    distance_service = DistanceTrackingService(db)
    stats = distance_service.compute_distance_stats(
        driver_id=current_driver.driver_id,
        session_id=session_id
    )
    if not stats:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No distance data found for this session.")
    return stats

@router.get("/distance/today")
def get_today_distance(
    current_driver = Depends(get_current_driver),
    db: Session = Depends(get_db)
):
    distance_service = DistanceTrackingService(db)
    total_distance = distance_service.get_today_distance(driver_id=current_driver.driver_id)
    return {"driver_id": current_driver.driver_id, "date": datetime.utcnow().date(), "total_distance_km": total_distance}

@router.get("/alerts", response_model=List[AlertResponse])
def get_alerts(
    driver_id: Optional[str] = None,
    alert_type: Optional[str] = None,
    acknowledged: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    query = db.query(
        Alert.alert_id,
        Alert.driver_id,
        Alert.alert_type,
        Alert.severity,
        Alert.timestamp,
        Alert.acknowledged,
        ST_X(Alert.location).label("longitude"),
        ST_Y(Alert.location).label("latitude")
    )
    
    if driver_id:
        query = query.filter(Alert.driver_id == driver_id)
    if alert_type:
        query = query.filter(Alert.alert_type == alert_type)
    if acknowledged is not None:
        query = query.filter(Alert.acknowledged == acknowledged)
        
    alerts = query.order_by(desc(Alert.timestamp)).offset(skip).limit(limit).all()
    
    return [
        {
            "alert_id": a.alert_id,
            "driver_id": a.driver_id,
            "alert_type": a.alert_type,
            "severity": a.severity,
            "timestamp": a.timestamp,
            "acknowledged": a.acknowledged,
            "longitude": a.longitude,
            "latitude": a.latitude
        }
        for a in alerts
    ]

@router.patch("/alerts/{alert_id}/acknowledge", response_model=AlertResponse)
def acknowledge_alert(
    alert_id: str,
    data: AlertAcknowledge,
    db: Session = Depends(get_db)
):
    alert = db.query(Alert).filter(Alert.alert_id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    
    alert.acknowledged = data.acknowledged
    db.commit()
    db.refresh(alert)

    result = db.query(
        Alert.alert_id,
        Alert.driver_id,
        Alert.alert_type,
        Alert.severity,
        Alert.timestamp,
        Alert.acknowledged,
        ST_X(Alert.location).label("longitude"),
        ST_Y(Alert.location).label("latitude")
    ).filter(Alert.alert_id == alert_id).first()
    
    return {
        "alert_id": result.alert_id,
        "driver_id": result.driver_id,
        "alert_type": result.alert_type,
        "severity": result.severity,
        "timestamp": result.timestamp,
        "acknowledged": result.acknowledged,
        "longitude": result.longitude,
        "latitude": result.latitude
    }

@router.post("/emergency-response")
def handle_emergency_response(data: EmergencyResponse, db: Session = Depends(get_db), current_driver: Driver = Depends(get_current_driver)):
    safety_service = SafetyMonitoringService(db)
    result = safety_service.resolve_emergency(data.driver_id, data.status)
    return result    

# Simulate a crash event for Testing Purpose

@router.post("/simulate-crash")
async def simulate_crash(
    current_driver: Driver = Depends(get_current_driver)
):
    alert_data = {
        "alert_type": "CRITICAL_CRASH",
        "message" : "Crash detected! Are you okay? Emergency services will be called in 60s."
    }
    await socket_manager.notify_safety_alert(current_driver.driver_id, alert_data)
    return {"status": "success", "message": "Crash event simulated and pushed to frontend via Socket.IO."}
