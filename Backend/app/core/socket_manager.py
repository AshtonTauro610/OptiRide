import socketio
from typing import Dict, Any
import asyncio

sio_server = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*'
)

sio_app = socketio.ASGIApp(
    socketio_server=sio_server,
    socketio_path='socket.io'
)

class SocketManager:
    @staticmethod
    @sio_server.event
    async def connect(sid, environ, auth):
        print(f"Client connected: {sid}")
        #TODO: validate token
    
    @staticmethod
    @sio_server.event
    async def join(sid, data):
        user_id = data.get("user_id")
        room_type = data.get("room_type", "user")
        if user_id:
            print(f"User {user_id} joined room type: {room_type}")
            await sio_server.enter_room(sid, f"{room_type}_{user_id}")
    
    @staticmethod
    @sio_server.event
    async def join_zone(sid, data):
        zone_id = data.get("zone_id")
        if zone_id:
            await sio_server.enter_room(sid, f"zone_{zone_id}")
    
    @staticmethod
    @sio_server.event
    async def disconnect(sid):
        print(f"Client disconnected: {sid}")
    
    # Order notifications
    @staticmethod
    async def notify_order_update(order_id: str, update_data: Dict[str, Any]):
        await sio_server.emit("order_update", {
            "order_id": order_id,
            "update_data": update_data
        }, room=f"order_{order_id}")
    
    @staticmethod
    async def notify_new_order_to_driver(driver_id: str, order_data: Dict[str, Any]):
        await sio_server.emit("new_order", order_data, room=f"driver_{driver_id}")
    
    @staticmethod
    async def notify_order_offer(driver_id: str, order_data: Dict[str, Any]):
        await sio_server.emit("order_offer", order_data, room=f"driver_{driver_id}")
    
    @staticmethod
    async def notify_order_accepted(order_id: str, driver_id: str, driver_name: str):
        await sio_server.emit("order_accepted", {
            "order_id": order_id,
            "driver_id": driver_id,
            "driver_name": driver_name
        }, room=f"order_{order_id}")
    
    @staticmethod
    async def notify_order_picked_up(order_id: str):
        await sio_server.emit("order_picked_up", {"order_id": order_id}, room=f"order_{order_id}")
    
    @staticmethod
    async def notify_order_delivered(order_id: str):
        await sio_server.emit("order_delivered", {"order_id": order_id}, room=f"order_{order_id}")
    
    # Driver notifications
    @staticmethod
    async def notify_driver_location(driver_id: str, location: Dict[str, Any]):
        await sio_server.emit("driver_location", {
            "driver_id": driver_id,
            "location": location
        }, room=f"driver_{driver_id}")
    
    @staticmethod
    async def notify_driver_status_change(driver_id: str, new_status: str):
        await sio_server.emit("driver_status", {
            "driver_id": driver_id,
            "status": new_status
        }, room=f"driver_{driver_id}")

    @staticmethod
    async def notify_driver_allocation(driver_id: str, zone_id: str, zone_lat: float = None, zone_lon: float = None, zone_name: str = None):
        payload = {
            "driver_id": driver_id,
            "zone_id": zone_id
        }
        if zone_lat is not None:
            payload["latitude"] = zone_lat
        if zone_lon is not None:
            payload["longitude"] = zone_lon
        if zone_name is not None:
            payload["zone_name"] = zone_name
            
        await sio_server.emit("driver_allocated", payload, room=f"driver_{driver_id}")
    
    # Safety alerts
    @staticmethod
    async def notify_safety_alert(driver_id: str, alert_data: Dict[str, Any]):
        await sio_server.emit("safety_alert", alert_data, room=f"driver_{driver_id}")
    
    # Zone broadcasts
    @staticmethod
    async def broadcast_to_zone(zone_id: str, event: str, data: Dict[str, Any]):
        await sio_server.emit(event, data, room=f"zone_{zone_id}")
    
    @staticmethod
    async def broadcast_new_order_to_zone(zone_id: str, order_data: Dict[str, Any]):
        await sio_server.emit("zone_new_order", order_data, room=f"zone_{zone_id}")
    
    @staticmethod
    async def notify_driver_assignment(driver_id: str, assignment_data: Dict[str, Any]):
        await sio_server.emit("driver_assigned", assignment_data, room=f"driver_{driver_id}")

    @staticmethod
    async def notify_order_offer_expired(driver_id: str, order_id: str):
        await sio_server.emit("order_offer_expired", {"order_id": order_id}, room=f"driver_{driver_id}")

socket_manager = SocketManager()

def emit_sync(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(coro)
        else:
            loop.run_until_complete(coro)
    except RuntimeError:
        asyncio.run(coro)
