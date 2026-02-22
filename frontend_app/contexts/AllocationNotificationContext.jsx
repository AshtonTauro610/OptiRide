import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchDriverProfile } from "@/services/driver";
import { useRouter } from "expo-router";
import { AppState } from "react-native";

const AllocationNotificationContext = createContext(null);

const POLL_INTERVAL = 30000; // Check every 30 seconds for zone changes

export function AllocationNotificationProvider({ children }) {
    const { token, isAuthenticated } = useAuth();
    const router = useRouter();
    const [lastZone, setLastZone] = useState(null);
    const [newZone, setNewZone] = useState(null);
    const [isPolling, setIsPolling] = useState(false);
    const pollIntervalRef = useRef(null);
    const appState = useRef(AppState.currentState);

    const checkZoneAllocation = useCallback(async () => {
        if (!token) return;

        try {
            const profile = await fetchDriverProfile(token);
            if (profile && profile.current_zone) {
                if (lastZone && lastZone !== profile.current_zone) {
                    setNewZone(profile.current_zone);
                    // Navigate to allocation notification screen
                    router.push({
                        pathname: "/zone-change",
                        params: { zoneId: profile.current_zone },
                    });
                }
                setLastZone(profile.current_zone);
            }
        } catch (error) {
            console.error("Error checking zone allocation:", error);
        }
    }, [token, lastZone, router]);

    const startPolling = useCallback(() => {
        if (pollIntervalRef.current) return;

        setIsPolling(true);
        // Check immediately
        checkZoneAllocation();
        // Then poll at interval
        pollIntervalRef.current = setInterval(checkZoneAllocation, POLL_INTERVAL);
    }, [checkZoneAllocation]);

    const stopPolling = useCallback(() => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
        setIsPolling(false);
    }, []);

    const clearNewZone = useCallback(() => {
        setNewZone(null);
    }, []);

    // Start/stop polling based on auth state
    useEffect(() => {
        if (isAuthenticated && token) {
            startPolling();
        } else {
            stopPolling();
        }

        return () => stopPolling();
    }, [isAuthenticated, token, startPolling, stopPolling]);

    // Handle app state changes
    useEffect(() => {
        const subscription = AppState.addEventListener("change", (nextAppState) => {
            if (appState.current.match(/inactive|background/) && nextAppState === "active") {
                if (isAuthenticated && token) {
                    checkZoneAllocation();
                }
            }
            appState.current = nextAppState;
        });

        return () => subscription?.remove();
    }, [isAuthenticated, token, checkZoneAllocation]);

    return (
        <AllocationNotificationContext.Provider
            value={{
                newZone,
                lastZone,
                isPolling,
                clearNewZone,
                startPolling,
                stopPolling,
            }}
        >
            {children}
        </AllocationNotificationContext.Provider>
    );
}

export function useAllocationNotification() {
    const context = useContext(AllocationNotificationContext);
    if (!context) {
        throw new Error("useAllocationNotification must be used within AllocationNotificationProvider");
    }
    return context;
}
