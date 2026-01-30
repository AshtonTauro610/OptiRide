import { useTheme } from "@/contexts/ThemeContext";
import { useRouter } from "expo-router";
import { Bell, User } from "lucide-react-native";
import React, { useState, useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity, View, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";

// Only import react-native-maps on native platforms
let MapView, PROVIDER_DEFAULT, PROVIDER_GOOGLE;
if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
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

  const [userLocation, setUserLocation] = useState(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);
  const [locationError, setLocationError] = useState(null);

  const bgColor = isDarkMode ? "#111827" : "#F9FAFB";

  useEffect(() => {
    getUserLocation();
  }, []);

  const getUserLocation = async () => {
    try {
      setIsLoadingLocation(true);

      // Request permission
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setLocationError("Location permission denied");
        setUserLocation(DEFAULT_LOCATION);
        return;
      }

      // Get current position
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    } catch (error) {
      console.warn("Error getting location:", error);
      setLocationError("Could not get location");
      setUserLocation(DEFAULT_LOCATION);
    } finally {
      setIsLoadingLocation(false);
    }
  };

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

      {isLoadingLocation ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Getting your location...</Text>
        </View>
      ) : (
        <MapView
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFillObject}
          initialRegion={userLocation || DEFAULT_LOCATION}
          showsUserLocation={true}
          showsMyLocationButton={true}
          showsCompass={true}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    gap: 12,
  },
  iconButton: {
    padding: 8,
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