import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { theme } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import * as Location from 'expo-location';

// TODO: Backend endpoints needed for full fall assistance functionality:
// 1. GET /emergency/contacts - Fetch configured emergency contacts
// 2. GET /emergency/status - Get status of emergency response
// 3. POST /emergency/cancel - Cancel emergency if driver recovers
// 4. GET /safety/instructions/{type} - Fetch safety instructions dynamically

export default function FallAssistanceScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [driverLocation, setDriverLocation] = useState(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);

  // Get current location to share with emergency services
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

  const handleCallEmergency = () => {
    // TODO: Get emergency number from backend config
    // Currently hardcoded - in production should fetch from:
    // GET /config/emergency-numbers based on driver's region
    const emergencyNumber = Platform.OS === 'ios' ? 'telprompt:999' : 'tel:999';
    Linking.openURL(emergencyNumber).catch(err =>
      console.error('Failed to open phone dialer:', err)
    );
  };

  const handleImRecovered = async () => {
    // TODO: Report recovery to backend
    // POST /emergency/cancel - Cancel ongoing emergency response
    // This should update driver status back to normal
    router.back();
  };

  // Format location for display
  const locationText = driverLocation
    ? `${driverLocation.latitude.toFixed(6)}, ${driverLocation.longitude.toFixed(6)}`
    : 'Locating...';

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>🚑</Text>
        </View>

        <Card style={styles.card}>
          <Text style={styles.title}>Help is on the way</Text>
          <Text style={styles.message}>
            Emergency services have been notified and are en route to your location.
            Read the tips below to avoid any further risks while waiting for assistance.
          </Text>

          {/* Show current location being shared */}
          <View style={styles.locationBox}>
            <Text style={styles.locationLabel}>📍 Your Location:</Text>
            <Text style={styles.locationText}>{locationText}</Text>
          </View>

          <View style={styles.buttonRow}>
            <Button
              title="I've Recovered"
              onPress={handleImRecovered}
              variant="secondary"
              style={styles.button}
            />
            <Button
              title="Call 999"
              onPress={handleCallEmergency}
              variant="danger"
              style={styles.button}
            />
          </View>
        </Card>

        <Card style={styles.tipsCard}>
          {/* TODO: Fetch safety tips dynamically from backend
              GET /safety/instructions/fall-assistance
              This would allow admins to customize instructions */}
          <Text style={styles.tipsTitle}>Safety Tips:</Text>
          <Text style={styles.tip}>• Stay calm and avoid sudden movements</Text>
          <Text style={styles.tip}>• If possible, move to a safe location</Text>
          <Text style={styles.tip}>• Keep your phone nearby</Text>
          <Text style={styles.tip}>• Wait for emergency responders</Text>
          <Text style={styles.tip}>• If you can, signal to nearby people for help</Text>
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    padding: theme.spacing.lg,
    justifyContent: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  iconText: {
    fontSize: 80,
  },
  card: {
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  message: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  locationBox: {
    backgroundColor: `${theme.colors.primary}20`,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    width: '100%',
    marginBottom: theme.spacing.lg,
  },
  locationLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  locationText: {
    fontSize: theme.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    width: '100%',
  },
  button: {
    flex: 1,
  },
  tipsCard: {
    backgroundColor: `${theme.colors.warning}20`,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
  },
  tipsTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  tip: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    lineHeight: 22,
  },
});
