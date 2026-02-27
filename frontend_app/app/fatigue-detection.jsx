import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { theme } from '@/constants/theme';
import { useSensors } from '@/contexts/SensorContext';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function FatigueDetectionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { startMonitoring, isMonitoring } = useSensors();
  const [isPassed, setIsPassed] = useState(false);
  const [isStartingSensors, setIsStartingSensors] = useState(false);
  const [progress] = useState(new Animated.Value(0));
  const [scanAnimation] = useState(new Animated.Value(0));
  const hasStartedMonitoring = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);

  const orderId = params.orderId;

  // Request camera permission on mount
  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnimation, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(scanAnimation, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    ).start();

    const timer = setTimeout(() => {
      handleFatigueCheckPassed();
    }, 4000); // Give more time for camera to load

    return () => clearTimeout(timer);
  }, [scanAnimation]);

  const handleFatigueCheckPassed = async () => {
    setIsPassed(true);
    Animated.timing(progress, {
      toValue: 1,
      duration: 500,
      useNativeDriver: false,
    }).start();

    // Start sensor monitoring after fatigue check passes (only on mobile)
    if (Platform.OS !== 'web' && !hasStartedMonitoring.current && !isMonitoring) {
      hasStartedMonitoring.current = true;
      setIsStartingSensors(true);
      try {
        await startMonitoring();
        console.log('Safety monitoring started successfully');
      } catch (error) {
        console.warn('Failed to start safety monitoring:', error);
      }
      setIsStartingSensors(false);
    }

    // Navigate to map tab (which shows the route) after a short delay
    setTimeout(() => {
      router.replace('/(tabs)/map');
    }, 2000);
  };

  const scanTranslateY = scanAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 100],
  });

  // Camera not available (web or no permission yet granted or permission is loading)
  const showCameraFallback = Platform.OS === 'web' || !permission || !permission.granted;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fatigue Detection</Text>

      <View style={styles.cameraFrame}>
        <View style={styles.circle}>
          {!isPassed ? (
            <>
              {showCameraFallback ? (
                // Fallback for web or no camera permission
                <View style={styles.cameraFallback}>
                  <View style={styles.face} />
                  <Text style={styles.permissionText}>
                    {!permission?.granted ? 'Camera permission required' : 'Camera not available'}
                  </Text>
                </View>
              ) : (
                // Show actual camera feed - using View wrapper with proper dimensions
                <View style={styles.cameraContainer}>
                  <CameraView
                    style={styles.camera}
                    facing="front"
                    onCameraReady={() => {
                      console.log('Camera is ready');
                      setCameraReady(true);
                    }}
                  />
                </View>
              )}
              <Animated.View
                style={[
                  styles.scanLine,
                  { transform: [{ translateY: scanTranslateY }] }
                ]}
              />
              {/* Overlay frame for face positioning */}
              <View style={styles.faceOverlay}>
                <View style={styles.faceGuide} />
              </View>
            </>
          ) : (
            <View style={styles.checkmark}>
              <Text style={styles.checkmarkText}>✓</Text>
            </View>
          )}
        </View>
      </View>

      <Text style={styles.instruction}>
        {isPassed
          ? (isStartingSensors ? 'Starting safety monitoring...' : 'Fatigue check passed')
          : 'Position your face in the frame'}
      </Text>

      {!isPassed && (
        <View style={styles.progressContainer}>
          <Text style={styles.progressText}>
            {cameraReady ? 'Analyzing...' : 'Initializing camera...'}
          </Text>
        </View>
      )}

      {isPassed && !isStartingSensors && (
        <Text style={styles.caption}>
          Safety monitoring active • Opening navigation
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: theme.spacing.xl,
  },
  cameraFrame: {
    width: 280,
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xl,
  },
  circle: {
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 4,
    borderColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#1e293b',
  },
  cameraContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    borderRadius: 120,
  },
  camera: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  cameraFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: {
    width: 80,
    height: 100,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  permissionText: {
    marginTop: 8,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  faceOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceGuide: {
    width: 100,
    height: 130,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderStyle: 'dashed',
  },
  scanLine: {
    position: 'absolute',
    width: '100%',
    height: 2,
    backgroundColor: theme.colors.accent,
    shadowColor: theme.colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
  },
  checkmark: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    fontSize: 60,
    color: '#ffffff',
    fontWeight: '700',
  },
  instruction: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  progressContainer: {
    marginTop: theme.spacing.lg,
  },
  progressText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.accent,
    fontWeight: '600',
  },
  caption: {
    fontSize: theme.fontSize.sm,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: theme.spacing.md,
  },
});
