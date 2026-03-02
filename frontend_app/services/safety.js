import { apiFetch } from "@/lib/http";

export async function submitSensorData(token, sensorBatch) {
    return apiFetch("/safety/sensor-data", {
        method: "POST",
        token,
        body: sensorBatch
    });
}

export async function getDistanceStats(token, sessionId) {
    return apiFetch(`/safety/distance-stats/${sessionId}`, { token });
}


export async function getTodayDistance(token) {
    return apiFetch("/safety/distance/today", { token });
}


export async function getAlerts(token, options = {}) {
    const params = new URLSearchParams();
    if (options.driverId) params.append("driver_id", options.driverId);
    if (options.alertType) params.append("alert_type", options.alertType);
    if (options.acknowledged !== undefined) params.append("acknowledged", options.acknowledged);

    const queryString = params.toString() ? `?${params.toString()}` : "";
    return apiFetch(`/safety/alerts${queryString}`, { token });
}


export async function acknowledgeAlert(token, alertId, acknowledged = true) {
    return apiFetch(`/safety/alerts/${alertId}/acknowledge`, {
        method: "PATCH",
        token,
        body: { acknowledged }
    });
}

export async function respondToEmergency(token, driverId, status) {
    return apiFetch("/safety/emergency-response", {
        method: "POST",
        token,
        body: { driver_id: driverId, status }
    });
}
