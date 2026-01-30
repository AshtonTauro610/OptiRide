import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { Platform, AppState } from "react-native";
import { Accelerometer, Gyroscope } from "expo-sensors";
import * as Location from "expo-location";
import { useAuth } from "./AuthContext";
import { submitSensorData } from "@/services/safety";
import * as Battery from "expo-battery";
import * as Network from "expo-network";
import { updateDriverLocation, updateDriverStatus, startShift, endShift, updateTelemetry } from "@/services/driver";

// Thresholds for event detection
const THRESHOLDS = {
    HARSH_BRAKING: 8.0,      // m/s² - sudden deceleration
    HARSH_ACCELERATION: 6.0,  // m/s² - sudden acceleration
    SHARP_TURN: 3.0,          // rad/s - angular velocity
    SUDDEN_IMPACT: 15.0,      // m/s² - potential crash
    SPEED_LIMIT: 120,         // km/h - over speed limit
};

// Collection intervals
const SENSOR_UPDATE_INTERVAL = 100;  // ms - how often to read sensors
const BATCH_SEND_INTERVAL = 10000;   // ms - how often to send batch to backend
const LOCATION_INTERVAL = 5000;      // ms - GPS update interval
const TELEMETRY_INTERVAL = 10000;    // ms - how often to send location to dispatcher when online
const DEVICE_STATS_INTERVAL = 60000; // ms - how often to send battery/network stats

const SensorContext = createContext(null);

