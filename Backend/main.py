from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings, ALLOWED_ORIGINS
from app.db.database import engine, Base
from app.routers import auth, driver, safety, order, analytics
from app.core.socket_manager import sio_app
from app.models import alert, analytics as analytics_model, assignment, break_model, \
    driver as driver_model, event, gps_track, order as order_model, sensor_record, user, zone

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

@app.get("/")
async def root():
    return {"message": "Optiride Backend API is running."}

app.mount("/ws", sio_app)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
