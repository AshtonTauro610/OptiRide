const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

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

export async function fetchRouteDirections(origin, destination, waypoints = [], options = {}) {
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

        let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destStr}&key=${GOOGLE_MAPS_API_KEY}&departure_time=now`;

        // Add waypoints if provided
        if (waypoints && waypoints.length > 0) {
            let waypointsStr = waypoints
                .map(wp => `${wp.latitude},${wp.longitude}`)
                .join('|');
            if (options.optimize) {
                waypointsStr = `optimize:true|` + waypointsStr;
            }
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

        const coordinates = decodePolyline(route.overview_polyline.points);

        let totalDistance = 0;
        let totalDuration = 0;
        for (const leg of route.legs) {
            totalDistance += leg.distance?.value || 0;
            totalDuration += leg.duration?.value || 0;
        }

        return {
            coordinates,
            distance: totalDistance / 1000, // Convert meters to km
            distanceText: route.legs[0]?.distance?.text || "",
            duration: totalDuration / 60, // Convert seconds to minutes
            durationText: route.legs[0]?.duration?.text || "",
            startAddress: route.legs[0]?.start_address || "",
            endAddress: route.legs[route.legs.length - 1]?.end_address || "",
            isEstimate: false,
            waypointOrder: route.waypoint_order || [],
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


export async function fetchDeliveryRoute(driverLocation, pickupLocation, dropoffLocation) {
    const toPickup = await fetchRouteDirections(driverLocation, pickupLocation);
    const toDropoff = await fetchRouteDirections(pickupLocation, dropoffLocation);

    return {
        toPickup,
        toDropoff,
        totalDistance: (toPickup.distance || 0) + (toDropoff.distance || 0),
        totalDuration: (toPickup.duration || 0) + (toDropoff.duration || 0),
    };
}
export async function fetchMultiOrderRoute(driverLocation, activeOrders) {
    if (!activeOrders || activeOrders.length === 0) return null;

    let unconfirmedPickups = [];
    let dropoffs = [];

    const pickupKeys = new Set();
    const dropoffKeys = new Set();

    for (const order of activeOrders) {
        if (!order.pickupConfirmed) {
            const pKey = `${order.pickupLatitude},${order.pickupLongitude}`;
            if (!pickupKeys.has(pKey)) {
                unconfirmedPickups.push({
                    latitude: order.pickupLatitude || 25.2048,
                    longitude: order.pickupLongitude || 55.2708,
                    orderId: order.id,
                    seqId: `pickup_${order.id}`,
                    metadata: { type: 'pickup', title: order.restaurant }
                });
                pickupKeys.add(pKey);
            }
        }

        const dKey = `${order.dropoffLatitude},${order.dropoffLongitude}`;
        if (!dropoffKeys.has(dKey)) {
            dropoffs.push({
                latitude: order.dropoffLatitude || 25.197,
                longitude: order.dropoffLongitude || 55.278,
                orderId: order.id,
                seqId: `dropoff_${order.id}`,
                metadata: { type: 'dropoff', title: `${order.restaurant}` }
            });
            dropoffKeys.add(dKey);
        }
    }

    let backendSequence = activeOrders.find(o => o.optimized_sequence)?.optimized_sequence;
    console.log("[Route.js] Raw backendSequence:", backendSequence, "typeof:", typeof backendSequence);

    if (typeof backendSequence === 'string') {
        try {
            backendSequence = JSON.parse(backendSequence);
        } catch (e) {
            console.log("[Route.js] Failed to parse sequence:", e);
        }
    }

    let allStops = [...unconfirmedPickups, ...dropoffs];

    if (backendSequence && Array.isArray(backendSequence)) {
        allStops.sort((a, b) => {
            const indexA = backendSequence.indexOf(a.seqId);
            const indexB = backendSequence.indexOf(b.seqId);

            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;

            return indexA - indexB;
        });

        unconfirmedPickups = allStops.filter(s => s.metadata.type === 'pickup');
        dropoffs = allStops.filter(s => s.metadata.type === 'dropoff');
    }
    unconfirmedPickups.forEach((p, i) => p.pinIndex = i + 1);
    dropoffs.forEach((d, i) => d.pinIndex = i + 1);

    if (allStops.length === 0) return null;

    const destination = allStops[allStops.length - 1];
    const waypoints = allStops.slice(0, -1);

    const fullRoute = await fetchRouteDirections(driverLocation, destination, waypoints, { optimize: false });
    let toPickupLegacy = null;
    let toDropoffLegacy = null;
    if (activeOrders.length === 1 && fullRoute && fullRoute.rawRoute && fullRoute.rawRoute.legs) {
        if (fullRoute.rawRoute.legs.length > 0) {
            toPickupLegacy = {
                distance: fullRoute.rawRoute.legs[0].distance.value / 1000,
                duration: fullRoute.rawRoute.legs[0].duration.value / 60
            };
        }
        if (fullRoute.rawRoute.legs.length > 1) {
            toDropoffLegacy = {
                distance: fullRoute.rawRoute.legs[1].distance.value / 1000,
                duration: fullRoute.rawRoute.legs[1].duration.value / 60
            };
        }
    }

    return {
        toPickup: toPickupLegacy,
        toDropoff: toDropoffLegacy,

        totalDistance: fullRoute?.distance || 0,
        totalDuration: fullRoute?.duration || 0,
        isMultiStop: activeOrders.length > 1,
        pickups: unconfirmedPickups,
        dropoffs: dropoffs,

        fullRoute: fullRoute,
        sequence: allStops.map((stop, index) => ({
            ...stop,
            stopIndex: stop.pinIndex,
            estimatedSecondsToReach: (fullRoute?.rawRoute?.legs?.[index]?.duration?.value || 0),
            distanceMetersToReach: (fullRoute?.rawRoute?.legs?.[index]?.distance?.value || 0)
        }))
    };
}
