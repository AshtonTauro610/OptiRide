import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { theme } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useOrderNotification } from '@/contexts/OrderNotificationContext';
import { useOrders } from '@/contexts/OrdersContext';
import { acceptOrder, rejectOrder } from '@/services/orders';
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

export default function OrderNotificationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { token } = useAuth();
  const { currentOffer, clearCurrentOffer, syncOffers } = useOrderNotification();
  const { orders, invalidateOrders } = useOrders();

  const [driverLocation, setDriverLocation] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [routeData, setRouteData] = useState(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);

  // Get order from context or try to fetch
  const order = currentOffer;

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
      setIsLoading(false);
    };

    getLocation();
  }, []);

  // Fetch route when we have driver location and order
  useEffect(() => {
    const fetchRoute = async () => {
      if (!driverLocation || !order) return;

      const pickupLocation = {
        latitude: order.pickup_latitude || 25.2048,
        longitude: order.pickup_longitude || 55.2708,
      };

      const dropoffLocation = {
        latitude: order.dropoff_latitude || 25.197,
        longitude: order.dropoff_longitude || 55.278,
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

  const handleAccept = async () => {
    if (!token || !order) return;

    setIsAccepting(true);
    try {
      await acceptOrder(token, order.order_id);
      // Refresh orders list so the new order appears
      await invalidateOrders();
      clearCurrentOffer();
      
      const otherOngoingOrders = orders.filter(o =>
        o.id !== order.order_id &&
        o.status === "assigned" // Both assigned and picked_up map to "assigned"
      );

      if (otherOngoingOrders.length > 0) {
        console.log("Found ongoing orders, skipping fatigue scan");
        router.replace("/(tabs)/map");
      } else {
        router.replace({
          pathname: '/fatigue-detection',
          params: { orderId: order.order_id }
        });
      }
    } catch (error) {
      console.error('Failed to accept order:', error);
      setIsAccepting(false);
      
      const message = error?.details?.detail || error?.message || "Order may have been taken by another driver.";
      Alert.alert("Cannot Accept Order", message);
    }
  };

  const handleDecline = async () => {
    if (!token || !order) return;

    setIsRejecting(true);
    try {
      await rejectOrder(token, order.order_id);
      clearCurrentOffer();
      // Refresh orders and navigate to orders tab
      await invalidateOrders();
      router.replace('/(tabs)/orders');
    } catch (error) {
      console.error('Failed to reject order:', error);
      setIsRejecting(false);
      Alert.alert("Cannot Reject Order", "Something went wrong. Please try again.");
    }
  };

  useEffect(() => {
    return () => {
    };
  }, []);

  if (!order) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Looking for order...</Text>
      </View>
    );
  }

  // Calculate locations
  const pickupLocation = {
    latitude: order.pickup_latitude || 25.2048,
    longitude: order.pickup_longitude || 55.2708,
  };

  const dropoffLocation = {
    latitude: order.dropoff_latitude || 25.197,
    longitude: order.dropoff_longitude || 55.278,
  };

  const initialRegion = driverLocation || pickupLocation;

  // Get route coordinates for display
  const toPickupCoords = routeData?.toPickup?.coordinates || [];
  const toDropoffCoords = routeData?.toDropoff?.coordinates || [];

  // Use route data for distance/duration if available
  const displayDistance = routeData?.totalDistance
    ? routeData.totalDistance.toFixed(1)
    : order.distance_km?.toFixed(1) || '~';

  const displayDuration = routeData?.totalDuration
    ? Math.round(routeData.totalDuration)
    : order.duration_min?.toFixed(0) || '~';

  const formatTime = (dateString) => {
    if (!dateString) return 'ASAP';
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Web fallback
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.webMapPlaceholder}>
          <Text style={styles.webMapText}>🗺️ Map Preview</Text>
        </View>
        <View style={styles.overlay} />
        <View style={styles.cardContainer}>
          <Card style={styles.notificationCard}>
            <Text style={styles.badge}>NEW ORDER OFFER</Text>
            <Text style={styles.title}>🍽️ {order.restaurant_name}</Text>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Pickup Address:</Text>
              <Text style={styles.value}>{order.pickup_address}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Dropoff Address:</Text>
              <Text style={styles.value}>{order.dropoff_address}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Customer:</Text>
              <Text style={styles.value}>{order.customer_name}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Pickup Time:</Text>
              <Text style={styles.value}>{formatTime(order.pickup_time)}</Text>
            </View>
            <View style={styles.infoRow}>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Distance</Text>
                <Text style={styles.infoValue}>{displayDistance} km</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Est. Time</Text>
                <Text style={styles.infoValue}>{displayDuration} min</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Earnings</Text>
                <Text style={styles.infoValue}>
                  AED {order.delivery_fee?.toFixed(2) || order.price?.toFixed(2) || '0'}
                </Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              <Button
                title={isRejecting ? "..." : "DECLINE"}
                onPress={handleDecline}
                variant="secondary"
                style={styles.button}
                disabled={isRejecting || isAccepting}
              />
              <Button
                title={isAccepting ? "..." : "ACCEPT"}
                onPress={handleAccept}
                variant="success"
                style={styles.button}
                disabled={isRejecting || isAccepting}
              />
            </View>
          </Card>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{
          latitude: initialRegion.latitude,
          longitude: initialRegion.longitude,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
        showsUserLocation={true}
        showsMyLocationButton={false}
      >
        {/* Driver location marker */}
        {driverLocation && (
          <Marker
            coordinate={driverLocation}
            title="You"
            pinColor="#3B82F6"
          />
        )}

        {/* Pickup location (Restaurant) */}
        <Marker
          coordinate={pickupLocation}
          title={order.restaurant_name}
          description="Pickup Location"
          pinColor="#10B981"
        />

        {/* Dropoff location (Customer) */}
        <Marker
          coordinate={dropoffLocation}
          title={order.customer_name}
          description="Dropoff Location"
          pinColor="#EF4444"
        />

        {/* Route from Driver to Pickup (Google Maps route) */}
        {toPickupCoords.length > 0 && (
          <Polyline
            coordinates={toPickupCoords}
            strokeColor="#3B82F6"
            strokeWidth={4}
          />
        )}

        {/* Route from Pickup to Dropoff (Google Maps route) */}
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
      <View style={styles.overlay} />

      <View style={styles.cardContainer}>
        <Card style={styles.notificationCard}>
          <View style={styles.badgeRow}>
            <Text style={styles.badge}>NEW ORDER OFFER</Text>
            {isLoadingRoute && (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            )}
          </View>
          <Text style={styles.title}>🍽️ {order.restaurant_name}</Text>
          <View style={styles.detailRow}>
            <Text style={styles.label}>Pickup:</Text>
            <Text style={styles.value} numberOfLines={2}>{order.pickup_address}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.label}>Dropoff:</Text>
            <Text style={styles.value} numberOfLines={2}>{order.dropoff_address}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.label}>Customer:</Text>
            <Text style={styles.value}>{order.customer_name}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Distance</Text>
              <Text style={styles.infoValue}>{displayDistance} km</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Est. Time</Text>
              <Text style={styles.infoValue}>{displayDuration} min</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Earnings</Text>
              <Text style={styles.infoValue}>
                AED {order.delivery_fee?.toFixed(2) || order.price?.toFixed(2) || '0'}
              </Text>
            </View>
          </View>

          {/* Route legend */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: '#3B82F6' }]} />
              <Text style={styles.legendText}>To Pickup</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: theme.colors.accent }]} />
              <Text style={styles.legendText}>To Customer</Text>
            </View>
          </View>

          <View style={styles.buttonRow}>
            <Button
              title={isRejecting ? "..." : "DECLINE"}
              onPress={handleDecline}
              variant="secondary"
              style={styles.button}
              disabled={isRejecting || isAccepting}
            />
            <Button
              title={isAccepting ? "..." : "ACCEPT"}
              onPress={handleAccept}
              variant="success"
              style={styles.button}
              disabled={isRejecting || isAccepting}
            />
          </View>
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  loadingText: {
    marginTop: theme.spacing.md,
    color: '#ffffff',
    fontSize: theme.fontSize.base,
  },
  map: {
    flex: 1,
  },
  webMapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E293B',
  },
  webMapText: {
    fontSize: 48,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  cardContainer: {
    position: 'absolute',
    top: '12%',
    left: 20,
    right: 20,
  },
  notificationCard: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  badge: {
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
    color: theme.colors.success,
    backgroundColor: `${theme.colors.success}20`,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  detailRow: {
    marginBottom: theme.spacing.sm,
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: 2,
  },
  value: {
    fontSize: theme.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  infoItem: {
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: theme.fontSize.base,
    fontWeight: '700',
    color: theme.colors.text,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing.lg,
    marginTop: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  legendLine: {
    width: 20,
    height: 4,
    borderRadius: 2,
  },
  legendText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  button: {
    flex: 1,
  },
});