export function SensorProvider({ children }) {
    const { token, user } = useAuth();
    const [isMonitoring, setIsMonitoring] = useState(false);
    const [isOnline, setIsOnline] = useState(false);
    const [sessionId, setSessionId] = useState(null);

    // Real-time sensor values
    const [currentSpeed, setCurrentSpeed] = useState(0);
    const [accelerometerData, setAccelerometerData] = useState({ x: 0, y: 0, z: 0 });
    const [gyroscopeData, setGyroscopeData] = useState({ x: 0, y: 0, z: 0 });
    const [locationData, setLocationData] = useState(null);

    // Device telemetry
    const [batteryLevel, setBatteryLevel] = useState(100);
    const [networkStrength, setNetworkStrength] = useState("unknown");
    const [cameraActive, setCameraActive] = useState(false);

    // Event flags
    const [lastAlert, setLastAlert] = useState(null);
    const [safetyScore, setSafetyScore] = useState(100);

    // Data buffers for batching
    const accelerometerBuffer = useRef([]);
    const gyroscopeBuffer = useRef([]);
    const locationSubscription = useRef(null);
    const accelerometerSubscription = useRef(null);
    const gyroscopeSubscription = useRef(null);
    const batchIntervalRef = useRef(null);
    const telemetryIntervalRef = useRef(null);
    const deviceStatsIntervalRef = useRef(null);
    const appStateRef = useRef(AppState.currentState);

    // Sync isOnline state with driver profile on load
    useEffect(() => {
        if (user?.status) {
            setIsOnline(user.status === "available" || user.status === "busy");
        }
    }, [user]);

    // Generate unique session ID
    const generateSessionId = () => {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    };

    // Calculate magnitude from xyz values
    const calculateMagnitude = (x, y, z) => {
        return Math.sqrt(x * x + y * y + z * z);
    };

    // Analyze accelerometer for events
    const analyzeAccelerometer = useCallback((data) => {
        const magnitude = calculateMagnitude(data.x, data.y, data.z);
        // Subtract gravity (~9.8)
        const netAcceleration = Math.abs(magnitude - 9.8);

        if (netAcceleration > THRESHOLDS.SUDDEN_IMPACT) {
            setLastAlert({ type: "CRASH_DETECTED", severity: "critical", timestamp: new Date() });
        } else if (netAcceleration > THRESHOLDS.HARSH_BRAKING) {
            setLastAlert({ type: "HARSH_BRAKING", severity: "warning", timestamp: new Date() });
        } else if (netAcceleration > THRESHOLDS.HARSH_ACCELERATION) {
            setLastAlert({ type: "HARSH_ACCELERATION", severity: "warning", timestamp: new Date() });
        }

        return { ...data, magnitude, netAcceleration };
    }, []);

    // Analyze gyroscope for sharp turns
    const analyzeGyroscope = useCallback((data) => {
        const angularVelocity = calculateMagnitude(data.x, data.y, data.z);

        if (angularVelocity > THRESHOLDS.SHARP_TURN) {
            setLastAlert({ type: "SHARP_TURN", severity: "warning", timestamp: new Date() });
        }

        return { ...data, angularVelocity };
    }, []);

    // Send device health telemetry (Battery, Network, Camera)
    const sendDeviceTelemetry = useCallback(async () => {
        if (!token || Platform.OS === "web") return;

        try {
            const battery = await Battery.getBatteryLevelAsync();
            const network = await Network.getNetworkStateAsync();

            const level = Math.round(battery * 100);
            const strengthMap = {
                [Network.NetworkStateType.WIFI]: "strong",
                [Network.NetworkStateType.CELLULAR]: "moderate",
                [Network.NetworkStateType.NONE]: "none",
                [Network.NetworkStateType.UNKNOWN]: "unknown"
            };
            const strength = strengthMap[network.type] || "moderate";

            setBatteryLevel(level);
            setNetworkStrength(strength);

            await updateTelemetry(token, {
                battery_level: level,
                network_strength: strength,
                camera_active: isMonitoring
            });
            console.log(`Device telemetry sent: ${level}% battery, ${strength} network`);
        } catch (error) {
            console.warn("Device telemetry update failed:", error.message);
        }
    }, [token, isMonitoring]);

    // Send single telemetry update (location only)
    const sendTelemetryUpdate = useCallback(async () => {
        if (!token || !locationData || Platform.OS === "web") return;

        try {
            await updateDriverLocation(token, {
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                speed: locationData.speed || 0,
                heading: locationData.heading || 0
            });
            console.log("Location telemetry sent (Dispatcher tracking)");
        } catch (error) {
            console.warn("Telemetry update failed:", error.message);
        }
    }, [token, locationData]);

    // Start/Stop basic location tracking based on Online status
    useEffect(() => {
        let subscription = null;

        const startTracking = async () => {
            if (Platform.OS === "web") return;
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== "granted") return;

            subscription = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: LOCATION_INTERVAL,
                    distanceInterval: 10,
                },
                (location) => {
                    const speedKmh = (location.coords.speed || 0) * 3.6;
                    setCurrentSpeed(speedKmh);
                    setLocationData({
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        speed: location.coords.speed,
                        heading: location.coords.heading,
                        timestamp: new Date().toISOString(),
                    });

                    if (speedKmh > THRESHOLDS.SPEED_LIMIT) {
                        setLastAlert({ type: "OVER_SPEED", severity: "warning", speed: speedKmh, timestamp: new Date() });
                    }
                }
            );

            // Start intervals
            telemetryIntervalRef.current = setInterval(sendTelemetryUpdate, TELEMETRY_INTERVAL);
            deviceStatsIntervalRef.current = setInterval(sendDeviceTelemetry, DEVICE_STATS_INTERVAL);

            // Send initial telemetry immediately
            sendDeviceTelemetry();
        };

        if (isOnline && token) {
            startTracking();
        } else {
            if (subscription) subscription.remove();
            if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
            if (deviceStatsIntervalRef.current) clearInterval(deviceStatsIntervalRef.current);
        }

        return () => {
            if (subscription) subscription.remove();
            if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
            if (deviceStatsIntervalRef.current) clearInterval(deviceStatsIntervalRef.current);
        };
    }, [isOnline, token, sendTelemetryUpdate, sendDeviceTelemetry]);

    // Start sensor monitoring (high frequency)
    const startMonitoring = useCallback(async () => {
        if (Platform.OS === "web") {
            console.warn("Sensor monitoring not available on web");
            return false;
        }

        try {
            const newSessionId = generateSessionId();
            setSessionId(newSessionId);

            // Set sensor update intervals
            Accelerometer.setUpdateInterval(SENSOR_UPDATE_INTERVAL);
            Gyroscope.setUpdateInterval(SENSOR_UPDATE_INTERVAL);

            // Subscribe to accelerometer
            accelerometerSubscription.current = Accelerometer.addListener((data) => {
                const analyzed = analyzeAccelerometer(data);
                setAccelerometerData(analyzed);
                accelerometerBuffer.current.push({
                    x: data.x,
                    y: data.y,
                    z: data.z,
                    timestamp: new Date().toISOString(),
                });
                if (accelerometerBuffer.current.length > 100) {
                    accelerometerBuffer.current.shift();
                }
            });

            // Subscribe to gyroscope
            gyroscopeSubscription.current = Gyroscope.addListener((data) => {
                const analyzed = analyzeGyroscope(data);
                setGyroscopeData(analyzed);
                gyroscopeBuffer.current.push({
                    x: data.x,
                    y: data.y,
                    z: data.z,
                    timestamp: new Date().toISOString(),
                });
                if (gyroscopeBuffer.current.length > 100) {
                    gyroscopeBuffer.current.shift();
                }
            });

            // Start batch sending interval
            batchIntervalRef.current = setInterval(() => {
                sendSensorBatch(newSessionId);
            }, BATCH_SEND_INTERVAL);

            setIsMonitoring(true);
            return true;
        } catch (error) {
            console.error("Error starting sensor monitoring:", error);
            return false;
        }
    }, [analyzeAccelerometer, analyzeGyroscope]);

    // Stop sensor monitoring
    const stopMonitoring = useCallback(() => {
        if (accelerometerSubscription.current) {
            accelerometerSubscription.current.remove();
            accelerometerSubscription.current = null;
        }
        if (gyroscopeSubscription.current) {
            gyroscopeSubscription.current.remove();
            gyroscopeSubscription.current = null;
        }
        if (batchIntervalRef.current) {
            clearInterval(batchIntervalRef.current);
            batchIntervalRef.current = null;
        }

        if (sessionId) {
            sendSensorBatch(sessionId);
        }

        setIsMonitoring(false);
        setSessionId(null);
        accelerometerBuffer.current = [];
        gyroscopeBuffer.current = [];
    }, [sessionId]);

    // Toggle duty status
    const toggleOnline = useCallback(async () => {
        if (!token) return;

        try {
            if (isOnline) {
                // End Shift
                await endShift(token, {
                    end_time: new Date().toISOString(),
                    end_latitude: locationData?.latitude || 0,
                    end_longitude: locationData?.longitude || 0
                });
                setIsOnline(false);
                console.log("Shift ended (Go Off-Duty)");
            } else {
                // Start Shift
                await startShift(token, {
                    start_time: new Date().toISOString(),
                    start_latitude: locationData?.latitude || 0,
                    start_longitude: locationData?.longitude || 0
                });
                setIsOnline(true);
                console.log("Shift started (Go On-Duty)");
            }
        } catch (error) {
            console.warn("Failed to update driver shift status:", error.message);
            // Fallback to basic status update if shift endpoints fail
            try {
                const newStatus = isOnline ? "offline" : "available";
                await updateDriverStatus(token, newStatus);
                setIsOnline(!isOnline);
            } catch (innerError) {
                console.error("Critical failure updating status:", innerError.message);
            }
        }
    }, [token, isOnline, locationData]);

    // Send sensor batch to backend
    const sendSensorBatch = useCallback(async (currentSessionId) => {
        if (!token || !user?.driver_id || accelerometerBuffer.current.length === 0) {
            return;
        }

        const batch = {
            driver_id: user.driver_id,
            session_id: currentSessionId,
            accelerometer_data: [...accelerometerBuffer.current],
            gyroscope_data: [...gyroscopeBuffer.current],
            location_data: locationData || {
                latitude: 0,
                longitude: 0,
                speed: 0,
                timestamp: new Date().toISOString(),
            },
        };

        try {
            const result = await submitSensorData(token, batch);
            if (result.fatigue_score !== null) {
                const newScore = Math.max(0, 100 - (result.fatigue_score * 100));
                setSafetyScore(Math.round(newScore));
            }
            accelerometerBuffer.current = [];
            gyroscopeBuffer.current = [];
            console.log("Safety sensor batch sent:", result);
        } catch (error) {
            console.warn("Failed to send sensor batch:", error.message);
        }
    }, [token, user, locationData]);

    // Handle app state changes
    useEffect(() => {
        const subscription = AppState.addEventListener("change", (nextAppState) => {
            if (appStateRef.current.match(/active/) && nextAppState === "background") {
                console.log("App in background, sensors still active");
            }
            appStateRef.current = nextAppState;
        });
        return () => subscription?.remove();
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopMonitoring();
        };
    }, [stopMonitoring]);

    const value = {
        isMonitoring,
        isOnline,
        sessionId,
        currentSpeed,
        accelerometerData,
        gyroscopeData,
        locationData,
        batteryLevel,
        networkStrength,
        cameraActive,
        lastAlert,
        safetyScore,
        startMonitoring,
        stopMonitoring,
        toggleOnline,
    };

    return (
        <SensorContext.Provider value={value}>
            {children}
        </SensorContext.Provider>
    );
}

export function useSensors() {
    const context = useContext(SensorContext);
    if (!context) {
        throw new Error("useSensors must be used within a SensorProvider");
    }
    return context;
}

export default SensorContext;
