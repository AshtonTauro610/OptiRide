from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings, ALLOWED_ORIGINS
from app.db.database import engine, Base, SessionLocal
from app.routers import auth, driver, safety, order, analytics, forecasting, allocation
from app.core.socket_manager import sio_app
from app.models import alert, analytics as analytics_model, assignment, break_model, \
    driver as driver_model, event, gps_track, order as order_model, weather, sensor_record, user, zone
import asyncio
from app.services.allocation_service import AllocationService
from ml.zone_clustering import ZoneClusteringService

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi import Request
import traceback

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Optiride Backend API",
    description="API for the Optiride backend.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(driver.router, prefix="/drivers", tags=["Drivers"])
app.include_router(safety.router, prefix="/safety", tags=["Safety Monitoring"])
app.include_router(order.router, prefix="/orders", tags=["Orders"])
app.include_router(analytics.router, prefix="/analytics", tags=["Analytics"])
app.include_router(forecasting.router, prefix="/forecasting", tags=["Forecasting"])
app.include_router(allocation.router, prefix="/allocation", tags=["Allocation"])

@app.get("/")
async def root():
    return {"message": "Optiride Backend API is running."}

@app.on_event("startup")
async def start_background_tasks():
    async def periodic_reallocation():
        while True:
            await asyncio.sleep(900)
            try:
                db = SessionLocal()
                service = AllocationService(db)
                result = service.reallocation()
                print(f"[BG TASK] Periodic Reallocation: {result['status']}")
                db.close()
            except Exception as e:
                print(f"[BG TASK ERROR] Reallocation failed: {e}")
    
    async def periodic_zone_recalculation():
        await asyncio.sleep(60)
        while True:
            try:
                db = SessionLocal()
                service = ZoneClusteringService(db, max_distance_km=1.0, min_samples=3, lookback_days=7)
                result = service.generate_zones()
                print(f"[BG TASK] Periodic Zone Recalculation: {result['status']} - {result.get('zones_created', 0)} zones created")
                db.close()
            except Exception as e:
                print(f"[BG TASK ERROR] Zone recalculation failed: {e}")
            
            await asyncio.sleep(7200)

    asyncio.create_task(periodic_reallocation())
    asyncio.create_task(periodic_zone_recalculation())

app.mount("/ws", sio_app)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
