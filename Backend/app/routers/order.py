from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from app.db.database import get_db
from app.core.dependencies import get_current_driver, get_current_admin, get_current_user
from app.core.socket_manager import socket_manager, emit_sync
from app.models.user import User
from app.models.driver import Driver
from app.services.order_service import OrderService
from app.schemas.order import OrderAssign, OrderCreate, OrderDeliver, OrderPickup, OrderResponse, OrderUpdate, OrderStats, OrderStatus
from geoalchemy2.functions import ST_X, ST_Y
from app.models.order import Order
from geoalchemy2.functions import ST_Distance

class DispatchOrderRequest(BaseModel):
    driver_id: str
    zone_id: str
    
router = APIRouter()

@router.post("/", response_model=OrderResponse)
async def create_order(
    order_data: OrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    order_service = OrderService(db)
    order = order_service.create_order(order_data)
    
    # Notify zone about new order
    if order.pickup_zone:
        await socket_manager.broadcast_new_order_to_zone(order.pickup_zone, {
            "order_id": order.order_id,
            "pickup_address": order.pickup_address,
            "dropoff_address": order.dropoff_address,
            "price": order.price
        })

    return order

@router.post("/webhook/new-order", response_model=OrderResponse)
async def webhook_create_order(
    order_data: OrderCreate,
    auto_assign: bool = False,
    driver_id: Optional[str] = None,
    db: Session = Depends(get_db)
):

    order_service = OrderService(db)
    order = order_service.create_order(order_data)
    
    # If specific driver_id provided, assign to that driver
    if driver_id:
        try:
            order = order_service.offer_to_driver(order.order_id, driver_id)
            await socket_manager.notify_new_order_to_driver(driver_id, {
                "order_id": order.order_id,
                "pickup_address": order.pickup_address,
                "pickup_latitude": order.pickup_latitude,
                "pickup_longitude": order.pickup_longitude,
                "dropoff_address": order.dropoff_address,
                "dropoff_latitude": order.dropoff_latitude,
                "dropoff_longitude": order.dropoff_longitude,
                "customer_name": order.customer_name,
                "customer_contact": order.customer_contact,
                "restaurant_name": order.restaurant_name,
                "restaurant_contact": order.restaurant_contact,
                "price": order.price,
                "estimated_distance_km": order.distance_km,
                "estimated_duration_min": order.duration_min,
                "estimated_pickup_time": order.pickup_time.isoformat() if order.pickup_time else None,
                "estimated_dropoff_time": order.dropoff_time.isoformat() if order.dropoff_time else None,
            })
        except HTTPException:
            pass
    elif auto_assign:
        try:
            order = order_service.auto_assign_order(order.order_id)
            # Notify driver about new order offer with complete order data
            if order.driver_id:
                await socket_manager.notify_new_order_to_driver(order.driver_id, {
                    "order_id": order.order_id,
                    "pickup_address": order.pickup_address,
                    "pickup_latitude": order.pickup_latitude,
                    "pickup_longitude": order.pickup_longitude,
                    "dropoff_address": order.dropoff_address,
                    "dropoff_latitude": order.dropoff_latitude,
                    "dropoff_longitude": order.dropoff_longitude,
                    "customer_name": order.customer_name,
                    "customer_contact": order.customer_contact,
                    "restaurant_name": order.restaurant_name,
                    "restaurant_contact": order.restaurant_contact,
                    "price": order.price,
                    "estimated_distance_km": order.distance_km,
                    "estimated_duration_min": order.duration_min,
                    "estimated_pickup_time": order.pickup_time.isoformat() if order.pickup_time else None,
                    "estimated_dropoff_time": order.dropoff_time.isoformat() if order.dropoff_time else None,
                })
        except HTTPException:
            pass
    
    # Notify zone about new order
    if order.pickup_zone:
        await socket_manager.broadcast_new_order_to_zone(order.pickup_zone, {
            "order_id": order.order_id,
            "pickup_address": order.pickup_address,
            "price": order.price
        })
    
    return order

@router.get("/", response_model=List[OrderResponse])
def get_all_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
    status: Optional[OrderStatus] = None,
    driver_id: Optional[str] = None,
    pickup_zone: Optional[str] = None,
):
    order_service = OrderService(db)
    orders = order_service.get_orders(status=status, driver_id=driver_id, pickup_zone=pickup_zone)
    return orders

@router.get("/pending")
def get_pending_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
    zone_id: Optional[str] = None
):
    order_service = OrderService(db)
    orders = order_service.get_pending_orders(zone_id=zone_id)
    
    return {
        "count": len(orders),
        "orders": [OrderResponse.model_validate(order) for order in orders]
    }

@router.get("/active-locations")
def get_active_order_locations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    order_service = OrderService(db)
    locations = order_service.get_active_order_locations()
    return locations

@router.get("/stats", response_model=OrderStats)
def get_order_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    order_service = OrderService(db)
    start_dt = datetime.fromisoformat(start_date) if start_date else None
    end_dt = datetime.fromisoformat(end_date) if end_date else None
    stats = order_service.get_order_stats(start_date=start_dt, end_date=end_dt)
    return stats

