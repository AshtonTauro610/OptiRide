import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon, Navigation } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useOrders } from '@/contexts/OrdersContext';
import { fetchDeliveryRoute } from '@/services/route';
import * as Location from 'expo-location';

// Conditionally import MapView for native platforms
let MapView, Marker, Polyline, PROVIDER_GOOGLE;
if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  Polyline = Maps.Polyline;
  PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
}

export default function OrderPickupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { orders, isLoadingOrders } = useOrders();

  const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;

  const order = useMemo(
    () => orders.find((o) => o.id === orderId),
    [orders, orderId],
  );

  // State for driver location and route
  const [driverLocation, setDriverLocation] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);

  // Get driver's current location
  useEffect(() => {
    const getLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setDriverLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
        }
      } catch (error) {
        console.error('Error getting location:', error);
      }
    };

    getLocation();
  }, []);

  // Fetch route when we have driver location and order
  useEffect(() => {
    const fetchRoute = async () => {
      if (!driverLocation || !order) return;

      const pickupLocation = {
        latitude: order.pickupLatitude || 25.2048,
        longitude: order.pickupLongitude || 55.2708,
      };

      const dropoffLocation = {
        latitude: order.dropoffLatitude || 25.197,
        longitude: order.dropoffLongitude || 55.278,
      };

      setIsLoadingRoute(true);
      try {
        const route = await fetchDeliveryRoute(driverLocation, pickupLocation, dropoffLocation);
        setRouteData(route);
      } catch (error) {
        console.error('Error fetching route:', error);
      }
      setIsLoadingRoute(false);
    };

    fetchRoute();
  }, [driverLocation, order]);

  const initialRegion = useMemo(() => {
    // Center on driver location if available, otherwise pickup
    if (driverLocation) {
      return {
        latitude: driverLocation.latitude,
        longitude: driverLocation.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }
    if (!order) return {
      latitude: 25.2048,
      longitude: 55.2708,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };

    return {
      latitude: order.pickupLatitude || 25.2048,
      longitude: order.pickupLongitude || 55.2708,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
  }, [order, driverLocation]);

  if (isLoadingOrders) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeftIcon size={24} color="#ffffff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Loading order...</Text>
        </View>
        <View style={styles.errorContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeftIcon size={24} color="#ffffff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Not Found</Text>
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Order not found</Text>
        </View>
      </View>
    );
  }

  const pickupLocation = {
    latitude: order.pickupLatitude || 25.2048,
    longitude: order.pickupLongitude || 55.2708,
  };

  const dropoffLocation = {
    latitude: order.dropoffLatitude || 25.197,
    longitude: order.dropoffLongitude || 55.278,
  };

  // Get route coordinates for display
  const toPickupCoords = routeData?.toPickup?.coordinates || [];
  const toDropoffCoords = routeData?.toDropoff?.coordinates || [];

  // Route info for display
  const distanceToPickup = routeData?.toPickup?.distance?.toFixed(1) || '~';
  const durationToPickup = routeData?.toPickup?.duration ? Math.round(routeData.toPickup.duration) : '~';

  const renderMap = () => {
    if (Platform.OS === 'web' || !MapView) {
      return (
        <View style={styles.webPlaceholder}>
          <Text style={styles.webText}>🗺️ Map Preview</Text>
          <Text style={styles.webSubtext}>
            Navigation data for {order.restaurant}
          </Text>
        </View>
      );
    }

    return (
      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {/* Driver location marker */}
        {driverLocation && (
          <Marker
            coordinate={driverLocation}
            title="Your Location"
            pinColor="#3B82F6"
          />
        )}

        {/* Pickup location (Restaurant) */}
        <Marker
          coordinate={pickupLocation}
          title={order.restaurant}
          description="Pickup Location"
          pinColor="#10B981"
        />

        {/* Dropoff location (Customer) */}
        <Marker
          coordinate={dropoffLocation}
          title={order.details?.customerName || "Customer"}
          description="Dropoff Location"
          pinColor="#EF4444"
        />

        {/* Route from Driver to Pickup (blue) */}
        {toPickupCoords.length > 0 && (
          <Polyline
            coordinates={toPickupCoords}
            strokeColor="#3B82F6"
            strokeWidth={5}
          />
        )}

        {/* Route from Pickup to Dropoff (orange/accent) */}
        {toDropoffCoords.length > 0 && (
          <Polyline
            coordinates={toDropoffCoords}
            strokeColor={theme.colors.accent}
            strokeWidth={4}
          />
        )}

        {/* Fallback straight lines if no route data */}
        {toPickupCoords.length === 0 && driverLocation && (
          <Polyline
            coordinates={[driverLocation, pickupLocation]}
            strokeColor="#3B82F6"
            strokeWidth={3}
            lineDashPattern={[10, 5]}
          />
        )}
        {toDropoffCoords.length === 0 && (
          <Polyline
            coordinates={[pickupLocation, dropoffLocation]}
            strokeColor={theme.colors.accent}
            strokeWidth={3}
            lineDashPattern={[10, 5]}
          />
        )}
      </MapView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeftIcon size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Navigate to Pickup</Text>
        {isLoadingRoute && (
          <ActivityIndicator size="small" color="#ffffff" style={{ marginLeft: 10 }} />
        )}
      </View>

      {renderMap()}

      <View style={styles.infoCard}>
        <View style={styles.infoHeader}>
          <Text style={styles.restaurantName}>{order.restaurant}</Text>
          <View style={styles.routeInfo}>
            <Text style={styles.routeText}>{distanceToPickup} km</Text>
            <Text style={styles.routeText}> • </Text>
            <Text style={styles.routeText}>{durationToPickup} min</Text>
          </View>
        </View>
        <Text style={styles.address}>{order.location}</Text>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: '#3B82F6' }]} />
            <Text style={styles.legendText}>To Pickup</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: theme.colors.accent }]} />
            <Text style={styles.legendText}>To Dropoff</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    backgroundColor: theme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 15,
    paddingHorizontal: 15,
  },
  backButton: {
    marginRight: theme.spacing.md,
  },
  headerTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
  },
  map: {
    flex: 1,
  },
  infoCard: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  restaurantName: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
    flex: 1,
  },
  routeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  address: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: theme.spacing.lg,
    marginTop: theme.spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendLine: {
    width: 20,
    height: 4,
    borderRadius: 2,
    marginRight: theme.spacing.xs,
  },
  legendText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
  },
  distance: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.accent,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textSecondary,
  },
  webPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  webText: {
    fontSize: 48,
    marginBottom: theme.spacing.md,
  },
  webSubtext: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textSecondary,
  },
});
