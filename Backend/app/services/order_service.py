from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException, status
from typing import Optional, List, Tuple, Dict, Any
from datetime import datetime, timedelta
from geoalchemy2.functions import ST_Distance, ST_MakePoint, ST_X, ST_Y
from geoalchemy2.elements import WKTElement
import googlemaps
import requests as req
import logging
from app.core.config import settings
from app.core.kafka import kafka_producer
from app.models.order import Order
from app.models.driver import Driver
from app.services.driver_service import DriverService
from app.services.routing_service import RoutingEngine
from app.schemas.driver import DriverStatus
from app.models.zone import Zone
from app.schemas.order import (
    OrderCreate, OrderUpdate, OrderAssign, OrderPickup, OrderDeliver,
    OrderStats, OrderStatus, OrderResponse)
from app.core.socket_manager import socket_manager, emit_sync


logger = logging.getLogger(__name__)

class OrderService:
    def __init__(self, db: Session):
        self.db = db
        self.MAX_CONCURRENT_ORDERS = 3
    
    def create_order(self, order_data: OrderCreate) -> Order:
        order = Order(
            pickup=WKTElement(f'POINT({order_data.pickup_longitude} {order_data.pickup_latitude})', srid=4326),
            dropoff=WKTElement(f'POINT({order_data.dropoff_longitude} {order_data.dropoff_latitude})', srid=4326),
            pickup_address=order_data.pickup_address,
            dropoff_address=order_data.dropoff_address,
            pickup_latitude=order_data.pickup_latitude,
            pickup_longitude=order_data.pickup_longitude,
            dropoff_latitude=order_data.dropoff_latitude,
            dropoff_longitude=order_data.dropoff_longitude,
            customer_name=order_data.customer_name,
            customer_contact=order_data.customer_contact,
            restaurant_name=order_data.restaurant_name,
            restaurant_contact=order_data.restaurant_contact,
            price=order_data.price,
            status=OrderStatus.pending.value
        )
        self.calculate_order_info(order)
        self.assign_zones(order)

        self.db.add(order)
        self.db.commit()
        self.db.refresh(order)

        kafka_producer.publish("order-created", {
            "order_id": order.order_id,
            "driver_id": order.driver_id,
            "pickup_zone": order.pickup_zone,
            "dropoff_zone": order.dropoff_zone,
            "pickup_latitude": order.pickup_latitude,
            "pickup_longitude": order.pickup_longitude,
            "dropoff_latitude": order.dropoff_latitude,
            "dropoff_longitude": order.dropoff_longitude,
            "status": order.status,
            "created_at": str(order.created_at)
        })

        # Auto-offer to nearby drivers
        try:
            self.auto_assign_order(order.order_id)
            self.db.refresh(order)
        except HTTPException:
            logger.info(f"No drivers available for auto-offer on order {order.order_id}. Order stays pending.")

        return order
    
    def get_order(self, order_id: str) -> Optional[Order]:
        return self.db.query(Order).filter(Order.order_id == order_id).first()
    
    def update_order(self, order_id: str, data: OrderUpdate) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        if data.status:
            order.status = data.status.value
            
            if data.status == OrderStatus.picked_up:
                order.picked_up_at = datetime.utcnow()
            elif data.status == OrderStatus.delivered:
                order.delivered_at = datetime.utcnow()
        
        self.db.commit()
        self.db.refresh(order)
        return order
    
    def assign_order(self, order_id: str, assign_data: OrderAssign) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        if order.status not in [OrderStatus.pending.value, OrderStatus.offered.value, OrderStatus.assigned.value]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order cannot be assigned in its current status")
        
        driver = self.db.query(Driver).filter(Driver.driver_id == assign_data.driver_id).first()
        if not driver:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")
        
        
        if driver.status not in [DriverStatus.AVAILABLE.value, DriverStatus.BUSY.value]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver is not available for assignment")
        
        MAX_CONCURRENT_ORDERS = 3
        active_orders_count = self.db.query(Order).filter(
            Order.driver_id == assign_data.driver_id,
            Order.status.in_([OrderStatus.assigned.value, OrderStatus.picked_up.value])
        ).count()
        
        if active_orders_count >= MAX_CONCURRENT_ORDERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail=f"Driver already has {active_orders_count} active orders. Maximum is {MAX_CONCURRENT_ORDERS}."
            )
        
        order = self.offer_to_driver(order_id, assign_data.driver_id)
        
        if assign_data.pickup_time:
            order.pickup_time = assign_data.pickup_time
        
        if assign_data.dropoff_time:
            order.dropoff_time = assign_data.dropoff_time
        
        if assign_data.pickup_time or assign_data.dropoff_time:
            self.db.commit()

        return order
    
    def offer_to_driver(self, order_id: str, driver_id: str) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
        if not driver:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")
        
        order.driver_id = driver_id
        order.status = OrderStatus.offered.value
        
        avg_speed_kmh = 40.0
        pickup_time = datetime.utcnow() + timedelta(minutes=15)
        delivery_time = pickup_time + timedelta(minutes=order.duration_min or 25)
        
        order.pickup_time = pickup_time
        order.dropoff_time = delivery_time
        
        self.db.commit()
        self.db.refresh(order)
        
        order_dict = OrderResponse.model_validate(order).model_dump(mode="json")
        emit_sync(socket_manager.notify_order_offer(driver_id, order_dict))
        
        return order
    
    def auto_assign_order(self, order_id: str) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        nearby_drivers = self._get_drivers_with_capacity(
            latitude=order.pickup_latitude, longitude=order.pickup_longitude,
            radius_km=10.0, limit=5)
        
        if not nearby_drivers:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No available drivers nearby")
        
        nearest = nearby_drivers[0]
        
        # If nearest driver is significantly closer (≤50% distance of 2nd), exclusive offer
        if len(nearby_drivers) == 1 or nearest.distance_meters <= nearby_drivers[1].distance_meters * 0.5:
            logger.info(f"Exclusive offer: Order {order_id} -> Driver {nearest.driver_id} ({nearest.distance_meters:.0f}m away)")
            return self.offer_to_driver(order_id, nearest.driver_id)
        
        order.status = OrderStatus.offered.value
        order.driver_id = None
        
        avg_speed_kmh = 50.0
        travel_time_min = ((nearest.distance_meters / 1000) / avg_speed_kmh) * 60
        order.pickup_time = datetime.utcnow() + timedelta(minutes=travel_time_min)
        order.dropoff_time = order.pickup_time + timedelta(minutes=order.duration_min or 25)
        
        self.db.commit()
        self.db.refresh(order)
        order_dict = OrderResponse.model_validate(order).model_dump(mode="json")
        
        notified_ids = []
        for driver in nearby_drivers:
            emit_sync(socket_manager.notify_order_offer(driver.driver_id, order_dict))
            notified_ids.append(driver.driver_id)
        
        logger.info(f"Broadcast offer: Order {order_id} -> {len(notified_ids)} drivers: {notified_ids}")
        
        return order
    
    def accept_order(self, order_id: str, driver_id: str) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        if order.status != OrderStatus.offered.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail=f"Order is not in offered status. Current status: {order.status}"
            )
        
        # For exclusive offers, only the assigned driver can accept
        # For broadcast offers (driver_id is None), any driver can accept
        if order.driver_id is not None and order.driver_id != driver_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="This order was not offered to you"
            )
        
        driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
        if not driver:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")
        
        active_orders_count = self.db.query(Order).filter(
            Order.driver_id == driver_id,
            Order.status.in_([OrderStatus.assigned.value, OrderStatus.picked_up.value])
        ).count()
        
        if active_orders_count >= self.MAX_CONCURRENT_ORDERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail=f"You already have {active_orders_count} active orders. Maximum is {self.MAX_CONCURRENT_ORDERS}."
            )
        
        # For broadcast offers, notify other drivers that this offer is no longer available
        was_broadcast = order.driver_id is None
        if was_broadcast:
            other_drivers = self._get_drivers_with_capacity(
                latitude=order.pickup_latitude, longitude=order.pickup_longitude,
                radius_km=10.0, limit=5, exclude_driver_ids=[driver_id])
            for d in other_drivers:
                emit_sync(socket_manager.notify_order_offer_expired(d.driver_id, order_id))
        
        order.status = OrderStatus.assigned.value
        order.driver_id = driver_id
        self.db.commit()

        routing_engine = RoutingEngine(self.db)
        active_orders = self.get_active_orders_for_driver(driver_id)
        result = routing_engine.dispatch(driver_id, [o.order_id for o in active_orders])
        driver.orders_received += 1
        self.db.commit()
        
        logger.info(f"Order {order_id} accepted by driver {driver_id} (broadcast={was_broadcast})")
        
        return order
    
    def reject_order(self, order_id: str, driver_id: str) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        if order.status != OrderStatus.offered.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail=f"Order is not in offered status. Current status: {order.status}"
            )
        

        if order.driver_id is not None and order.driver_id != driver_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="This order was not offered to you"
            )
        
        order.status = OrderStatus.pending.value
        order.driver_id = None
        order.pickup_time = None
        order.dropoff_time = None
        
        self.db.commit()
        self.db.refresh(order)
        
        nearest_drivers = self._get_drivers_with_capacity(
            latitude=order.pickup_latitude, longitude=order.pickup_longitude,
            radius_km=10.0, limit=1, exclude_driver_ids=[driver_id])
        
        if nearest_drivers:
            next_driver = nearest_drivers[0]
            logger.info(f"Order {order_id} rejected by {driver_id}. Re-offering to driver {next_driver.driver_id}")
            order = self.offer_to_driver(order_id, next_driver.driver_id)
        else:
            logger.warning(f"Order {order_id} rejected by {driver_id}. No other available drivers nearby.")
        
        return order
    
    def _get_drivers_with_capacity(self, latitude: float, longitude: float, radius_km: float = 10.0, limit: int = 5, exclude_driver_ids: list = None):
        driver_service = DriverService(self.db)
        
        available = driver_service.get_nearby_drivers(
            latitude=latitude, longitude=longitude,
            radius_km=radius_km, status=DriverStatus.AVAILABLE, limit=limit)
        busy = driver_service.get_nearby_drivers(
            latitude=latitude, longitude=longitude,
            radius_km=radius_km, status=DriverStatus.BUSY, limit=limit)
        
        all_nearby = available + busy
        all_nearby.sort(key=lambda d: d.distance_meters)
        
        if exclude_driver_ids:
            all_nearby = [d for d in all_nearby if d.driver_id not in exclude_driver_ids]
        
        drivers_with_capacity = []
        for d in all_nearby:
            active_count = self.db.query(Order).filter(
                Order.driver_id == d.driver_id,
                Order.status.in_([OrderStatus.assigned.value, OrderStatus.picked_up.value, OrderStatus.offered.value])
            ).count()
            if active_count < self.MAX_CONCURRENT_ORDERS:
                drivers_with_capacity.append(d)
            if len(drivers_with_capacity) >= limit:
                break
        
        return drivers_with_capacity
    
    def picked_up(self, order_id: str, pickup_data: OrderPickup) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        if order.status != OrderStatus.assigned.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order is not in assigned status")
        
        PICKUP_RADIUS_METERS = 100
        distance = self.db.query(
            ST_Distance(
                WKTElement(f'POINT({pickup_data.pickup_longitude} {pickup_data.pickup_latitude})', srid=4326),
                WKTElement(f'POINT({order.pickup_longitude} {order.pickup_latitude})', srid=4326),
                True
            )
        ).scalar()
        
        if distance and distance > PICKUP_RADIUS_METERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot confirm pickup. You are not at the pickup location."
            )
        
        order.status = OrderStatus.picked_up.value
        order.picked_up_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(order)

        kafka_producer.publish("order-picked-up", {
            "order_id": order.order_id,
            "driver_id": order.driver_id,
            "picked_up_at": str(order.picked_up_at)
        })

        active_orders = self.get_active_orders_for_driver(order.driver_id)
        if active_orders:
            routing_engine = RoutingEngine(self.db)
            routing_engine.dispatch(order.driver_id, [o.order_id for o in active_orders])

        return order
    
    def delivered(self, order_id: str, deliver_data: OrderDeliver) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        if order.status != OrderStatus.picked_up.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order is not in picked up status")
        
        DROPOFF_RADIUS_METERS = 100
        distance = self.db.query(
            ST_Distance(
                WKTElement(f'POINT({deliver_data.dropoff_longitude} {deliver_data.dropoff_latitude})', srid=4326),
                WKTElement(f'POINT({order.dropoff_longitude} {order.dropoff_latitude})', srid=4326),
                True
            )
        ).scalar()
        
        if distance and distance > DROPOFF_RADIUS_METERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot complete delivery. You are not at the dropoff location."
            )
        
        order.status = OrderStatus.delivered.value
        order.delivered_at = datetime.utcnow()

        if order.assigned_at:
            duration = (order.delivered_at - order.assigned_at).total_seconds() / 60.0
            order.duration_min = duration
        
        remaining_active_orders = self.db.query(Order).filter(
            Order.driver_id == order.driver_id,
            Order.status.in_([OrderStatus.assigned.value, OrderStatus.picked_up.value])
        ).count()

        if remaining_active_orders == 0:
            driver = self.db.query(Driver).filter(Driver.driver_id == order.driver_id).first()
            if driver:
                driver.status = DriverStatus.AVAILABLE.value

        self.db.commit()
        self.db.refresh(order)

        kafka_producer.publish("order-delivered", {
            "order_id": order.order_id,
            "driver_id": order.driver_id,
            "price": order.price,
            "distance_km": order.distance_km,
            "duration_min": order.duration_min,
            "delivered_at": str(order.delivered_at)
        })

        if remaining_active_orders > 0:
            routing_engine = RoutingEngine(self.db)
            active_orders = self.get_active_orders_for_driver(order.driver_id)
            routing_engine.dispatch(order.driver_id, [o.order_id for o in active_orders])

        return order
    
    def get_orders(
        self, 
        status: Optional[OrderStatus] = None,
        driver_id: Optional[str] = None,
        pickup_zone: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
    ) -> List[Order]:
        query = self.db.query(Order)
        if status:
            query = query.filter(Order.status == status.value)
        if driver_id:
            query = query.filter(Order.driver_id == driver_id)
        if pickup_zone:
            query = query.filter(Order.pickup_zone == pickup_zone)

        orders = query.offset(skip).limit(limit).all()
        return orders
        
    def get_pending_orders(self, zone_id: Optional[str] = None) -> List[Order]:
        query = self.db.query(Order).filter(Order.status == OrderStatus.pending.value)
        if zone_id:
            query = query.filter(Order.pickup_zone == zone_id)
        return query.all()
    
    def get_active_orders_for_driver(self, driver_id: str) -> List[Order]:
        return self.db.query(Order).filter(
            Order.driver_id == driver_id,
            Order.status.in_([OrderStatus.assigned.value, OrderStatus.picked_up.value])
        ).all()
    
    def get_all_orders_for_driver(
        self, 
        driver_id: str, 
        include_completed: bool = True,
        days: int = 7
    ) -> List[Order]:
        from datetime import timedelta
        
        query = self.db.query(Order).filter(Order.driver_id == driver_id)
        
        if include_completed:
            cutoff = datetime.now() - timedelta(days=days)
            query = query.filter(
                (Order.status.in_([OrderStatus.offered.value, OrderStatus.assigned.value, OrderStatus.picked_up.value])) |
                ((Order.status.in_([OrderStatus.delivered.value, OrderStatus.cancelled.value])) & 
                 (Order.created_at >= cutoff))
            )
        else:
            query = query.filter(
                Order.status.in_([OrderStatus.offered.value, OrderStatus.assigned.value, OrderStatus.picked_up.value])
            )
        
        return query.order_by(Order.created_at.desc()).all()
    
    def get_order_stats(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> OrderStats:
        query = self.db.query(Order)
        
        if start_date:
            query = query.filter(Order.created_at >= start_date)
        if end_date:
            query = query.filter(Order.created_at <= end_date)

        total = query.count()
        pending = query.filter(Order.status == "pending").count()
        assigned = query.filter(Order.status == "assigned").count()
        picked_up = query.filter(Order.status == "picked_up").count()
        delivered = query.filter(Order.status == "delivered").count()
        
        delivered_orders = query.filter(Order.status == "delivered")
        
        avg_delivery_time = delivered_orders.with_entities(
            func.avg(Order.duration_min)
        ).scalar()
        
        avg_distance = delivered_orders.with_entities(
            func.avg(Order.distance_km)
        ).scalar()
        
        total_revenue = delivered_orders.with_entities(
            func.sum(Order.price)
        ).scalar() or 0.0
        
        
        return OrderStats(
            total_orders=total,
            pending=pending,
            assigned=assigned,
            picked_up=picked_up,
            delivered=delivered,
            avg_delivery_time_min=round(avg_delivery_time, 1) if avg_delivery_time else None,
            avg_distance_km=round(avg_distance, 2) if avg_distance else None,
            total_revenue=round(total_revenue, 2)
        )
    
    def get_active_order_locations(self) -> List[Dict[str, Any]]:
        orders = self.db.query(Order).filter(
            Order.status.in_([OrderStatus.pending.value, OrderStatus.assigned.value, OrderStatus.picked_up.value, OrderStatus.offered.value])
        ).all()
        
        return [
            {
                "order_id": order.order_id,
                "status": order.status,
                "pickup_latitude": order.pickup_latitude,
                "pickup_longitude": order.pickup_longitude,
                "dropoff_latitude": order.dropoff_latitude,
                "dropoff_longitude": order.dropoff_longitude,
                "pickup_zone": order.pickup_zone
            }
            for order in orders
        ]

    def calculate_order_info(self, order: Order):
        try:
            headers = {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY,
                "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"
            }

            payload = {
                "origin": {
                    "location": {
                        "latLng": {
                            "latitude": order.pickup_latitude,
                            "longitude": order.pickup_longitude
                        }
                    }
                },
                "destination": {
                    "location": {
                        "latLng": {
                            "latitude": order.dropoff_latitude,
                            "longitude": order.dropoff_longitude
                        }
                    }
                },
                "travelMode": "DRIVE",
                "routingPreference": "TRAFFIC_AWARE"
            }

            response = req.post(
                "https://routes.googleapis.com/directions/v2:computeRoutes",
                headers=headers,
                json=payload
            )

            if response.status_code == 200:
                data = response.json()
                if "routes" in data and data["routes"]:
                    route = data["routes"][0]
                    distance_km = route.get("distanceMeters", 0) / 1000.0
                    duration_str = route.get("duration", "0s").replace("s", "")
                    duration_min = float(duration_str) / 60.0

                    order.distance_km = round(distance_km, 2)
                    order.duration_min = round(duration_min, 1)
                    order.route_polyline = route.get("polyline", {}).get("encodedPolyline", "")
                    logger.info(f"Routes API Response: {order.distance_km} km, {order.duration_min} min")
                else:
                    raise Exception(f"No routes in response: {data}")
            else:
                raise Exception(f"Routes API error: {response.status_code} - {response.text}")

        except Exception as e:
            logger.warning(f"Routes API Error: {e}. Using fallback distance calculation")

            distance_meters = self.db.query(
                ST_Distance(
                    WKTElement(f'POINT({order.pickup_longitude} {order.pickup_latitude})', srid=4326),
                    WKTElement(f'POINT({order.dropoff_longitude} {order.dropoff_latitude})', srid=4326),
                    True
                )
            ).scalar()

            if distance_meters:
                distance_km = distance_meters / 1000.0
                order.distance_km = round(distance_km * 1.3, 2)
            else:
                order.distance_km = 5.0

            avg_speed_kmh = 45.0
            order.duration_min = round((order.distance_km / avg_speed_kmh) * 60, 1)

        base_fee = 7.0
        per_km_rate = 1.2
        order.delivery_fee = round(base_fee + (order.distance_km * per_km_rate), 2)

    def assign_zones(self, order: Order):
        def find_zone(longitude: float, latitude: float) -> Optional[str]:
            point = WKTElement(f'POINT({longitude} {latitude})', srid=4326)

            zone = self.db.query(Zone).filter(
                Zone.boundary.isnot(None),
                func.ST_Contains(Zone.boundary, point)
            ).first()

            if zone:
                return zone.zone_id

            nearest = self.db.query(
                Zone.zone_id,
                func.ST_Distance(Zone.centroid, point).label('dist')
            ).filter(
                Zone.centroid.isnot(None)
            ).order_by('dist').first()

            return nearest.zone_id if nearest else None

        order.pickup_zone = find_zone(order.pickup_longitude, order.pickup_latitude)
        order.dropoff_zone = find_zone(order.dropoff_longitude, order.dropoff_latitude)

    def dispatch_orders(self, driver_id : str, zone_id : str) -> Dict[str, Any]:
        driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
        if not driver:
            return {"status": "error","message" :"Driver not found"}
        if driver.status not in [DriverStatus.AVAILABLE.value, DriverStatus.BUSY.value]:
            return {"status": "skipped","message" :"Driver is not available"}
        
        active_orders = self.get_active_orders_for_driver(driver_id)
        available_slots = 3 - len(active_orders)
        if available_slots <= 0:
            return {"status": "skipped","message" :"Driver is full" }
        
        pending_orders = self.db.query(Order).filter(
            Order.status == OrderStatus.pending.value,
            Order.pickup_zone == zone_id
        ).all()
        
        if not pending_orders:
            return {"status": "skipped","message" :"No pending orders in this zone" }
        
        anchor_order = pending_orders[0]
        batched_orders = [anchor_order]

        for order in pending_orders[1:]:
            if len(batched_orders) >= available_slots:
                break
            
            pickup_dist = self.db.query(
                ST_Distance(
                    WKTElement(f'POINT({anchor_order.pickup_longitude} {anchor_order.pickup_latitude})', srid=4326),
                    WKTElement(f'POINT({order.pickup_longitude} {order.pickup_latitude})', srid=4326),
                    True
                )
            ).scalar()
            
            dropoff_dist = self.db.query(
                ST_Distance(
                    WKTElement(f'POINT({anchor_order.dropoff_longitude} {anchor_order.dropoff_latitude})', srid=4326),
                    WKTElement(f'POINT({order.dropoff_longitude} {order.dropoff_latitude})', srid=4326),
                    True
                )
            ).scalar()
            
            if (pickup_dist is not None and pickup_dist <= 100) and (dropoff_dist is not None and dropoff_dist <= 3000):
                batched_orders.append(order)
        
        order_ids = [order.order_id for order in batched_orders]

        routing_engine = RoutingEngine(self.db)
        result = routing_engine.dispatch(driver_id, order_ids)

        return result

    def handle_driver_emergency(self, driver_id: str, lat: float, lng: float):
        driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
        if not driver:
            return
        
        driver.status = DriverStatus.OFFLINE.value
        self.db.commit()

        active_orders = self.get_active_orders_for_driver(driver_id)
        if not active_orders:
            return
        
        routing_engine = RoutingEngine(self.db)
        
        for order in active_orders:
            logger.info(f"Initiating Rescue Protocol for Order {order.order_id}")

            if order.status == OrderStatus.picked_up.value:
                order.pickup_latitude = lat
                order.pickup_longitude = lng
                order.pickup_address = "EMERGENCY RETRIEVAL: Driver Incident Location"
                order.pickup = WKTElement(f'POINT({lng} {lat})', srid=4326)
            
            order.status = OrderStatus.pending.value
            order.driver_id = None
            self.db.commit()

            nearby_drivers = self._get_drivers_with_capacity(
                latitude=lat,
                longitude=lng,
                radius_km=15.0,
                limit=1,
                exclude_driver_ids=[driver_id]
            )

            if nearby_drivers:
                rescue_driver = nearby_drivers[0]
                routing_engine.dispatch(rescue_driver.driver_id, [order.order_id], is_emergency=True)
                emit_sync(socket_manager.notify_driver_status_change(
                    rescue_driver.driver_id,
                    "EMERGENCY_DISPATCH"
                ))
            else:
                logger.error(f"No available drivers found for Order {order.order_id}")