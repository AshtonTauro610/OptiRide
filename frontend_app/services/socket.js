import { io } from "socket.io-client";
import { API_BASE_URL } from "@/lib/config";

// Don't auto-connect — wait until driver logs in
const socket = io(API_BASE_URL, {
    path: "/ws/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 3000,
    timeout: 5000,
});

socket.on("connect", () => {
    console.log("[Socket] Connected:", socket.id);
});

socket.on("disconnect", (reason) => {
    console.log("[Socket] Disconnected:", reason);
});

socket.on("connect_error", (err) => {
    console.warn("[Socket] Connection error:", err.message);
});

/**
 * Connect socket and join driver-specific room
 * Call this after login with the driver's ID
 */
export function joinDriverRoom(driverId) {
    // Connect if not already connected
    if (!socket.connected) {
        socket.connect();
    }

    const doJoin = () => {
        socket.emit("join", { user_id: driverId, room_type: "driver" });
        console.log("[Socket] Joined driver room:", driverId);
    };

    if (socket.connected) {
        doJoin();
    } else {
        socket.once("connect", doJoin);
    }
}

/**
 * Join zone room to receive zone-level broadcasts
 */
export function joinZoneRoom(zoneId) {
    if (socket.connected) {
        socket.emit("join_zone", { zone_id: zoneId });
    }
}

export default socket;