@router.get("/{order_id}", response_model=OrderResponse)
def get_order_by_id(
    order_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    order_service = OrderService(db)
    order = order_service.get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order

@router.patch("/{order_id}", response_model=OrderResponse)
async def update_order(
    order_id: str,
    order_data: OrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    order_service = OrderService(db)
    order = order_service.update_order(order_id, order_data)
    
    # Notify about order update
    await socket_manager.notify_order_update(order_id, {"status": order.status})
    return order
    
@router.post("/{order_id}/assign", response_model=OrderResponse)
async def assign_order(
    order_id: str,
    assign_data: OrderAssign,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    order_service = OrderService(db)
    order = order_service.assign_order(order_id, assign_data)
    
    # Notify driver about assignment
    await socket_manager.notify_new_order_to_driver(order.driver_id, {
        "order_id": order.order_id,
        "pickup_address": order.pickup_address,
        "dropoff_address": order.dropoff_address,
        "price": order.price
    })
    return order

@router.post("/{order_id}/auto-assign", response_model=OrderResponse)
async def auto_assign_order(
    order_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    order_service = OrderService(db)
    order = order_service.auto_assign_order(order_id)
    
    # Notify driver about new order offer
    if order.driver_id:
        await socket_manager.notify_new_order_to_driver(order.driver_id, {
            "order_id": order.order_id,
            "pickup_address": order.pickup_address,
            "dropoff_address": order.dropoff_address,
            "price": order.price,
            "distance_km": order.distance_km
        })
    return order

@router.post("/{order_id}/accept", response_model=OrderResponse)
async def accept_order(
    order_id: str,
    db: Session = Depends(get_db),
    driver: Driver = Depends(get_current_driver)
):
    order_service = OrderService(db)
    order = order_service.accept_order(order_id=order_id, driver_id=driver.driver_id)
    
    # Notify customer that order was accepted
    await socket_manager.notify_order_accepted(order.order_id, driver.driver_id, driver.name)
    return order

@router.post("/{order_id}/reject", response_model=OrderResponse)
async def reject_order(
    order_id: str,
    db: Session = Depends(get_db),
    driver: Driver = Depends(get_current_driver)
):
    order_service = OrderService(db)
    order = order_service.reject_order(order_id=order_id, driver_id=driver.driver_id)
    return order

@router.get("/offered/me", response_model=List[OrderResponse])
def get_my_offered_orders(
    db: Session = Depends(get_db),
    driver: Driver = Depends(get_current_driver)
):
    
    # Exclusive offers assigned to this driver
    exclusive = db.query(Order).filter(
        Order.driver_id == driver.driver_id,
        Order.status == OrderStatus.offered.value
    ).all()
    
    # Broadcast offers (driver_id is NULL) within 10km
    broadcast = []
    if driver.location is not None:
        broadcast = db.query(Order).filter(
            Order.driver_id.is_(None),
            Order.status == OrderStatus.offered.value,
            ST_Distance(Order.pickup, driver.location, True) <= 10000  # 10km in meters
        ).all()
    
    # Combine and deduplicate
    seen = set()
    combined = []
    for o in exclusive + broadcast:
        if o.order_id not in seen:
            seen.add(o.order_id)
            combined.append(o)
    
    return combined

@router.get("/driver/orders")
def get_driver_orders(
    db: Session = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
):
    """Get active orders for the current driver (assigned, picked_up)"""
    order_service = OrderService(db)
    orders = order_service.get_active_orders_for_driver(driver_id=current_driver.driver_id)
    return {
        "count": len(orders),
        "orders": [OrderResponse.model_validate(order) for order in orders]
    }

@router.get("/driver/all-orders")
def get_all_driver_orders(
    db: Session = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver),
    include_completed: bool = True,
    days: int = 7,
):
    """Get all orders for the current driver (including completed and cancelled)"""
    order_service = OrderService(db)
    orders = order_service.get_all_orders_for_driver(
        driver_id=current_driver.driver_id,
        include_completed=include_completed,
        days=days
    )
    return {
        "count": len(orders),
        "orders": [OrderResponse.model_validate(order) for order in orders]
    }

@router.post("/{order_id}/pickup", response_model=OrderResponse)
async def pickup_order(
    order_id: str,
    pickup_data: OrderPickup,
    db: Session = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver)
):
    order_service = OrderService(db)
    order = order_service.picked_up(order_id, pickup_data)
    
    # Notify customer about pickup
    await socket_manager.notify_order_picked_up(order.order_id)
    return order

@router.post("/{order_id}/deliver", response_model=OrderResponse)
async def deliver_order(
    order_id: str,
    deliver_data: OrderDeliver,
    db: Session = Depends(get_db),
    current_driver: Driver = Depends(get_current_driver)
):
    order_service = OrderService(db)
    order = order_service.delivered(order_id, deliver_data)
    
    # Notify customer about delivery
    await socket_manager.notify_order_delivered(order.order_id)
    return order

@router.post("/dispatch")
async def dispatch_order(
    request: DispatchOrderRequest,
    db: Session = Depends(get_db),
    admin = Depends(get_current_admin)
):
    order_service = OrderService(db)
    order = order_service.dispatch_orders(request.driver_id, request.zone_id)
    return order
