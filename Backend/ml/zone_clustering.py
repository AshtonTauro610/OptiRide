from shapely import boundary
import numpy as np
import uuid
import requests
import logging
from datetime import datetime, timedelta
from sklearn.cluster import DBSCAN
from shapely.geometry import MultiPoint, Point
from geoalchemy2.shape import from_shape, to_shape
from sqlalchemy.orm import Session
from sqlalchemy import func
import re
from app.models.order import Order
from app.models.driver import Driver
from app.models.zone import Zone
from app.core.config import settings
from app.models.driver import Driver
from app.models.zone import DemandForecast, DemandPattern
from app.models.weather import Weather
from app.models.analytics import Demand, ZoneMetrics

logger = logging.getLogger(__name__)

class ZoneClusteringService:
    def __init__(self, db: Session, max_distance_km: float = 2.0, min_samples: int = 5, lookback_days: int = 7):
        self.db = db
        self.epsilon = max_distance_km / 6371.0
        self.min_samples = min_samples
        self.lookback_days = lookback_days
        self.api_key = settings.GOOGLE_MAPS_API_KEY

    def _get_neighborhood_name(self, lat: float, lng: float) -> str:
        neighborhood = None
        if self.api_key:
            url = f"https://maps.googleapis.com/maps/api/geocode/json?latlng={lat},{lng}&key={self.api_key}"
            try:
                response = requests.get(url, timeout=5).json()
                if response.get("status") == "OK":
                    for result in response.get("results", []):
                        for component in result.get("address_components", []):
                            types = component.get("types", [])
                            if "neighborhood" in types or 'sublocality' in types or 'locality' in types:
                                neighborhood = component.get("long_name")
                                logger.info(f"Geocoded via Google Maps: {neighborhood}")
                                break
                        if neighborhood: break
            except Exception as e:
                logger.error(f"Google Geocode error: {e}")
                
        if not neighborhood:
            try:
                osm_url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json"
                headers = {
                    "User-Agent": "OptiRideZoneClustering/1.0",
                    "Accept-Language": "en"
                }
                osm_res = requests.get(osm_url, headers=headers, timeout=5).json()
                addr = osm_res.get("address", {})
                neighborhood = addr.get("neighbourhood") or addr.get("suburb") or addr.get("city_district") or addr.get("city")
                if neighborhood:
                    logger.info(f"Geocoded via OSM Nominatim: {neighborhood}")
            except Exception as e:
                logger.error(f"OSM Geocode error: {e}")

        return neighborhood if neighborhood else "Emerging Hotstop"

    def generate_zones(self):
        cutoff_date = datetime.utcnow() - timedelta(days=self.lookback_days)
        orders = self.db.query(Order).filter(
            Order.pickup_latitude.isnot(None),
            Order.pickup_longitude.isnot(None),
            Order.created_at >= cutoff_date
        ).all()

        if len(orders) < self.min_samples:
            return {'status': 'skipped', 'message': 'Not enough orders for clustering'}
        
        coords = np.array([[o.pickup_latitude, o.pickup_longitude] for o in orders])
        coords_rad = np.radians(coords)
        
        dbscan = DBSCAN(eps=self.epsilon, min_samples=self.min_samples, algorithm='ball_tree', metric='haversine')
        clusters = dbscan.fit_predict(coords_rad)
        unique_clusters = set(clusters)

        try:
            self.db.query(Driver).update({Driver.current_zone: None}, synchronize_session='fetch')
            self.db.query(DemandForecast).delete(synchronize_session='fetch')
            self.db.query(DemandPattern).delete(synchronize_session='fetch')
            self.db.query(Weather).delete(synchronize_session='fetch')
            self.db.query(Demand).delete(synchronize_session='fetch')
            self.db.query(ZoneMetrics).delete(synchronize_session='fetch')
        except Exception as e:
            logger.warning(f"Could not clear zone dependencies: {e}")

        self.db.query(Zone).delete(synchronize_session='fetch')

        created_zones = []
        for cluster_id in unique_clusters:
            if cluster_id == -1:
                continue
            
            cluster_points = coords[clusters == cluster_id]
            
            points_geom = [Point(lon, lat) for lat, lon in cluster_points]
            multi_point = MultiPoint(points_geom)

            centroid = multi_point.centroid
            boundary = multi_point.convex_hull

            if boundary.geom_type != 'Polygon':
                boundary = boundary.buffer(0.01)

            neighborhood = self._get_neighborhood_name(centroid.y, centroid.x)
            zone_name = f"{neighborhood} Zone" 

            base_slug = re.sub(r'[^a-z0-9]+', '_', neighborhood.lower()).strip('_')
            slug = f"zone_{base_slug}"
            counter = 1
            original_slug = slug
            existing_slugs = [z.zone_id for z in created_zones]
            while slug in existing_slugs:
                slug = f"{original_slug}_{counter}"
                counter += 1

            new_zone = Zone(
                zone_id = slug,
                name = zone_name,
                centroid = from_shape(centroid, srid=4326),
                boundary = from_shape(boundary, srid=4326),
                demand_score = float(len(cluster_points)),
                active_drivers = 0,
                pending_orders = 0
            )
            self.db.add(new_zone)
            created_zones.append(new_zone)

        self.db.flush()

        if created_zones:
            try:
                from app.services.allocation_service import AllocationService
                from app.services.order_service import OrderService

                allocation_service = AllocationService(self.db)
                order_service = OrderService(self.db)

                online_drivers = self.db.query(Driver).filter(
                    Driver.location.isnot(None),
                    Driver.status != 'offline'
                ).all()

                for driver in online_drivers:
                    try:
                        res = allocation_service.allocate_driver(driver.driver_id)
                        
                        if res.get('status') == 'skipped' and driver.location:
                            nearest = self.db.query(Zone).order_by(
                                func.ST_Distance(Zone.centroid, driver.location)
                            ).first()
                            
                            if nearest:
                                driver.current_zone = nearest.zone_id
                                self.db.add(driver)
                                logger.info(f"Geometric fallback: Mapped non-available driver {driver.driver_id} to {nearest.zone_id}")
                    except Exception as e:
                        logger.warning(f"Failed to allocate driver {driver.driver_id}: {e}")

                orders_to_assign = self.db.query(Order).filter(
                    Order.pickup_latitude.isnot(None),
                    Order.pickup_longitude.isnot(None)
                ).all()

                for order in orders_to_assign:
                    try:
                        order_service.assign_zones(order)
                    except Exception as e:
                        logger.warning(f"Failed to assign zones for order {order.order_id}: {e}")

                self.db.commit()
                logger.info("Successfully migrated all drivers/orders to new zones using existing services.")
            except Exception as e:
                logger.error(f"Zone migration failed: {e}")
        
        self.db.commit()
        return {'status': 'ok', 'zones_created': len(created_zones), 'generated_names': created_zones}
            
        
        