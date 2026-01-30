from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import Optional, List
from sqlalchemy.orm import Session
from geoalchemy2.functions import ST_X, ST_Y
from app.db.database import get_db
from app.core.dependencies import get_current_driver, get_current_user, get_current_admin
from app.core.socket_manager import socket_manager, emit_sync
from app.services.driver_service import DriverService
from app.models.driver import Driver
from app.models.user import User
from app.schemas.driver import (
    DriverCreate, DriverUpdate, LocationSchema, StatusUpdate,
    DriverResponse, DriverPerformanceStats, NearbyDriverResponse,
    ShiftStart, ShiftEnd, ShiftSummary, BreakRequest, DriverStatus, DutyStatus,
    DriverListResponse, ZoneUpdate, TelemetryUpdate
)

router = APIRouter()

@router.post("/", response_model=DriverResponse)
def create_driver(
    driver_data: DriverCreate,
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin)
):
    driver_service = DriverService(db)
    user = db.query(User).filter(User.user_id == driver_data.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Associated user not found"
        )
    
    if user.user_type != 'driver':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Associated user is not of type 'driver'"
        )
    
    exists = driver_service.get_driver_by_user_id(user_id=driver_data.user_id)
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Driver profile already exists for this user"
        )
    
    driver = driver_service.create_driver(driver_data=driver_data)
    return DriverResponse.model_validate(driver)

@router.get("/", response_model=DriverListResponse)
def list_drivers(
    skip: int = 0,
    limit: int = 10,
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin)
):
    driver_service = DriverService(db)
    total = db.query(Driver).count()
    drivers = driver_service.list_drivers(skip=skip, limit=limit)
    return DriverListResponse(
        total=total,
        drivers=[DriverResponse.model_validate(driver) for driver in drivers]
    )

@router.get("/active-locations")
def get_active_driver_locations(
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin)
):
    driver_service = DriverService(db)
    locations = driver_service.get_all_active_drivers_locations()
    return locations

@router.get("/stats/summary")
def get_drivers_summary(
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin)
):
    driver_service = DriverService(db)
    
    total_drivers = driver_service.count_total_drivers()
    available_drivers = driver_service.count_drivers_by_status(status=DriverStatus.AVAILABLE)
    busy_drivers = driver_service.count_drivers_by_status(status=DriverStatus.BUSY)
    on_break_drivers = driver_service.count_drivers_by_status(status=DriverStatus.ON_BREAK)
    offline_drivers = driver_service.count_drivers_by_status(status=DriverStatus.OFFLINE)
    on_duty_drivers = driver_service.count_drivers_by_duty_status(duty_status=DutyStatus.ON_DUTY)

    return {
        "total_drivers": total_drivers,
        "available_drivers": available_drivers,
        "busy_drivers": busy_drivers,
        "on_break_drivers": on_break_drivers,
        "offline_drivers": offline_drivers,
        "on_duty_drivers": on_duty_drivers
    }

@router.get("/me", response_model=DriverResponse)
def get_my_driver_profile(
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    driver_profile = driver_service.get_driver_by_user_id(user_id=driver.user_id)
    if not driver_profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Driver profile not found"
        )
    driver_profile.email = db.query(User).filter(User.user_id == driver.user_id).first().email
    driver_profile.phone_number = db.query(User).filter(User.user_id == driver.user_id).first().phone_number
    return DriverResponse.model_validate(driver_profile)

