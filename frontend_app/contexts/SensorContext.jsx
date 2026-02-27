import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Platform, AppState } from "react-native";
import { Accelerometer, Gyroscope } from "expo-sensors";
import * as Location from "expo-location";
import { useAuth } from "./AuthContext";
import { submitSensorData } from "@/services/safety";
import * as Battery from "expo-battery";
import * as Network from "expo-network";
import { updateDriverLocation, updateDriverStatus, startShift, endShift, updateTelemetry } from "@/services/driver";
import { useRouter } from "expo-router";
import socket from "@/services/socket";

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
    const router = useRouter();
    const [isMonitoring, setIsMonitoring] = useState(false);
    const [isOnline, setIsOnline] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const isMonitoringRef = useRef(false); // Use ref to track monitoring state for checks

    // Safety Alert Socket Listener
    useEffect(() => {
        const handleSafetyAlert = (alertData) => {
            console.log("[Sockets] Received safety_alert:", alertData);
            if (alertData && alertData.alert_type === "CRITICAL_CRASH") {
                router.push('/fall-detection');
            }
        };

        socket.on("safety_alert", handleSafetyAlert);

        return () => {
            socket.off("safety_alert", handleSafetyAlert);
        };
    }, [router]);

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
    const locationTrackingRef = useRef(false); // Track if location is running
    const appStateRef = useRef(AppState.currentState);

    // Break state (persists across navigation)
    const [isOnBreak, setIsOnBreak] = useState(false);
    const [breakStartTime, setBreakStartTime] = useState(null);
    const [breakDuration, setBreakDuration] = useState(0);
    const breakIntervalRef = useRef(null);

    // Auto-online on login: start shift if driver is offline
    const hasAutoStarted = useRef(false);
    useEffect(() => {
        if (!user || !token || hasAutoStarted.current) return;

        const isAlreadyOnline = user.status === "available" || user.status === "busy";
        if (isAlreadyOnline) {
            setIsOnline(true);
            hasAutoStarted.current = true;
            return;
        }

        // Auto start shift
        const autoStart = async () => {
            console.log("Triggering auto-online (start shift) on login...");
            // Small delay to ensure auth state is fully propagated to all interceptors
            await new Promise(resolve => setTimeout(resolve, 500));
            try {
                let lat = 0, lng = 0;
                if (Platform.OS !== "web") {
                    try {
                        const { status } = await Location.requestForegroundPermissionsAsync();
                        if (status === "granted") {
                            const loc = await Promise.race([
                                Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
                                new Promise(resolve => setTimeout(resolve, 3000, null)) // 3s timeout
                            ]);
                            if (loc) {
                                lat = loc.coords.latitude;
                                lng = loc.coords.longitude;
                            }
                        }
                    } catch (e) {
                        console.warn("Location fetch for autoStart failed:", e.message);
                    }
                }

                console.log(`Sending startShift with auth token, lat: ${lat}, lng: ${lng}`);
                await startShift(token, {
                    start_time: new Date().toISOString(),
                    start_latitude: lat,
                    start_longitude: lng,
                });

                console.log("startShift succeeded, now updating status to available");
                await updateDriverStatus(token, "available");
                setIsOnline(true);
                console.log("✅ Auto-started shift and went online successfully");
            } catch (error) {
                // Shift might already be started — just go available
                console.log("⚠️ Auto-start shift failed, attempting to just go available... Error:", error.message || "Unknown error");
                try {
                    await updateDriverStatus(token, "available");
                    setIsOnline(true);
                    console.log("✅ Successfully went available after shift start failed");
                } catch (e) {
                    console.error("❌ Auto-online fully failed:", e.message || "Unknown error");
                }
            }
            hasAutoStarted.current = true;
        };
        autoStart();
    }, [user, token]);

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

    // Start/Stop basic location tracking based on Online status OR monitoring status
    useEffect(() => {
        let subscription = null;
        let isMounted = true;

        const startTracking = async () => {
            // Prevent multiple subscriptions
            if (locationTrackingRef.current) {
                return;
            }

            if (Platform.OS === "web") return;
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== "granted") {
                console.log("Location permission not granted");
                return;
            }

            if (!isMounted) return;

            locationTrackingRef.current = true;
            console.log("Starting location tracking for speed...");

            subscription = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.BestForNavigation,
                    timeInterval: 500,
                    distanceInterval: 1,
                },
                (location) => {
                    const speedMs = location.coords.speed;
                    const speedKmh = speedMs && speedMs > 0 ? speedMs * 3.6 : 0;
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
            console.log("Location tracking started");
        };

        // Start tracking if online OR if monitoring is active
        if ((isOnline || isMonitoring) && token) {
            startTracking();
        }

        return () => {
            isMounted = false;
            locationTrackingRef.current = false;
            if (subscription) {
                subscription.remove();
                console.log("Location tracking stopped");
            }
        };
    }, [isOnline, isMonitoring, token]); // Removed function dependencies

    // Separate effect for telemetry intervals (only when online)
    useEffect(() => {
        if (isOnline && token) {
            telemetryIntervalRef.current = setInterval(() => {
                if (locationData) {
                    updateDriverLocation(token, {
                        latitude: locationData.latitude,
                        longitude: locationData.longitude,
                        speed: locationData.speed || 0,
                        heading: locationData.heading || 0
                    }).catch(err => console.warn("Telemetry update failed:", err.message));
                }
            }, TELEMETRY_INTERVAL);

            deviceStatsIntervalRef.current = setInterval(() => {
                updateTelemetry(token, {
                    battery_level: batteryLevel,
                    network_strength: networkStrength,
                    camera_active: isMonitoring
                }).catch(err => console.warn("Device stats update failed:", err.message));
            }, DEVICE_STATS_INTERVAL);
        }

        return () => {
            if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
            if (deviceStatsIntervalRef.current) clearInterval(deviceStatsIntervalRef.current);
        };
    }, [isOnline, token]);

    // Start sensor monitoring (high frequency)
    const startMonitoring = useCallback(async () => {
        if (Platform.OS === "web") {
            console.warn("Sensor monitoring not available on web");
            return false;
        }

        // Check if already monitoring using ref (avoids stale closure)
        if (isMonitoringRef.current) {
            console.log("Already monitoring sensors");
            return true;
        }

        // Mark as monitoring immediately to prevent double-starts
        isMonitoringRef.current = true;

        try {
            console.log("Starting sensor monitoring...");
            const newSessionId = generateSessionId();
            setSessionId(newSessionId);

            // Check if sensors are available
            const accelAvailable = await Accelerometer.isAvailableAsync();
            const gyroAvailable = await Gyroscope.isAvailableAsync();

            console.log(`Accelerometer available: ${accelAvailable}, Gyroscope available: ${gyroAvailable}`);

            if (!accelAvailable && !gyroAvailable) {
                console.warn("No sensors available on this device");
                // Still set monitoring to true so we at least track GPS speed
                setIsMonitoring(true);
                return true;
            }

            // Set sensor update intervals
            Accelerometer.setUpdateInterval(SENSOR_UPDATE_INTERVAL);
            Gyroscope.setUpdateInterval(SENSOR_UPDATE_INTERVAL);

            // Subscribe to accelerometer if available
            if (accelAvailable) {
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
                console.log("Accelerometer subscription created");
            }

            // Subscribe to gyroscope if available
            if (gyroAvailable) {
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
                console.log("Gyroscope subscription created");
            }

            // Start batch sending interval
            batchIntervalRef.current = setInterval(() => {
                sendSensorBatch(newSessionId);
            }, BATCH_SEND_INTERVAL);

            // Update state - use callback form to ensure it triggers
            setIsMonitoring(() => {
                console.log("setIsMonitoring callback - setting to true");
                return true;
            });
            console.log("Sensor monitoring started successfully");
            return true;
        } catch (error) {
            console.error("Error starting sensor monitoring:", error);
            // Even if sensors fail, set monitoring true so UI doesn't keep showing the button
            isMonitoringRef.current = true;
            setIsMonitoring(true);
            return false;
        }
    }, [analyzeAccelerometer, analyzeGyroscope]);

    // Stop sensor monitoring
    const stopMonitoring = useCallback(() => {
        console.log("Stopping sensor monitoring...");
        isMonitoringRef.current = false;
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

        // Don't send batch here as it causes dependency issues
        // The batch will be sent on next interval or lost (acceptable)

        setIsMonitoring(false);
        setSessionId(null);
        accelerometerBuffer.current = [];
        gyroscopeBuffer.current = [];
        console.log("Sensor monitoring stopped");
    }, []); // No dependencies - stable function reference

    // Toggle duty status
    const toggleOnline = useCallback(async () => {
        if (!token) return;

        try {
            if (isOnline) {
                // End Shift - go offline
                await endShift(token, {
                    end_time: new Date().toISOString(),
                    end_latitude: locationData?.latitude || 0,
                    end_longitude: locationData?.longitude || 0
                });
                // Also update driver status explicitly
                await updateDriverStatus(token, "offline");
                setIsOnline(false);
                console.log("Shift ended (Go Off-Duty)");
            } else {
                // Start Shift - go online
                await startShift(token, {
                    start_time: new Date().toISOString(),
                    start_latitude: locationData?.latitude || 0,
                    start_longitude: locationData?.longitude || 0
                });
                // Also update driver status explicitly
                await updateDriverStatus(token, "available");
                setIsOnline(true);
                console.log("Shift started (Go On-Duty)");
            }
        } catch (error) {
            console.warn("Failed to update driver shift status:", error.message || "Unknown error");
            // Fallback to basic status update if shift endpoints fail
            try {
                const newStatus = isOnline ? "offline" : "available";
                await updateDriverStatus(token, newStatus);
                setIsOnline(!isOnline);
            } catch (innerError) {
                console.error("Critical failure updating status:", innerError?.message || "Unknown error");
            }
        }
    }, [token, isOnline, locationData]);

    // Break management functions
    const startBreak = useCallback(async () => {
        if (!token) return false;
        try {
            await updateDriverStatus(token, "on_break");
            setIsOnBreak(true);
            setBreakStartTime(Date.now());
            setBreakDuration(0);

            // Start timer
            breakIntervalRef.current = setInterval(() => {
                setBreakDuration((prev) => prev + 1);
            }, 1000);

            console.log("Break started");
            return true;
        } catch (error) {
            console.error("Failed to start break:", error);
            return false;
        }
    }, [token]);

    const endBreak = useCallback(async () => {
        if (!token) return false;
        try {
            await updateDriverStatus(token, "available");

            if (breakIntervalRef.current) {
                clearInterval(breakIntervalRef.current);
                breakIntervalRef.current = null;
            }

            const finalDuration = breakDuration;
            setIsOnBreak(false);
            setBreakStartTime(null);
            setBreakDuration(0);

            console.log("Break ended after", finalDuration, "seconds");
            return finalDuration;
        } catch (error) {
            console.error("Failed to end break:", error);
            return false;
        }
    }, [token, breakDuration]);

    // Clean up break interval on unmount
    useEffect(() => {
        return () => {
            if (breakIntervalRef.current) {
                clearInterval(breakIntervalRef.current);
            }
        };
    }, []);

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

    // Cleanup on unmount only (empty dependency array)
    useEffect(() => {
        return () => {
            // Only cleanup subscriptions directly, don't call stopMonitoring
            // as it may have stale closures
            if (accelerometerSubscription.current) {
                accelerometerSubscription.current.remove();
            }
            if (gyroscopeSubscription.current) {
                gyroscopeSubscription.current.remove();
            }
            if (batchIntervalRef.current) {
                clearInterval(batchIntervalRef.current);
            }
        };
    }, []); // Empty deps - only run on unmount

    // Debug log when isMonitoring changes
    useEffect(() => {
        console.log('[SensorContext] isMonitoring updated to:', isMonitoring);
    }, [isMonitoring]);

    // Don't use useMemo - it can cause stale value issues
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
        // Break state
        isOnBreak,
        breakDuration,
        startBreak,
        endBreak,
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
