from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException, status
from typing import Optional, List, Tuple, Dict, Any
from datetime import datetime, timedelta
from geoalchemy2.functions import ST_Distance, ST_MakePoint, ST_X, ST_Y
from geoalchemy2.elements import WKTElement
import googlemaps
from app.core.config import settings
from app.core.kafka import kafka_producer
from app.models.order import Order
from app.models.driver import Driver
from app.services.driver_service import DriverService
from app.schemas.driver import DriverStatus
from app.schemas.order import (
    OrderCreate, OrderUpdate, OrderAssign, OrderPickup, OrderDeliver,
    OrderStats, OrderStatus)




class OrderService:
    def __init__(self, db: Session):
        self.db = db
    
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
        
        # Check driver capacity - ensure driver doesn't have too many active orders
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
        
        order.driver_id = assign_data.driver_id
        order.status = OrderStatus.assigned.value
        order.assigned_at = datetime.utcnow()
        driver.status = DriverStatus.BUSY.value
        driver.orders_received += 1
        order.pickup_time = assign_data.pickup_time
        order.dropoff_time = assign_data.dropoff_time


        self.db.commit()
        self.db.refresh(order)

        kafka_producer.publish("order-assigned", {
            "order_id": order.order_id,
            "driver_id": order.driver_id,
            "assigned_at": str(order.assigned_at)
        })

        return order
    
    def auto_assign_order(self, order_id: str) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        driver_service = DriverService(self.db)
        nearby_drivers = driver_service.get_nearby_drivers(
            latitude=order.pickup_latitude, longitude=order.pickup_longitude,
            radius_km=10.0, status=DriverStatus.AVAILABLE, limit=1)
        
        if not nearby_drivers:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No available drivers nearby")
        
        closest_driver = nearby_drivers[0]

        avg_speed_kmh = 50.0
        travel_time_min = ((closest_driver.distance_meters / 1000) / avg_speed_kmh) * 60
        pickup_time = datetime.utcnow() + timedelta(minutes=travel_time_min)
        delivery_time = pickup_time + timedelta(minutes=order.duration_min or 25)

        # Offer to driver (not assigned yet - driver must accept)
        order.driver_id = closest_driver.driver_id
        order.status = OrderStatus.offered.value  # Changed from assigned
        order.pickup_time = pickup_time
        order.dropoff_time = delivery_time
        
        self.db.commit()
        self.db.refresh(order)
        
        # TODO: Send push notification to driver about new order offer
        
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
        
        if order.driver_id != driver_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="This order was not offered to you"
            )
        
        # Check driver capacity
        MAX_CONCURRENT_ORDERS = 3
        active_orders_count = self.db.query(Order).filter(
            Order.driver_id == driver_id,
            Order.status.in_([OrderStatus.assigned.value, OrderStatus.picked_up.value])
        ).count()
        
        if active_orders_count >= MAX_CONCURRENT_ORDERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail=f"You already have {active_orders_count} active orders. Maximum is {MAX_CONCURRENT_ORDERS}."
            )
        
        # Accept the order
        order.status = OrderStatus.assigned.value
        order.assigned_at = datetime.utcnow()
        
        driver = self.db.query(Driver).filter(Driver.driver_id == driver_id).first()
        if driver:
            driver.status = DriverStatus.BUSY.value
            driver.orders_received += 1
        
        self.db.commit()
        self.db.refresh(order)
        
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
        
        if order.driver_id != driver_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="This order was not offered to you"
            )
        
        # Reject the order - return to pending
        order.status = OrderStatus.pending.value
        order.driver_id = None
        order.pickup_time = None
        order.dropoff_time = None
        
        self.db.commit()
        self.db.refresh(order)
        
        # TODO: Offer to next nearest driver or return to pool
        
        return order
    
    def picked_up(self, order_id: str, pickup_data: OrderPickup) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        if order.status != OrderStatus.assigned.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order is not in assigned status")
        
        order.status = OrderStatus.picked_up.value
        order.picked_up_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(order)

        kafka_producer.publish("order-picked-up", {
            "order_id": order.order_id,
            "driver_id": order.driver_id,
            "picked_up_at": str(order.picked_up_at)
        })
        return order
    
    def delivered(self, order_id: str, deliver_data: OrderDeliver) -> Order:
        order = self.get_order(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
        
        if order.status != OrderStatus.picked_up.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order is not in picked up status")
        
        order.status = OrderStatus.delivered.value
        order.delivered_at = datetime.utcnow()

        if order.assigned_at:
            duration = (order.delivered_at - order.assigned_at).total_seconds() / 60.0
            order.duration_min = duration
        # TODO: Calculate actual distance using GPS data points
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
    
    def calculate_order_info(self, order: Order):
        try:
            gmaps = googlemaps.Client(key=settings.GOOGLE_MAPS_API_KEY)
            directions = gmaps.directions(
                (order.pickup_latitude, order.pickup_longitude),
                (order.dropoff_latitude, order.dropoff_longitude),
                mode="driving",
                departure_time="now"
            )

            if directions:
                leg = directions[0]['legs'][0]
                distance_km = leg['distance']['value'] / 1000.0
                duration_data = leg.get('duration_in_traffic', leg.get('duration', {}))
                duration_min = duration_data.get('value', 0) / 60.0
                
                order.distance_km = round(distance_km, 2)
                order.duration_min = round(duration_min, 1)
                order.route_polyline = directions[0]['overview_polyline']['points']
                print(f"Maps API Response: {distance_km} km, {duration_min} min")
            else:
                raise Exception("No directions returned")

        except Exception as e:
            print(f"Google Maps API Error: {e}")
            print("Using fallback distance calculation")

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
        order.price = round(base_fee + (order.distance_km * per_km_rate), 2)

    def assign_zones(self, order: Order):
        # TODO: Implement zone assignment using clustering
        return