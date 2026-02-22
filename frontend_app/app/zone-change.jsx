import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MapView, { Polygon } from 'react-native-maps';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { theme } from '@/constants/theme';
import { zones } from '@/mocks/zones';

export default function ZoneChangeScreen() {
  const router = useRouter();
  const { zoneId } = useLocalSearchParams();
  const newZone = zones.find(z => z.code === zoneId) || zones.find(z => z.code === 'A3');

  return (
    <View style={styles.container}>
      <MapView
        provider="google"
        style={styles.map}
        initialRegion={{
          latitude: 25.1952,
          longitude: 55.2721,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        }}
      >
        {zones.map((zone) => (
          <Polygon
            key={zone.id}
            coordinates={zone.coordinates}
            fillColor={`${zone.color}40`}
            strokeColor={zone.color}
            strokeWidth={2}
          />
        ))}
      </MapView>

      <TouchableOpacity
        style={styles.closeButton}
        onPress={() => router.back()}
        activeOpacity={0.7}
      >
        <Text style={styles.closeButtonText}>✕</Text>
      </TouchableOpacity>

      <View style={styles.cardContainer}>
        <Card style={styles.notificationCard}>
          <Text style={styles.title}>Zone Change</Text>
          <Text style={styles.message}>
            Due to high demand you have been reassigned to Zone {newZone?.code}.
            Please proceed to Zone {newZone?.code} to continue accepting orders.
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
              onPress={() => router.push('/zone-navigation')}
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
  map: {
    flex: 1,
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
