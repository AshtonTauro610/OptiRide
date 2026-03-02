import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { theme } from '@/constants/theme';
import { zones } from '@/mocks/zones';

export default function ZoneChangeScreen() {
  const router = useRouter();
  const { zoneId } = useLocalSearchParams();

  // Try to match by code or id; fallback to displaying the zone ID directly
  const matchedZone = zones.find(z => z.code === zoneId || z.id === zoneId);

  // Format zone name for display (e.g. "zone_dubai_marina" → "Dubai Marina")
  const formatZoneName = (id) => {
    if (!id) return 'Unknown';
    return id
      .replace(/^zone_/, '')
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  };

  const zoneName = matchedZone?.name || formatZoneName(zoneId);
  const zoneCode = matchedZone?.code || zoneId;

  return (
    <View style={styles.container}>
      {/* Background layer */}
      <View style={styles.background} />

      <TouchableOpacity
        style={styles.closeButton}
        onPress={() => router.back()}
        activeOpacity={0.7}
      >
        <Text style={styles.closeButtonText}>✕</Text>
      </TouchableOpacity>

      <View style={styles.cardContainer}>
        <Card style={styles.notificationCard}>
          <Text style={styles.title}>Zone Allocation</Text>
          <Text style={styles.message}>
            You have been allocated to {zoneName}.
            Please proceed to your assigned zone to start accepting orders.
          </Text>
          <View style={styles.buttonRow}>
            <Button
              title="Dismiss"
              onPress={() => router.back()}
              variant="secondary"
              style={styles.button}
            />
            <Button
              title="Navigate"
              onPress={() => {
                // Return to the main map screen which will automatically show the zone route
                router.replace('/(tabs)/map');
              }}
              variant="primary"
              style={styles.button}
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
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  closeButtonText: {
    fontSize: 20,
    color: theme.colors.text,
    fontWeight: '600',
  },
  cardContainer: {
    position: 'absolute',
    top: 100,
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
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.error,
    marginBottom: theme.spacing.md,
  },
  message: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    lineHeight: 24,
    marginBottom: theme.spacing.lg,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  button: {
    flex: 1,
  },
});
