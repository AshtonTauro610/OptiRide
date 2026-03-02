import itertools
import os
import math
import json
import logging
import requests
from typing import List, Dict, Any, Tuple
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from geoalchemy2.shape import to_shape

from app.models.driver import Driver
from app.models.order import Order
from app.models.assignment import Assignment
from app.models.zone import Zone
from app.schemas.order import OrderStatus
from app.schemas.driver import DriverStatus
from app.services.forecasting_service import ForecastingService
from app.models.zone import DemandForecast
from app.core.config import settings
from app.core.kafka import kafka_producer
from app.core.socket_manager import socket_manager, emit_sync

logger = logging.getLogger(__name__)

class RoutingEngine:
    def __init__(self, db: Session):
        self.db = db
        self.api_key = settings.GOOGLE_MAPS_API_KEY
        self.routes_api_url = "https://routes.googleapis.com/directions/v2:computeRoutes"


    def dispatch(self, driver_id: str, order_ids: List[str], is_emergency: bool = False) -> Dict[str, Any]:
        driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
        if not driver or not driver.location:
            return {"status": "skipped", "message": "Driver not found or no location"}
        
        orders = self.db.query(Order).filter(Order.order_id.in_(order_ids)).all()
        if len(orders) != len(order_ids):
            return {"status": "skipped", "message": "One or more orders not found"}
        
        driver_shape = to_shape(driver.location)
        origin_coords = (driver_shape.y, driver_shape.x)

        # Pickup and Delivery Problem (PDP) Solver
        # 1. State Assessment
        nodes = []
        for order in orders:
            if order.status in [OrderStatus.assigned.value, OrderStatus.pending.value, OrderStatus.offered.value]:
                if not order.pickup_latitude or not order.dropoff_latitude:
                    return {"status" : "skipped", "message" : f"Order {order.order_id} missing coordinates"}
                nodes.append({
                    "id": order.order_id,
                    "type": "pickup",
                    "lat": order.pickup_latitude,
                    "lng": order.pickup_longitude
                })
                nodes.append({
                    "id": order.order_id,
                    "type": "dropoff",
                    "lat": order.dropoff_latitude,
                    "lng": order.dropoff_longitude
                })
            elif order.status == OrderStatus.picked_up.value:
                nodes.append({
                    "id": order.order_id,
                    "type": "dropoff",
                    "lat": order.dropoff_latitude,
                    "lng": order.dropoff_longitude
                })
        if not nodes:
            return {"status": "skipped", "message": "No nodes found"}
        
        # 2. Permutations
        ordered_nodes = self._get_pdp_sequence(origin_coords, nodes)
        try:
            route = self._compute_route(origin_coords, ordered_nodes, is_emergency)
        except Exception as e:
            logger.warning(f"Routes API failed: {e}. Using nearest neighbor fallback")
            route = self._compute_nearest_neighbor_route(origin_coords, ordered_nodes)

        new_assignment = Assignment(
            driver_id=driver_id,
            route_polyline=route.get("polyline", ""),
            total_distance_km=route.get("distance_km", 0.0),
            estimated_time_min=route.get("duration_mins", 0.0),
            optimized_sequence=route.get("sequence", []),
            eta=datetime.utcnow() + timedelta(minutes=route.get("duration_mins", 0)),
            status="in_progress",
            assigned_at=datetime.utcnow()
        )

        self.db.add(new_assignment)
        self.db.flush()

        for order in orders:
            if order.status in [OrderStatus.pending.value, OrderStatus.offered.value]:
                order.status = OrderStatus.assigned.value
            order.driver_id = driver_id
            order.assignment_id = new_assignment.assignment_id
        
        driver.status = DriverStatus.BUSY.value
        self.db.commit()

        payload = {
            "assignment_id": new_assignment.assignment_id,
            "driver_id": driver_id,
            "order_count": len(orders),
            "distance_km" : route.get("distance_km", 0.0),
            "sequence" : route.get("sequence", []),
            "polyline" : route.get("polyline", ""),
            "timestamp" : datetime.utcnow().isoformat()
        }

        kafka_producer.publish("route.assigned", payload)
        emit_sync(socket_manager.notify_driver_assignment(driver.driver_id, payload))

        return {
            "status": "ok",
            "data" : payload
        }
    
    def _get_pdp_sequence(self, origin : Tuple[float, float], nodes : List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not nodes:
            return []
            
        points = [{"lat": origin[0], "lng": origin[1]}] + nodes
        
        # Build distance matrix (default to haversine if API fails)
        dist_matrix = {}
        for i in range(len(points)):
            dist_matrix[i] = {}
            for j in range(len(points)):
                dist_matrix[i][j] = self._calculate_haversine_distance(
                    points[i]['lat'], points[i]['lng'], 
                    points[j]['lat'], points[j]['lng']
                )

        try:
            if getattr(self, 'api_key', None):
                matrix_api_url = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
                headers = {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": self.api_key,
                    "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters"
                }
                waypoints = [{"waypoint": {"location": {"latLng": {"latitude": p['lat'], "longitude": p['lng']}}}} for p in points]
                
                payload = {
                    "origins": waypoints,
                    "destinations": waypoints,
                    "travelMode": "DRIVE"
                }
                
                response = requests.post(matrix_api_url, headers=headers, json=payload, timeout=5)
                if response.status_code == 200:
                    logger.info("Successfully fetched Google Distance Matrix API for permutations.")
                    for element in response.json():
                        o_idx = element.get('originIndex', 0)
                        d_idx = element.get('destinationIndex', 0)
                        
                        # Optimize for Time Duration instead of physical Distance
                        duration_str = element.get('duration', '0s')
                        duration_sec = float(duration_str.replace('s', ''))
                        
                        dist_matrix[o_idx][d_idx] = duration_sec
                    logger.info(f"Distance Matrix: {dist_matrix}")
                else:
                    logger.warning(f"Matrix API failed: {response.status_code} - {response.text}")
        except Exception as e:
            logger.warning(f"Error fetching Route Matrix: {e}")

        best_route = None
        min_distance = float('inf')

        node_indices = {n['id'] + n['type']: idx + 1 for idx, n in enumerate(nodes)}

        for perm in itertools.permutations(nodes):
            valid = True
            seen_pickups = set()

            for node in perm:
                if node["type"] == "pickup":
                    seen_pickups.add(node["id"])
                elif node["type"] == "dropoff":
                    requires_pickup = any(n['id'] == node['id'] and n['type'] == "pickup" for n in nodes)
                    if requires_pickup and node['id'] not in seen_pickups:
                        valid = False
                        break
            if not valid:
                continue

            distance = 0.0
            current_idx = 0  
            for node in perm:
                next_idx = node_indices[node['id'] + node['type']]
                distance += dist_matrix[current_idx][next_idx]
                current_idx = next_idx

            if distance < min_distance:
                min_distance = distance
                best_route = list(perm)
        
        logger.info(f"PDP Algorithm Selected Sequence: {[n['type'] + '_' + n['id'][:4] for n in best_route]} with total distance {min_distance}")
        return best_route

    def _compute_route(self, origin: Tuple[float, float], ordered_nodes: List[Dict[str, Any]], is_emergency: bool = False) -> Dict[str, Any]:
        if not self.api_key:
            raise Exception("Google Maps API key is not configured")
        
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex"
        }

        intermediates = []
        for i, n in enumerate(ordered_nodes[:-1]):
            intermediates.append({
                "location": {
                    "latLng": {
                        "latitude": n["lat"],
                        "longitude": n["lng"]
                    }
                },
                "sideOfRoad": True
            })
        
        unique_order_ids = set(n['id'] for n in ordered_nodes)

        if len(unique_order_ids) == 1 and not is_emergency:
            predictive_wp = self._get_predictive_waypoint(origin, (ordered_nodes[-1]["lat"], ordered_nodes[-1]["lng"]))
            if predictive_wp:
                intermediates.append({
                    "location": {
                        "latLng": {
                            "latitude": predictive_wp["lat"],
                            "longitude": predictive_wp["lng"]
                        }
                    },
                    "via": True
                })
        
        payload = {
            "origin": {
                "location": {
                    "latLng": {
                        "latitude": origin[0],
                        "longitude": origin[1]
                    }
                }
            },
            "destination": {
                "location": {
                    "latLng": {
                        "latitude": ordered_nodes[-1]["lat"],
                        "longitude": ordered_nodes[-1]["lng"]
                    }
                },
                "sideOfRoad": True
            },
            "intermediates": intermediates,
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE_OPTIMAL",
            "optimizeWaypointOrder": False
        }

        response = requests.post(self.routes_api_url, headers=headers, json=payload)

        if response.status_code != 200:
            raise Exception(f"Routes API error: {response.status_code} - {response.text}")
        
        data = response.json()
        if "routes" not in data or not data["routes"]:
            raise Exception("No routes found in response")
        
        route = data["routes"][0]
        duration_str = route.get("duration", "0s").replace("s", "")
        duration_mins = round(float(duration_str) / 60, 2)

        sequence = [f"{n['type']}_{n['id']}" for n in ordered_nodes]

        return {
            "sequence": sequence,
            "polyline": route["polyline"]["encodedPolyline"],
            "distance_km": round(route.get("distanceMeters", 0) / 1000.0, 2),
            "duration_mins": duration_mins
        }
    
    def _compute_nearest_neighbor_route(self, origin: Tuple[float, float], ordered_nodes: List[Dict[str, Any]]) -> Dict[str, Any]:
        total_distance_km = 0.0
        current_loc = origin

        for node in ordered_nodes:
            dist = self._calculate_haversine_distance(current_loc[0], current_loc[1], node["lat"], node["lng"])
            total_distance_km += dist
            current_loc = (node["lat"], node["lng"])
        
        actual_distance_est = total_distance_km * 1.4
        actual_time_est = (actual_distance_est / 40.0) * 60.0
        
        sequence = [f"{n['type']}_{n['id']}" for n in ordered_nodes]

        return {
            "sequence": sequence,
            "polyline": "",
            "distance_km": round(actual_distance_est, 2),
            "duration_mins": round(actual_time_est, 2)
        }

    def _get_predictive_waypoint(
        self,
        origin : Tuple[float, float],
        destination : Tuple[float, float]
    ) -> Dict[str, float]:
        try:
            now = datetime.utcnow()
            forecasts = self.db.query(
                DemandForecast.zone_id,
                func.max(DemandForecast.predicted_demand).label('max_demand')
            ).filter(
                DemandForecast.forecast_time >= now,
                DemandForecast.forecast_time <= now + timedelta(hours=1)
            ).group_by(DemandForecast.zone_id).order_by(
                func.max(DemandForecast.predicted_demand).desc()
            ).limit(5).all()

            if not forecasts:
                zones = self.db.query(Zone).filter(
                    Zone.centroid.isnot(None),
                    Zone.demand_score.isnot(None)
                ).order_by(Zone.demand_score.desc()).limit(5).all()
            else:
                zone_ids = [f.zone_id for f in forecasts]
                zones = self.db.query(Zone).filter(
                    Zone.zone_id.in_(zone_ids),
                    Zone.centroid.isnot(None)
                ).all()
                zone_map = {z.zone_id: z for z in zones}
                zones = [zone_map[f.zone_id] for f in forecasts if f.zone_id in zone_map]

            if not zones:
                return None
            
            direct_dist = self._calculate_haversine_distance(origin[0], origin[1], destination[0], destination[1])

            for zone in zones:
                shape = to_shape(zone.centroid)
                surge_lat, surge_lng = shape.y, shape.x

                detour_dist1 = self._calculate_haversine_distance(origin[0], origin[1], surge_lat, surge_lng)
                detour_dist2 = self._calculate_haversine_distance(surge_lat, surge_lng, destination[0], destination[1])
                
                if (detour_dist1 + detour_dist2) <= (direct_dist * 1.3):
                    logger.info(f"Injecting Predictive Waypoint for Zone {zone.name} (Demand Score: {zone.demand_score})")
                    return {
                        "lat": surge_lat,
                        "lng": surge_lng,
                        "detour_km": round((detour_dist1 + detour_dist2) - direct_dist, 2)
                    }
            
            return None
        except Exception as e:
            logger.warning(f"Error getting predictive waypoint: {e}")
            return None
    
    @staticmethod
    def _calculate_haversine_distance(lat1, lon1, lat2, lon2):
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        distance_km = 2 * R * math.atan2(math.sqrt(a), math.sqrt(1-a))
        return distance_km