@router.patch("/me", response_model=DriverResponse)
def update_my_driver_profile(
    driver_data: DriverUpdate,
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    return driver_service.update_driver(driver_id=driver.driver_id, update_data=driver_data)
    
@router.get("/me/performance-stats", response_model=DriverPerformanceStats)
def get_my_performance_stats(
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    stats = driver_service.get_performance_stats(driver_id=driver.driver_id)
    return stats

@router.post("/me/location")
async def update_my_location(
    location_data: LocationSchema,
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    driver_service.update_location(
        driver_id=driver.driver_id,
        location_data=location_data
    )

    await socket_manager.notify_driver_location(driver.driver_id, {
        "latitude": location_data.latitude,
        "longitude": location_data.longitude,
        "speed": location_data.speed,
        "heading": location_data.heading
    })
    return {"detail": "Location updated successfully"}

@router.get("/nearby-drivers")
def get_nearby_drivers(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(5.0, gt=0),
    status: Optional[DriverStatus] = DriverStatus.AVAILABLE,
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    driver_service = DriverService(db)
    return driver_service.get_nearby_drivers(
        latitude=latitude, longitude=longitude, radius_km=radius_km, status=status, limit=limit)

@router.post("/me/status")
async def update_my_status(
    status_data: StatusUpdate,
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    driver_service.update_status(
        driver_id=driver.driver_id,
        new_status=status_data.status
    )
    
    await socket_manager.notify_driver_status_change(driver.driver_id, status_data.status.value)
    return {"detail": "Status updated successfully"}

@router.post("/me/shift/start", response_model=DriverResponse)
def start_my_shift(
    shift_data: ShiftStart,
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    return driver_service.start_shift(
        driver_id=driver.driver_id,
        shift_start=shift_data
    )

@router.post("/me/shift/end", response_model=ShiftSummary)
def end_my_shift(
    shift_data: ShiftEnd,
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    return driver_service.end_shift(
        driver_id=driver.driver_id,
        shift_end=shift_data
    )

@router.post("/me/break/start")
def start_break(
    break_data: BreakRequest,
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    driver_service.request_break(
        driver_id=driver.driver_id,
        break_request=break_data
    )
    return {"message": "Break started successfully", "break_type": break_data.break_type}

@router.post("/me/break/end")
def end_break(
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    updated_driver = driver_service.end_break(driver_id=driver.driver_id)
    return {"message": "Break ended successfully", "breaks_today": updated_driver.breaks}

@router.patch("/me/zone")
def update_my_zone(
    zone_data: ZoneUpdate,
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    updated_driver = driver_service.update_zone(driver_id=driver.driver_id, new_zone=zone_data.zone_id)
    return {"detail": "Current zone updated successfully", "zone_id": updated_driver.current_zone}

@router.get("/zone/{zone_id}")
def get_drivers_in_zone(
    zone_id: str,
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin)
):
    driver_service = DriverService(db)
    drivers = driver_service.get_drivers_by_zone(zone=zone_id)
    return {
        "zone_id": zone_id,
        "total_drivers": len(drivers),
        "drivers": [DriverResponse.model_validate(driver) for driver in drivers]
    }

@router.get("/{driver_id}", response_model=DriverResponse)
def get_driver_by_id(
    driver_id: str,
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin)
):
    driver_service = DriverService(db)
    driver = driver_service.get_driver_by_id(driver_id=driver_id)
    if not driver:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Driver not found"
        )
    driver.email = db.query(User).filter(User.user_id == driver.user_id).first().email
    driver.phone_number = db.query(User).filter(User.user_id == driver.user_id).first().phone_number
    return DriverResponse.model_validate(driver)

@router.get("/{driver_id}/performance-stats", response_model=DriverPerformanceStats)
def get_driver_performance_stats_by_id(
    driver_id: str,
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin)
):
    driver_service = DriverService(db)
    stats = driver_service.get_performance_stats(driver_id=driver_id)
    return stats

@router.delete("/{driver_id}")
def delete_driver(
    driver_id: str,
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin)
):
    driver_service = DriverService(db)
    driver_service.delete_driver(driver_id=driver_id)
    return {"detail": f"Driver: {driver_id} deleted successfully"}

@router.patch("/me/telemetry", response_model=DriverResponse)
def update_my_telemetry(
    telemetry_data: TelemetryUpdate,
    db: Session = Depends(get_db),
    driver = Depends(get_current_driver)
):
    driver_service = DriverService(db)
    updated_driver = driver_service.update_telemetry(driver_id=driver.driver_id, telemetry=telemetry_data)
    return DriverResponse.model_validate(updated_driver)