import { apiFetch } from "@/lib/http";

/**
 * Submit sensor data batch to backend for safety analysis
 * @param {string} token - Auth token
 * @param {Object} sensorBatch - Sensor data batch
 * @returns {Promise<Object>} Analysis results
 */
export async function submitSensorData(token, sensorBatch) {
    return apiFetch("/safety/sensor-data", {
        method: "POST",
        token,
        body: sensorBatch
    });
}

/**
 * Get distance stats for a session
 * @param {string} token - Auth token
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Distance statistics
 */
export async function getDistanceStats(token, sessionId) {
    return apiFetch(`/safety/distance-stats/${sessionId}`, { token });
}

/**
 * Get today's total distance
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Today's distance
 */
export async function getTodayDistance(token) {
    return apiFetch("/safety/distance/today", { token });
}

/**
 * Get alerts for the current driver
 * @param {string} token - Auth token
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} List of alerts
 */
export async function getAlerts(token, options = {}) {
    const params = new URLSearchParams();
    if (options.driverId) params.append("driver_id", options.driverId);
    if (options.alertType) params.append("alert_type", options.alertType);
    if (options.acknowledged !== undefined) params.append("acknowledged", options.acknowledged);

    const queryString = params.toString() ? `?${params.toString()}` : "";
    return apiFetch(`/safety/alerts${queryString}`, { token });
}

/**
 * Acknowledge an alert
 * @param {string} token - Auth token
 * @param {string} alertId - Alert ID
 * @param {boolean} acknowledged - Acknowledgment status
 * @returns {Promise<Object>} Updated alert
 */
export async function acknowledgeAlert(token, alertId, acknowledged = true) {
    return apiFetch(`/safety/alerts/${alertId}/acknowledge`, {
        method: "PATCH",
        token,
        body: { acknowledged }
    });
}
