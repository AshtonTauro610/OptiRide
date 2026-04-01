from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.db.database import get_db
from app.core.dependencies import get_current_admin
from app.models.zone import Zone
from app.models.user import User
from app.services.forecasting_service import ForecastingService

router = APIRouter()


@router.post("/train/{zone_id}")
def train_zone_models(
    zone_id: str,
    days_history: int = Query(60, ge=7, le=365, description="Days of history to use for training"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    service = ForecastingService(db)
    result = service.train_zone_models(zone_id=zone_id, days_history=days_history)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    
    # Clear cache so new models are loaded for predictions
    ForecastingService.clear_model_cache()

    return result


@router.post("/train-all")
def train_all_zones(
    days_history: int = Query(60, ge=7, le=365, description="Days of history to use for training"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    service = ForecastingService(db)
    zones = db.query(Zone).all()

    results = []
    for zone in zones:
        result = service.train_zone_models(zone_id=zone.zone_id, days_history=days_history)
        results.append(result)
    
    # Clear cache if any training succeeded
    trained = [r for r in results if r.get("status") == "trained"]
    if trained:
        ForecastingService.clear_model_cache()

    failed = [r for r in results if "error" in r]

    return {
        "total_zones": len(zones),
        "trained": len(trained),
        "failed": len(failed),
        "results": results
    }


@router.post("/update-live-all")
def update_all_live_demand(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    service = ForecastingService(db)
    zones = db.query(Zone).all()

    results = []
    for zone in zones:
        result = service.update_live_demand(zone.zone_id)
        results.append(result)

    return {
        "total_zones": len(zones),
        "results": results
    }


@router.get("/predict")
def generate_forecast(
    zone_id: Optional[str] = Query(None, description="Zone ID (omit for all zones)"),
    horizon_minutes: int = Query(60, ge=15, le=180, description="Forecast horizon in minutes"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    service = ForecastingService(db)
    forecasts = service.generate_forecast(
        zone_id=zone_id,
        horizon_minutes=horizon_minutes
    )

    return {
        "zone_id": zone_id or "all",
        "method": "ml_ensemble",
        "horizon_minutes": horizon_minutes,
        "forecast_count": len(forecasts),
        "forecasts": [
            {
                "zone_id": f.zone_id,
                "forecast_time": f.forecast_time.isoformat(),
                "predicted_demand": f.predicted_demand,
                "demand_score": f.demand_score,
                "confidence": f.confidence,
                "alert_level": f.alert_level,
                "model_used": f.model_used
            }
            for f in forecasts
        ]
    }


@router.post("/update-live/{zone_id}")
def update_live_demand(
    zone_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    service = ForecastingService(db)
    result = service.update_live_demand(zone_id=zone_id)

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    return result


@router.get("/patterns/{zone_id}")
def get_demand_patterns(
    zone_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    service = ForecastingService(db)
    return service.get_demand_patterns(zone_id=zone_id)
