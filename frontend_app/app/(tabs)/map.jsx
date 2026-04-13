import { useTheme } from "@/contexts/ThemeContext";
import { useOrders } from "@/contexts/OrdersContext";
import { useSensors, useSensorData } from "@/contexts/SensorContext";
import { useRouter } from "expo-router";
import { Bell, User, Navigation, Gauge, RotateCw, ChevronDown, ChevronUp, MapPin, CheckCircle2 } from "lucide-react-native";
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, View, ActivityIndicator, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { fetchDeliveryRoute, fetchRouteDirections, fetchMultiOrderRoute } from "@/services/route";
import polyline from "@mapbox/polyline";
// create socket service
import socket from "@/services/socket";
import { useAllocationNotification } from "@/contexts/AllocationNotificationContext";


// Only import react-native-maps on native platforms
let MapView, Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE;
if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  Polyline = Maps.Polyline;
  PROVIDER_DEFAULT = Maps.PROVIDER_DEFAULT;
  PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
}

// Default location (Dubai) as fallback
const DEFAULT_LOCATION = {
  latitude: 25.276987,
  longitude: 55.296249,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

export default function MapScreen() {
  const { isDarkMode } = useTheme();
  const router = useRouter();
  const { orders } = useOrders();
  const { isMonitoring, startMonitoring } = useSensors();
  const { currentSpeed, gyroscopeData, locationData } = useSensorData();
  const { navigationTarget, clearNavigationTarget } = useAllocationNotification();
  const [userLocation, setUserLocation] = useState(null);
  const [zoneRouteData, setZoneRouteData] = useState(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);
  const [locationError, setLocationError] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [isStartingSensors, setIsStartingSensors] = useState(false);
  const [optimizedRouteCoords, setOptimizedRouteCoords] = useState([]);
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);

  const mapRef = useRef(null);

  // Refs for tracking active ID to prevent infinite refetching
  const lastActiveOrderIdRef = useRef(null);
  const lastNavTargetIdRef = useRef(null);

  const bgColor = isDarkMode ? "#111827" : "#F9FAFB";

  // Get active orders (assigned or picked_up)
  const activeOrders = useMemo(() => {
    return orders.filter(o => o.status === "assigned" || o.status === "picked_up");
  }, [orders]);

  const activeOrder = activeOrders[0];

  const isPickedUp = activeOrders.length > 0 && activeOrders.every(o => o.pickupConfirmed);

  // Handle starting sensors manually
  const handleStartSensors = async () => {
    console.log('Starting sensors from map...');
    setIsStartingSensors(true);
    try {
      const result = await startMonitoring();
      console.log('Sensors started, result:', result);
    } catch (error) {
      console.error('Failed to start sensors:', error);
    }
    setIsStartingSensors(false);
  };

  // Debug: Log when isMonitoring changes
  useEffect(() => {
    console.log('isMonitoring state changed to:', isMonitoring);
  }, [isMonitoring]);

  // Calculate gyroscope magnitude for display
  const gyroMagnitude = useMemo(() => {
    if (!gyroscopeData) return 0;
    return Math.sqrt(
      gyroscopeData.x ** 2 +
      gyroscopeData.y ** 2 +
      gyroscopeData.z ** 2
    ).toFixed(2);
  }, [gyroscopeData]);

  useEffect(() => {
    getUserLocation();
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleDriverAssigned = (data) => {
      console.log("Driver assigned:", data);
      if (data.polyline) {
        const decodedPoints = polyline.decode(data.polyline);
        const coords = decodedPoints.map(point => ({
          latitude: point[0],
          longitude: point[1],
        }));
        setOptimizedRouteCoords(coords);
      }
    };

    socket.on("driver_assigned", handleDriverAssigned)

    return () => {
      socket.off("driver_assigned", handleDriverAssigned)
    };
  }, []);

  // Fetch route when we have location and active orders
  useEffect(() => {
    const fetchRoute = async () => {
      if (!userLocation || activeOrders.length === 0) {
        setRouteData(null);
        return;
      }

      // Only fetch ONCE when the order state changes to save API costs
      // Cache buster now includes the optimized sequence so dynamically re-patched arrays force a map redraw
      const orderStateId = activeOrders.map(o => `${o.id}_${o.status}_${JSON.stringify(o.optimized_sequence || [])}`).sort().join('|');
      const isNewOrderState = lastActiveOrderIdRef.current !== orderStateId;

      if (!isNewOrderState && routeData) {
        // Already fetched for this exact permutation state, do not refetch and hit rate limits
        return;
      }

      lastActiveOrderIdRef.current = orderStateId;

      setIsLoadingRoute(true);
      try {
        const route = await fetchMultiOrderRoute(
          { latitude: userLocation.latitude, longitude: userLocation.longitude },
          activeOrders
        );
        console.log('[Map] Route data:', JSON.stringify({
          toPickup: { coords: route?.toPickup?.coordinates?.length, dist: route?.toPickup?.distance },
          toDropoff: { coords: route?.toDropoff?.coordinates?.length, dist: route?.toDropoff?.distance },
          isMultiStop: route?.isMultiStop
        }));
        setRouteData(route);
      } catch (error) {
        console.error('Error fetching route:', error);
        setRouteData(null);
      }
      setIsLoadingRoute(false);
    };

    fetchRoute();
  }, [userLocation, activeOrders]);

  // Fetch zone route when navigationTarget exists
  useEffect(() => {
    const fetchZoneRoute = async () => {
      if (!userLocation || !navigationTarget || activeOrder) {
        setZoneRouteData(null);
        return;
      }

      // Only fetch ONCE when the target zone changes to save API costs
      const isNewTarget = lastNavTargetIdRef.current !== navigationTarget.zoneId;

      if (!isNewTarget && zoneRouteData) {
        // Already fetched for this zone, do not refetch
        return;
      }

      lastNavTargetIdRef.current = navigationTarget.zoneId;

      setIsLoadingRoute(true);
      try {
        const dest = {
          latitude: navigationTarget.latitude,
          longitude: navigationTarget.longitude,
        };
        const result = await fetchRouteDirections(
          { latitude: userLocation.latitude, longitude: userLocation.longitude },
          dest
        );
        if (result) {
          setZoneRouteData(result);
        }
      } catch (error) {
        console.error('Error fetching zone route:', error);
      } finally {
        setIsLoadingRoute(false);
      }
    };
    fetchZoneRoute();
  }, [userLocation, navigationTarget, activeOrder]);

  // Haversine distance calculation in km
  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
      ;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
  };

  const handleArrivalCheck = () => {
    if (!userLocation || !navigationTarget) return;

    const distance = getDistanceFromLatLonInKm(
      userLocation.latitude,
      userLocation.longitude,
      navigationTarget.latitude,
      navigationTarget.longitude
    );

    // If within 2.0 kilometers of the zone centroid
    if (distance <= 2.0) {
      alert("Successfully arrived at " + navigationTarget.zoneName + "!");
      clearNavigationTarget();
    } else {
      alert(`You are not there yet. Please get closer to the zone before marking as arrived.`);
    }
  };

  const getUserLocation = async () => {
    try {
      setIsLoadingLocation(true);

      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setLocationError("Location permission denied");
        setUserLocation(DEFAULT_LOCATION);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    } catch (error) {
      console.warn("Error getting location:", error);
      setLocationError("Could not get location");
      setUserLocation(DEFAULT_LOCATION);
    } finally {
      setIsLoadingLocation(false);
    }
  };

  // Real-time hook: silently update driver icon without overriding map bounds
  // We sync `userLocation` state with the background `locationData`
  useEffect(() => {
    if (locationData && locationData.latitude && locationData.longitude) {
      setUserLocation(prev => ({
        ...(prev || DEFAULT_LOCATION),
        latitude: locationData.latitude,
        longitude: locationData.longitude,
      }));
    }
  }, [locationData]);

  // Full route: unified line for multi-stop and single-stop
  const fullRouteCoords = routeData?.fullRoute?.coordinates || [];

  // Auto-fit map to show entire route when data loads
  useEffect(() => {
    if (!mapRef.current || fullRouteCoords.length === 0) return;
    // Use a slight delay to let the map render first
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(fullRouteCoords, {
        edgePadding: { top: 120, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [routeData]);

  // Web fallback
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.headerWrapper}>
          <SafeAreaView edges={["top"]} style={styles.safeArea}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>OptiRide</Text>
              <View style={styles.headerIcons}>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => router.push("/alerts")}
                >
                  <Bell color="#FFFFFF" size={24} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => router.push("/settings")}
                >
                  <User color="#FFFFFF" size={24} />
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>
        </View>
        <View style={styles.webMapPlaceholder}>
          <Text style={styles.webMapIcon}>🗺️</Text>
          <Text style={styles.webMapText}>Map View</Text>
          <Text style={styles.webMapSubtext}>Maps are only available on mobile devices</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.headerWrapper}>
        <SafeAreaView edges={["top"]} style={styles.safeArea}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>OptiRide</Text>
            <View style={styles.headerIcons}>
              {isLoadingRoute && (
                <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
              )}
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => router.push("/alerts")}
              >
                <Bell color="#FFFFFF" size={24} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => router.push("/settings")}
              >
                <User color="#FFFFFF" size={24} />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>

      {/* Map container with overlays */}
      <View style={styles.mapContainer}>
        {/* Sensor readings overlay - show when monitoring, active order, or navigating to zone */}
        {(isMonitoring || activeOrder || navigationTarget) && (
          <View style={styles.sensorOverlay}>
            <View style={styles.sensorCard}>
              <Gauge size={20} color="#3B82F6" />
              <Text style={styles.sensorValue}>{Math.round(currentSpeed || 0)}</Text>
              <Text style={styles.sensorUnit}>km/h</Text>
            </View>
            <View style={styles.sensorCard}>
              <RotateCw size={20} color="#8B5CF6" />
              <Text style={styles.sensorValue}>{gyroMagnitude}</Text>
              <Text style={styles.sensorUnit}>rad/s</Text>
            </View>
            {!isMonitoring && (
              <TouchableOpacity
                style={[styles.sensorCard, { backgroundColor: '#FEF3C7' }]}
                onPress={handleStartSensors}
                disabled={isStartingSensors}
              >
                {isStartingSensors ? (
                  <ActivityIndicator size="small" color="#92400E" />
                ) : (
                  <Text style={{ fontSize: 11, color: '#92400E', fontWeight: '600' }}>Tap to start sensors</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Zone Navigation Info Card */}
        {!activeOrder && navigationTarget && (
          <View style={styles.orderInfoCard}>
            <View style={styles.orderInfoRow}>
              <Navigation size={16} color="#8B5CF6" />
              <Text style={styles.orderInfoText} numberOfLines={1}>
                Navigating to: {navigationTarget.zoneName}
              </Text>
            </View>
            {zoneRouteData && (
              <View style={styles.routeStats}>
                <Text style={styles.routeStatText}>
                  {zoneRouteData.distance?.toFixed(1) || '~'} km • {Math.round(zoneRouteData.duration || 0)} min
                </Text>
                <Text style={[styles.routeStatText, { color: '#8B5CF6', fontWeight: '700' }]}>
                  ETA: {(() => {
                    const mins = Math.round(zoneRouteData.duration || 0);
                    const arrival = new Date(Date.now() + mins * 60000);
                    return arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
                  })()}
                </Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#10B981', paddingVertical: 10, borderRadius: 8 }}
                onPress={handleArrivalCheck}
              >
                <Text style={{ color: 'white', fontWeight: '600', textAlign: 'center' }}>I have Arrived</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#EF4444', paddingVertical: 10, borderRadius: 8 }}
                onPress={clearNavigationTarget}
              >
                <Text style={{ color: 'white', fontWeight: '600', textAlign: 'center' }}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Active order info card */}
        {activeOrders.length > 0 && (
          <TouchableOpacity
            style={styles.orderInfoCard}
            onPress={() => routeData?.isMultiStop && setIsTimelineExpanded(!isTimelineExpanded)}
            activeOpacity={routeData?.isMultiStop ? 0.7 : 1}
          >
            <View style={styles.orderInfoRow}>
              <Navigation size={16} color="#10B981" />
              <Text style={styles.orderInfoText} numberOfLines={1}>
                {routeData?.isMultiStop ? `Multi-Stop Route (${activeOrders.length} orders)` : (
                  activeOrder.pickupConfirmed ? 'To: ' + activeOrder.details?.customerName : 'Pickup: ' + activeOrder.restaurant
                )}
              </Text>
              {routeData?.isMultiStop && (
                isTimelineExpanded ? <ChevronUp size={20} color="#6B7280" style={{ marginLeft: 'auto' }} /> : <ChevronDown size={20} color="#6B7280" style={{ marginLeft: 'auto' }} />
              )}
            </View>

            {routeData && !isTimelineExpanded && (
              <View style={styles.routeStats}>
                {routeData.isMultiStop ? (
                  <>
                    <Text style={styles.routeStatText}>
                      {routeData.sequence?.length > 0
                        ? `Next Stop (${routeData.sequence[0].stopIndex}): ${routeData.sequence[0].metadata.type === 'pickup' ? 'Pickup at' : 'Dropoff'} ${routeData.sequence[0].metadata.title}`
                        : 'Next Stop: Calculating...'}
                    </Text>
                    <Text style={[styles.routeStatText, { color: '#3B82F6', fontWeight: '700' }]}>
                      Total Trip: {routeData.totalDistance?.toFixed(1) || '~'} km • {Math.round(routeData.totalDuration || 0)} min
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.routeStatText}>
                      {isPickedUp
                        ? `${routeData.toDropoff?.distance?.toFixed(1) || '~'} km • ${Math.round(routeData.toDropoff?.duration || 0)} min to dropoff`
                        : `${routeData.toPickup?.distance?.toFixed(1) || '~'} km • ${Math.round(routeData.toPickup?.duration || 0)} min to pickup`
                      }
                    </Text>
                    <Text style={[styles.routeStatText, { color: '#3B82F6', fontWeight: '700' }]}>
                      ETA: {(() => {
                        const mins = isPickedUp
                          ? Math.round(routeData.toDropoff?.duration || 0)
                          : Math.round(routeData.toPickup?.duration || 0);
                        const arrival = new Date(Date.now() + mins * 60000);
                        return arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
                      })()}
                    </Text>
                    {!isPickedUp && routeData.toDropoff && (
                      <Text style={[styles.routeStatText, { marginTop: 2 }]}>
                        Total: {((routeData.toPickup?.distance || 0) + (routeData.toDropoff?.distance || 0)).toFixed(1)} km • {Math.round((routeData.toPickup?.duration || 0) + (routeData.toDropoff?.duration || 0))} min
                      </Text>
                    )}
                  </>
                )}
              </View>
            )}

            {!isTimelineExpanded && (
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: '#3B82F6' }]} />
                  <Text style={styles.legendText}>Route</Text>
                </View>
                {(!isPickedUp || routeData?.isMultiStop) && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendLine, { backgroundColor: '#10B981', width: 10, height: 10, borderRadius: 5 }]} />
                    <Text style={styles.legendText}>Pickups</Text>
                  </View>
                )}
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: '#EF4444', width: 10, height: 10, borderRadius: 5 }]} />
                  <Text style={styles.legendText}>Dropoffs</Text>
                </View>
              </View>
            )}

            {/* Timeline Expansion */}
            {isTimelineExpanded && routeData?.sequence && (
              <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#374151', marginBottom: 16 }}>Route Sequence</Text>
                {routeData.sequence.map((stop, i) => (
                  <View key={`timeline-${i}`} style={{ flexDirection: 'row', minHeight: 60 }}>
                    <View style={{ alignItems: 'center', width: 32, marginRight: 12 }}>
                      <View style={{
                        width: 28, height: 28, borderRadius: 14,
                        backgroundColor: stop.metadata.type === 'pickup' ? '#10B981' : '#EF4444',
                        alignItems: 'center', justifyContent: 'center', zIndex: 2
                      }}>
                        <Text style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>{stop.stopIndex}</Text>
                      </View>
                      {i < routeData.sequence.length - 1 && (
                        <View style={{ width: 2, flex: 1, backgroundColor: '#E5E7EB', marginTop: -4, marginBottom: -4, zIndex: 1 }} />
                      )}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 20, paddingTop: 2 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: '#1F2937' }}>
                        {stop.metadata.type === 'pickup' ? 'Pickup at ' : 'Dropoff '}
                        {stop.metadata.title}
                      </Text>
                      {i === 0 ? (
                        <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
                          Next Stop • {(routeData.fullRoute?.rawRoute?.legs?.[0]?.distance?.value / 1000 || 0).toFixed(1)} km
                        </Text>
                      ) : (
                        <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
                          Length: {(stop.distanceMetersToReach / 1000).toFixed(1)} km • {Math.round(stop.estimatedSecondsToReach / 60)} min
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </TouchableOpacity>
        )}

        {isLoadingLocation ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.loadingText}>Getting your location...</Text>
          </View>
        ) : (
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFillObject}
            initialRegion={userLocation || DEFAULT_LOCATION}
            showsUserLocation={true}
            showsMyLocationButton={true}
            showsCompass={true}
          >
            {/* Zone Navigation Polyline */}
            {!activeOrder && zoneRouteData?.coordinates?.length > 0 && (
              <Polyline
                coordinates={zoneRouteData.coordinates}
                strokeColor="#8B5CF6"
                strokeWidth={5}
                lineJoin="round"
              />
            )}

            {/* Zone Destination Marker */}
            {!activeOrder && navigationTarget && (
              <Marker
                coordinate={{
                  latitude: navigationTarget.latitude,
                  longitude: navigationTarget.longitude,
                }}
                title={navigationTarget.zoneName}
                description="Target Zone Center"
                pinColor="#8B5CF6"
              />
            )}

            {optimizedRouteCoords.length > 0 && (
              <Polyline
                coordinates={optimizedRouteCoords}
                strokeColor="#007AFF"
                strokeWidth={5}
                lineJoin="round"
              />
            )}
            {/* Multi-order pickup markers */}
            {(routeData?.pickups || activeOrders.map(o => ({ latitude: o.pickupLatitude || 25.2048, longitude: o.pickupLongitude || 55.2708, metadata: { title: o.restaurant } }))).map((pickup, index) => (
              <Marker
                key={`pickup-${index}`}
                coordinate={{
                  latitude: pickup.latitude,
                  longitude: pickup.longitude,
                }}
                title={pickup.metadata?.title || "Pickup Location"}
                description={`Pickup Stop ${index + 1}`}
                anchor={{ x: 0.5, y: 1 }}
              >
                <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{
                    backgroundColor: '#10B981',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: 'white',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.25,
                    shadowRadius: 3.84,
                    elevation: 5
                  }}>
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>
                      {index + 1}
                    </Text>
                  </View>
                  <View style={{ width: 3, height: 12, backgroundColor: '#10B981', marginTop: -2 }} />
                </View>
              </Marker>
            ))}

            {/* Multi-order dropoff markers */}
            {(routeData?.dropoffs || activeOrders.map(o => ({ latitude: o.dropoffLatitude || 25.197, longitude: o.dropoffLongitude || 55.278, metadata: { title: o.restaurant } }))).map((dropoff, index) => (
              <Marker
                key={`dropoff-${index}`}
                coordinate={{
                  latitude: dropoff.latitude,
                  longitude: dropoff.longitude,
                }}
                title={dropoff.metadata?.title || "Dropoff Location"}
                description={`Dropoff Stop ${index + 1}`}
                anchor={{ x: 0.5, y: 1 }}
              >
                <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{
                    backgroundColor: '#EF4444',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: 'white',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.25,
                    shadowRadius: 3.84,
                    elevation: 5
                  }}>
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>
                      {index + 1}
                    </Text>
                  </View>
                  <View style={{ width: 3, height: 12, backgroundColor: '#EF4444', marginTop: -2 }} />
                </View>
              </Marker>
            ))}

            {/* Complete route as ONE polyline */}
            {fullRouteCoords.length > 0 && (
              <Polyline
                coordinates={fullRouteCoords}
                strokeColor="#3B82F6"
                strokeWidth={5}
              />
            )}
          </MapView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  headerWrapper: {
    backgroundColor: "#0b0f3d",
    zIndex: 100,
  },
  safeArea: {
    backgroundColor: "#0b0f3d",
  },
  header: {
    backgroundColor: "#0b0f3d",
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  headerIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconButton: {
    padding: 8,
  },
  // Sensor overlay styles - positioned bottom left, above the map buttons
  sensorOverlay: {
    position: "absolute",
    bottom: 30,
    left: 16,
    zIndex: 999,
    flexDirection: "column",
    gap: 8,
  },
  sensorCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
    gap: 8,
  },
  sensorValue: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1F2937",
  },
  sensorUnit: {
    fontSize: 12,
    color: "#6B7280",
    fontWeight: "500",
  },
  // Order info card styles - positioned at top, just below header
  orderInfoCard: {
    position: "absolute",
    top: 8,
    right: 16,
    left: 16,
    zIndex: 999,
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderRadius: 16,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  orderInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  orderInfoText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1F2937",
    flex: 1,
  },
  routeStats: {
    marginBottom: 8,
  },
  routeStatText: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
  },
  legendRow: {
    flexDirection: "row",
    gap: 16,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  legendLine: {
    width: 16,
    height: 4,
    borderRadius: 2,
    marginRight: 4,
  },
  legendText: {
    fontSize: 11,
    color: "#6B7280",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#6B7280",
  },
  webMapPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
  },
  webMapIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  webMapText: {
    fontSize: 24,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  webMapSubtext: {
    fontSize: 16,
    color: "#6B7280",
  },
});