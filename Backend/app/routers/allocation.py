from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.database import get_db
from app.core.dependencies import get_current_admin
from app.services.allocation_service import AllocationService
from ml.zone_clustering import ZoneClusteringService

router = APIRouter()

class ManualAllocationRequest(BaseModel):
    driver_id: str
    zone_id: str

@router.post("/initial")
def initial_allocation(db: Session = Depends(get_db), admin = Depends(get_current_admin)):
    service = AllocationService(db)
    result = service.initial_allocation()
    return result

@router.post("/reallocate")
def reallocation(db: Session = Depends(get_db), admin = Depends(get_current_admin)):
    service = AllocationService(db)
    result = service.reallocation()
    return result

@router.post("/manual")
def manual_allocation(
    request: ManualAllocationRequest,
    db: Session = Depends(get_db), 
    admin = Depends(get_current_admin)
):
    service = AllocationService(db)
    result = service.manual_allocation(request.driver_id, request.zone_id)
    if result["status"] == "skipped":
        raise HTTPException(status_code=400, detail=result["message"])
    return result

@router.post("/drivers/{driver_id}/reallocate")
def reallocate_single_driver(
    driver_id: str,
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin)
):
    service = AllocationService(db)
    result = service.allocate_driver(driver_id)
    if result["status"] == "skipped":
        raise HTTPException(status_code=400, detail=result["message"])
    return result

@router.get("/status")
def get_allocation_status(db: Session = Depends(get_db), admin = Depends(get_current_admin)):
    service = AllocationService(db)
    return service.get_current_allocation_status()

@router.post("/zones/recalculate")
def recalculate_zones(db: Session = Depends(get_db), admin = Depends(get_current_admin)):
    service = ZoneClusteringService(db, max_distance_km=1.0, min_samples=3, lookback_days=7)
    result = service.generate_zones()
    return result
