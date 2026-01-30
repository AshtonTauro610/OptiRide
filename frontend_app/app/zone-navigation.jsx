import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeftIcon } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { zones } from '@/mocks/zones';

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
  const targetZone = zones.find(z => z.code === 'A3');

  const routeCoordinates = [
    { latitude: 25.2048, longitude: 55.2708 },
    { latitude: 25.1950, longitude: 55.2765 },
    { latitude: 25.1852, longitude: 55.2721 },
  ];

  // Web fallback
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeftIcon size={24} color="#ffffff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Navigate to Zone {targetZone?.code}</Text>
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
        <Text style={styles.headerTitle}>Navigate to Zone {targetZone?.code}</Text>
      </View>

      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{
          latitude: 25.1950,
          longitude: 55.2735,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        <Polyline
          coordinates={routeCoordinates}
          strokeColor={theme.colors.accent}
          strokeWidth={4}
        />
        <Marker
          coordinate={routeCoordinates[0]}
          title="Your Location"
          pinColor={theme.colors.success}
        />
        <Marker
          coordinate={routeCoordinates[routeCoordinates.length - 1]}
          title={`Zone ${targetZone?.code}`}
          pinColor={theme.colors.error}
        />
      </MapView>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>2.5 km away</Text>
        <Text style={styles.infoSubtitle}>Estimated time: 8 minutes</Text>
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
