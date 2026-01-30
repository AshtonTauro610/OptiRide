import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useOrders } from '@/contexts/OrdersContext';

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

  const initialRegion = useMemo(() => {
    if (!order) return {
      latitude: 25.2048,
      longitude: 55.2708,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };

    return {
      latitude: order.pickupLatitude || 25.2048,
      longitude: order.pickupLongitude || 55.2708,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
  }, [order]);

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

  const routeCoordinates = [
    {
      latitude: order.pickupLatitude || 25.2048,
      longitude: order.pickupLongitude || 55.2708,
    },
    {
      latitude: order.deliveryLatitude || 25.197,
      longitude: order.deliveryLongitude || 55.278,
    },
  ];

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
      >
        <Polyline
          coordinates={routeCoordinates}
          strokeColor={theme.colors.accent}
          strokeWidth={4}
        />
        <Marker
          coordinate={routeCoordinates[0]}
          title="Pickup Location"
          pinColor={theme.colors.success}
        />
        <Marker
          coordinate={routeCoordinates[1]}
          title={order.restaurant}
          pinColor={theme.colors.error}
        />
      </MapView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeftIcon size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Navigate to {order.orderNumber}&apos;s Location</Text>
      </View>

      {renderMap()}

      <View style={styles.infoCard}>
        <Text style={styles.restaurantName}>{order.restaurant}</Text>
        <Text style={styles.address}>{order.location}</Text>
        <Text style={styles.distance}>Customer: {order.details?.customerName || "N/A"}</Text>
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
  restaurantName: {
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
});
