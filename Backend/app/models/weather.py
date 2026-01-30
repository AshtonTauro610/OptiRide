from sqlalchemy import Column, String, Float, DateTime, ForeignKey
from app.db.database import Base


class Weather(Base):
    __tablename__ = "weather"

    weather_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    zone_id = Column(String, ForeignKey("zones.zone_id"), nullable=False)
    
    timestamp = Column(DateTime, nullable=False)
    
    temperature_c = Column(Float)
    humidity_percent = Column(Float)
    wind_speed_kmh = Column(Float)
    precipitation_mm = Column(Float)
    weather_condition = Column(String) # sunny, cloudy, rainy, snowy, etc

    is_extreme_weather = Column(Boolean, default=False)
