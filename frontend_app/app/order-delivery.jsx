import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon, CheckCircle } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useSensors } from '@/contexts/SensorContext';
import { useOrders } from '@/contexts/OrdersContext';
import polyline from "@mapbox/polyline";
import * as Location from 'expo-location';

// Conditionally import MapView for native platforms
let MapView, Polyline, Marker, PROVIDER_GOOGLE;
if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Polyline = Maps.Polyline;
  Marker = Maps.Marker;
  PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
}

export default function OrderDeliveryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { stopMonitoring, isMonitoring } = useSensors();
  const { orders, isLoadingOrders, completeDelivery } = useOrders();

  const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;

  const order = useMemo(
    () => orders.find((o) => o.id === orderId),
    [orders, orderId],
  );

  // Track driver's current location
  const [driverLocation, setDriverLocation] = useState(null);

  useEffect(() => {
    let sub;
    const startTracking = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, distanceInterval: 20 },
            (loc) => setDriverLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
          );
        }
      } catch (e) { console.warn('Location tracking error:', e); }
    };
    startTracking();
    return () => sub?.remove();
  }, []);

  const handleCompleteDelivery = async () => {
    if (!order) return;

    try {
      // 1. Complete the delivery in the backend
      await completeDelivery(order.id);

      // 2. Stop sensor monitoring
      if (isMonitoring) {
        stopMonitoring();
        console.log('Safety monitoring stopped - delivery complete');
      }

      // 3. Navigate back to home
      router.replace('/(tabs)');
    } catch (error) {
      console.error('Failed to complete delivery:', error);
    }
  };

  if (isLoadingOrders) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Order not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={{ color: theme.colors.primary }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const routeCoordinates = useMemo(() => {
    if (order?.route_polyline) {
      const decodedPoints = polyline.decode(order.route_polyline);
      return decodedPoints.map((point) => ({
        latitude: point[0],
        longitude: point[1],
      }));
    }
    return [
      {
        latitude: order?.pickupLatitude || 25.1970,
        longitude: order?.pickupLongitude || 55.2780
      },
      {
        latitude: order?.dropoffLatitude || 25.1850,
        longitude: order?.dropoffLongitude || 55.2650
      }
    ];
  }, [order]);

  // Map region centered on dropoff
  const initialRegion = {
    latitude: order.dropoffLatitude || 25.1910,
    longitude: order.dropoffLongitude || 55.2715,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  };

  // Web fallback
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeftIcon size={24} color="#ffffff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Navigate to {order.orderNumber}&apos;s Location</Text>
        </View>
        <View style={styles.webPlaceholder}>
          <Text style={styles.webText}>🗺️ Map View</Text>
          <Text style={styles.webSubtext}>Navigation available on mobile</Text>
        </View>
        <View style={styles.actionCard}>
          <View style={styles.infoSection}>
            <Text style={styles.orderNumber}>{order.orderNumber}</Text>
            <Text style={styles.address}>{order.location}</Text>
            <Text style={styles.distance}>Customer: {order.details?.customerName || "N/A"}</Text>
          </View>
          <TouchableOpacity style={styles.completeButton} onPress={handleCompleteDelivery}>
            <CheckCircle size={20} color="#ffffff" />
            <Text style={styles.completeButtonText}>Complete Delivery</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeftIcon size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Navigate to {order.orderNumber}&apos;s Location</Text>
      </View>

      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        <Polyline
          coordinates={routeCoordinates}
          strokeColor={theme.colors.success}
          strokeWidth={4}
        />
        {/* Driver location marker */}
        {driverLocation && (
          <Marker
            coordinate={driverLocation}
            title="Your Location"
            pinColor="#3B82F6"
          />
        )}
        <Marker
          coordinate={routeCoordinates[0]}
          title={order.restaurant}
          pinColor={theme.colors.accent}
        />
        <Marker
          coordinate={routeCoordinates[routeCoordinates.length - 1]}
          title="Customer Location"
          pinColor={theme.colors.success}
        />
      </MapView>

      <View style={styles.actionCard}>
        <View style={styles.infoSection}>
          <Text style={styles.orderNumber}>{order.orderNumber}</Text>
          <Text style={styles.address}>{order.location}</Text>
          <Text style={styles.distance}>Customer: {order.details?.customerName || "N/A"}</Text>
        </View>
        <TouchableOpacity style={styles.completeButton} onPress={handleCompleteDelivery}>
          <CheckCircle size={20} color="#ffffff" />
          <Text style={styles.completeButtonText}>Complete Delivery</Text>
        </TouchableOpacity>
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
    fontSize: theme.fontSize.base,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
  },
  map: {
    flex: 1,
  },
  webPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  webText: {
    fontSize: 48,
    marginBottom: 8,
  },
  webSubtext: {
    fontSize: 16,
    color: '#6B7280',
  },
  actionCard: {
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
  infoSection: {
    marginBottom: theme.spacing.md,
  },
  orderNumber: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  address: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  distance: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.success,
  },
  completeButton: {
    backgroundColor: theme.colors.success,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    gap: theme.spacing.sm,
  },
  completeButtonText: {
    color: '#ffffff',
    fontSize: theme.fontSize.base,
    fontWeight: '700',
  },
});
