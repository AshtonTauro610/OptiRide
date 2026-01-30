import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { theme } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import * as Location from 'expo-location';

// Conditionally import MapView for native platforms
let MapView, Marker, PROVIDER_GOOGLE;
if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
}

// TODO: Backend endpoint for reporting fall detection event
// POST /safety/fall-detected - Report fall detection with location
// This would create an ACCIDENT alert and trigger emergency notification workflow

export default function FallDetectionScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [countdown, setCountdown] = useState(60);
  const [driverLocation, setDriverLocation] = useState(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);

  // Get driver's current location for the map
  useEffect(() => {
    const getLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          setDriverLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
        }
      } catch (error) {
        console.error('Error getting location:', error);
      }
      setIsLoadingLocation(false);
    };

    getLocation();
  }, []);

  // Countdown timer - auto-trigger emergency when countdown reaches 0
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          handleCallEmergency();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleImOkay = async () => {
    // TODO: Report false positive to backend
    // POST /safety/fall-dismissed - Driver confirmed they are okay
    router.back();
  };

  const handleCallEmergency = async () => {
    // TODO: Report confirmed fall/accident to backend
    // This should:
    // 1. Create an ACCIDENT alert with location
    // 2. Notify emergency services
    // 3. Notify admin dashboard
    // 4. Update driver status to "emergency"

    router.push('/fall-assistance');
  };

  // Use driver location or fallback to Dubai coordinates
  const mapRegion = driverLocation || {
    latitude: 25.2048,
    longitude: 55.2708,
  };

  // Web fallback
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.webMap}>
          <Text style={styles.webMapText}>📍 Location: {driverLocation ? 'Detected' : 'Loading...'}</Text>
        </View>
        <View style={styles.overlay} />
        <View style={styles.cardContainer}>
          <FallAlertCard
            countdown={countdown}
            onImOkay={handleImOkay}
            onCallEmergency={handleCallEmergency}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isLoadingLocation ? (
        <View style={styles.loadingMap}>
          <ActivityIndicator size="large" color={theme.colors.error} />
        </View>
      ) : (
        <MapView
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          initialRegion={{
            ...mapRegion,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          showsUserLocation={true}
        >
          {driverLocation && (
            <Marker
              coordinate={driverLocation}
              title="Fall Detected Here"
              pinColor={theme.colors.error}
            />
          )}
        </MapView>
      )}
      <View style={styles.overlay} />

      <View style={styles.cardContainer}>
        <FallAlertCard
          countdown={countdown}
          onImOkay={handleImOkay}
          onCallEmergency={handleCallEmergency}
        />
      </View>
    </View>
  );
}

// Extracted component for reuse in web and native
function FallAlertCard({ countdown, onImOkay, onCallEmergency }) {
  return (
    <Card style={styles.alertCard}>
      <View style={styles.iconContainer}>
        <Text style={styles.iconText}>⚠️</Text>
      </View>
      <Text style={styles.title}>FALL DETECTED!</Text>
      <Text style={styles.message}>
        A fall has been detected. Emergency services will be contacted automatically if you don&apos;t respond.
      </Text>

      <View style={styles.countdownContainer}>
        <View style={styles.countdownCircle}>
          <Text style={styles.countdownText}>{countdown}</Text>
          <Text style={styles.countdownLabel}>seconds</Text>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <Button
          title="I'M OKAY"
          onPress={onImOkay}
          variant="success"
          style={styles.button}
        />
        <Button
          title="CALL EMERGENCY"
          onPress={onCallEmergency}
          variant="danger"
          style={styles.button}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  loadingMap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E293B',
  },
  webMap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E293B',
  },
  webMapText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textSecondary,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  cardContainer: {
    position: 'absolute',
    top: '15%',
    left: 20,
    right: 20,
  },
  alertCard: {
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  iconContainer: {
    marginBottom: theme.spacing.md,
  },
  iconText: {
    fontSize: 60,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.error,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  message: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  countdownContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  countdownCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: `${theme.colors.error}20`,
    borderWidth: 4,
    borderColor: theme.colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    fontSize: 40,
    fontWeight: '700',
    color: theme.colors.error,
  },
  countdownLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    width: '100%',
  },
  button: {
    flex: 1,
  },
});
