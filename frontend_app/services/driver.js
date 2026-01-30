import { apiFetch } from "@/lib/http";

/**
 * Fetch the current driver's profile
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Driver profile data
 */
export async function fetchDriverProfile(token) {
    return apiFetch("/drivers/me", { token });
}

/**
 * Fetch the current driver's performance statistics
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Performance stats data
 */
export async function fetchDriverPerformanceStats(token) {
    return apiFetch("/drivers/me/performance-stats", { token });
}

/**
 * Update driver's current location
 * @param {string} token - Auth token
 * @param {Object} location - { latitude, longitude, speed?, heading? }
 * @returns {Promise<Object>} Updated location data
 */
export async function updateDriverLocation(token, location) {
    return apiFetch("/drivers/me/location", {
        method: "POST",
        token,
        body: location
    });
}

/**
 * Update driver's online/offline status
 * @param {string} token - Auth token
 * @param {string} status - "available" | "offline" | "busy" | "on_break"
 * @returns {Promise<Object>} Updated status
 */
export async function updateDriverStatus(token, status) {
    return apiFetch("/drivers/me/status", {
        method: "POST",
        token,
        body: { status }
    });
}

/**
 * Start driver's shift (Go On-Duty)
 * @param {string} token - Auth token
 * @param {Object} data - { start_time, start_latitude, start_longitude }
 * @returns {Promise<Object>} Updated profile
 */
export async function startShift(token, data) {
    return apiFetch("/drivers/me/shift/start", {
        method: "POST",
        token,
        body: data
    });
}

/**
 * End driver's shift (Go Off-Duty)
 * @param {string} token - Auth token
 * @param {Object} data - { end_time, end_latitude, end_longitude }
 * @returns {Promise<Object>} Shift summary
 */
export async function endShift(token, data) {
    return apiFetch("/drivers/me/shift/end", {
        method: "POST",
        token,
        body: data
    });
}
/**
 * Update driver's device telemetry (battery, network, etc.)
 * @param {string} token - Auth token
 * @param {Object} telemetry - { battery_level?, network_strength?, camera_active? }
 * @returns {Promise<Object>} Updated profile
 */
export async function updateTelemetry(token, telemetry) {
    return apiFetch("/drivers/me/telemetry", {
        method: "PATCH",
        token,
        body: telemetry
    });
}
