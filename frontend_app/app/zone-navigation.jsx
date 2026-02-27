import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { fetchRouteDirections } from '@/services/route';
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

export default function ZoneNavigationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const zoneName = params.zoneName || 'Target Zone';
  const zoneLat = parseFloat(params.zoneLat) || 25.1852;
  const zoneLng = parseFloat(params.zoneLng) || 55.2721;

  const [driverLocation, setDriverLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const zoneDestination = { latitude: zoneLat, longitude: zoneLng };

  // Get driver location
  useEffect(() => {
    const getLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
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

  // Fetch real route when driver location is available
  useEffect(() => {
    const fetchRoute = async () => {
      if (!driverLocation) return;
      setIsLoading(true);
      try {
        const result = await fetchRouteDirections(driverLocation, zoneDestination);
        if (result) {
          setRouteCoords(result.coordinates || []);
          setRouteInfo({ distance: result.distance, duration: result.duration });
        }
      } catch (error) {
        console.error('Error fetching zone route:', error);
        // Fallback to straight line
        setRouteCoords([driverLocation, zoneDestination]);
      }
      setIsLoading(false);
    };
    fetchRoute();
  }, [driverLocation]);

  const initialRegion = useMemo(() => {
    if (driverLocation) {
      return {
        latitude: (driverLocation.latitude + zoneLat) / 2,
        longitude: (driverLocation.longitude + zoneLng) / 2,
        latitudeDelta: Math.abs(driverLocation.latitude - zoneLat) * 2 + 0.02,
        longitudeDelta: Math.abs(driverLocation.longitude - zoneLng) * 2 + 0.02,
      };
    }
    return { latitude: zoneLat, longitude: zoneLng, latitudeDelta: 0.05, longitudeDelta: 0.05 };
  }, [driverLocation, zoneLat, zoneLng]);

  const distanceText = routeInfo?.distance ? `${routeInfo.distance.toFixed(1)} km` : 'Calculating...';
  const durationText = routeInfo?.duration ? `${Math.round(routeInfo.duration)} min` : '';

  // Web fallback
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeftIcon size={24} color="#ffffff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Navigate to {zoneName}</Text>
        </View>
        <View style={styles.webPlaceholder}>
          <Text style={styles.webPlaceholderText}>🗺️ Map not available on web</Text>
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
        <Text style={styles.headerTitle}>Navigate to {zoneName}</Text>
        {isLoading && <ActivityIndicator size="small" color="#ffffff" style={{ marginLeft: 10 }} />}
      </View>

      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={theme.colors.accent}
            strokeWidth={5}
          />
        )}
        {driverLocation && (
          <Marker
            coordinate={driverLocation}
            title="Your Location"
            pinColor="#3B82F6"
          />
        )}
        <Marker
          coordinate={zoneDestination}
          title={zoneName}
          pinColor={theme.colors.error}
        />
      </MapView>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>{distanceText}</Text>
        <Text style={styles.infoSubtitle}>
          {durationText ? `Estimated time: ${durationText}` : 'Calculating route...'}
        </Text>
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
  infoTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  infoSubtitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
  },
  webPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E293B',
  },
  webPlaceholderText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textSecondary,
  },
});
