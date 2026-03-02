import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "expo-router";
import socket from "@/services/socket";

const AllocationNotificationContext = createContext(null);

export function AllocationNotificationProvider({ children }) {
    const { token, isAuthenticated } = useAuth();
    const router = useRouter();
    const [newZone, setNewZone] = useState(null);
    const [navigationTarget, setNavigationTarget] = useState(null);
    const lastZoneRef = useRef(null);

    // Listen for zone allocation via socket
    useEffect(() => {
        if (!isAuthenticated || !token) return;

        const handleAllocation = (data) => {
            const zoneId = data?.zone_id;
            console.log("[Zone] Socket: driver_allocated received:", zoneId);

            // Prevent double popups for the same exact zone if triggered rapidly
            if (zoneId && zoneId !== lastZoneRef.current) {
                lastZoneRef.current = zoneId;
                setNewZone(zoneId);

                if (data.latitude && data.longitude) {
                    setNavigationTarget({
                        zoneId: zoneId,
                        zoneName: data.zone_name || zoneId,
                        latitude: data.latitude,
                        longitude: data.longitude
                    });
                } else {
                    setNavigationTarget(null);
                }

                router.push({
                    pathname: "/zone-change",
                    params: { zoneId },
                });
            }
        };

        socket.on("driver_allocated", handleAllocation);
        console.log("[Zone] Listening for driver_allocated events");

        return () => {
            socket.off("driver_allocated", handleAllocation);
        };
    }, [isAuthenticated, token, router]);

    const clearNewZone = useCallback(() => {
        setNewZone(null);
    }, []);

    const clearNavigationTarget = useCallback(() => {
        setNavigationTarget(null);
        lastZoneRef.current = null;
    }, []);

    return (
        <AllocationNotificationContext.Provider
            value={{
                newZone,
                navigationTarget,
                clearNewZone,
                clearNavigationTarget,
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
