/**
 * Route Service - Fetches directions from Google Maps Directions API
 * Routes can later be optimized using ML algorithms
 */

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

/**
 * Decode Google Maps polyline encoding to coordinates
 * @param {string} encoded - Encoded polyline string
 * @returns {Array<{latitude: number, longitude: number}>}
 */
export function decodePolyline(encoded) {
    if (!encoded) return [];

    const poly = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        let b;
        let shift = 0;
        let result = 0;

        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);

        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;

        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);

        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        poly.push({
            latitude: lat / 1e5,
            longitude: lng / 1e5,
        });
    }

    return poly;
}

/**
 * Fetch route directions from Google Maps Directions API
 * @param {Object} origin - Origin coordinates {latitude, longitude}
 * @param {Object} destination - Destination coordinates {latitude, longitude}
 * @param {Array<Object>} waypoints - Optional waypoints
 * @returns {Promise<Object>} Route data with coordinates and metadata
 */
export async function fetchRouteDirections(origin, destination, waypoints = []) {
    if (!GOOGLE_MAPS_API_KEY) {
        console.warn("Google Maps API key not configured, using straight line");
        return {
            coordinates: [origin, destination],
            distance: null,
            duration: null,
            isEstimate: true,
        };
    }

    try {
        const originStr = `${origin.latitude},${origin.longitude}`;
        const destStr = `${destination.latitude},${destination.longitude}`;

        let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destStr}&key=${GOOGLE_MAPS_API_KEY}`;

        // Add waypoints if provided
        if (waypoints.length > 0) {
            const waypointsStr = waypoints
                .map(wp => `${wp.latitude},${wp.longitude}`)
                .join('|');
            url += `&waypoints=${waypointsStr}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
            console.warn("Directions API error:", data.status);
            return {
                coordinates: [origin, destination],
                distance: null,
                duration: null,
                isEstimate: true,
                error: data.status,
            };
        }

        const route = data.routes[0];
        const leg = route.legs[0];

        // Decode the polyline to get detailed route coordinates
        const coordinates = decodePolyline(route.overview_polyline.points);

        return {
            coordinates,
            distance: leg.distance.value / 1000, // Convert meters to km
            distanceText: leg.distance.text,
            duration: leg.duration.value / 60, // Convert seconds to minutes
            durationText: leg.duration.text,
            startAddress: leg.start_address,
            endAddress: leg.end_address,
            isEstimate: false,
            // Store raw data for ML optimization later
            rawRoute: {
                bounds: route.bounds,
                legs: route.legs,
                summary: route.summary,
            },
        };
    } catch (error) {
        console.error("Error fetching directions:", error);
        return {
            coordinates: [origin, destination],
            distance: null,
            duration: null,
            isEstimate: true,
            error: error.message,
        };
    }
}

/**
 * Fetch route with driver's current location as starting point
 * @param {Object} driverLocation - Driver's current location
 * @param {Object} pickupLocation - Pickup/restaurant location
 * @param {Object} dropoffLocation - Dropoff/customer location
 * @returns {Promise<Object>} Complete route data with two legs
 */
export async function fetchDeliveryRoute(driverLocation, pickupLocation, dropoffLocation) {
    // Get route from driver to pickup
    const toPickup = await fetchRouteDirections(driverLocation, pickupLocation);

    // Get route from pickup to dropoff
    const toDropoff = await fetchRouteDirections(pickupLocation, dropoffLocation);

    return {
        toPickup,
        toDropoff,
        totalDistance: (toPickup.distance || 0) + (toDropoff.distance || 0),
        totalDuration: (toPickup.duration || 0) + (toDropoff.duration || 0),
    };
}
