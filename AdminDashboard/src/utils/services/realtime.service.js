/**
 * WebSocket Service for Real-time Updates
 *
 * This service provides real-time updates for:
 * - Driver locations
 * - Order status changes
 * - Safety alerts
 * - System notifications
 *
 * Note: Currently using polling as a fallback.
 * TODO: Implement actual WebSocket/Kafka consumer when backend supports it
 */
class RealtimeService {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.listeners = new Map();
        this.reconnectInterval = 5000;
        this.reconnectTimer = null;
        this.isConnecting = false;
    }
    connect() {
        if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            return;
        }
        this.isConnecting = true;
        try {
            const token = localStorage.getItem('optiride_token');
            const wsUrl = token ? `${this.url}?token=${token}` : this.url;
            this.ws = new WebSocket(wsUrl);
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.isConnecting = false;
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
            };
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.emit(message.type, message.data);
                }
                catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.isConnecting = false;
            };
            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.isConnecting = false;
                this.ws = null;
                this.scheduleReconnect();
            };
        }
        catch (error) {
            console.error('Error creating WebSocket:', error);
            this.isConnecting = false;
            this.scheduleReconnect();
        }
    }
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.listeners.clear();
    }
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }
    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }
    emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(callback => callback(data));
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer) {
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectInterval);
    }
    send(type, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, data }));
        }
        else {
            console.warn('WebSocket not connected. Message not sent.');
        }
    }
}
// Singleton instance
// TODO: Update this URL when backend WebSocket endpoint is available
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws';
export const realtimeService = new RealtimeService(WS_URL);
// React hook for using realtime updates
import { useEffect } from 'react';
export function useRealtimeEvent(event, callback) {
    useEffect(() => {
        realtimeService.on(event, callback);
        return () => {
            realtimeService.off(event, callback);
        };
    }, [event, callback]);
}
/**
 * Example Usage:
 *
 * // In a component:
 * useRealtimeEvent('driver_location', (data) => {
 *   console.log('Driver location updated:', data);
 *   // Update your state/map with new location
 * });
 *
 * useRealtimeEvent('safety_alert', (data) => {
 *   console.log('Safety alert:', data);
 *   // Show notification or update alerts list
 * });
 */

