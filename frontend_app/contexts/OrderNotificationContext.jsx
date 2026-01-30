import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchOfferedOrders } from "@/services/orders";
import { useRouter } from "expo-router";
import { AppState } from "react-native";

const OrderNotificationContext = createContext(null);

const POLL_INTERVAL = 10000; // Check every 10 seconds

export function OrderNotificationProvider({ children }) {
    const { token, isAuthenticated } = useAuth();
    const router = useRouter();
    const [currentOffer, setCurrentOffer] = useState(null);
    const [isPolling, setIsPolling] = useState(false);
    const pollIntervalRef = useRef(null);
    const appState = useRef(AppState.currentState);

    const checkForOffers = useCallback(async () => {
        if (!token) return;

        try {
            const offers = await fetchOfferedOrders(token);
            if (offers && offers.length > 0) {
                // Take the first offered order
                const offer = offers[0];
                if (!currentOffer || currentOffer.order_id !== offer.order_id) {
                    setCurrentOffer(offer);
                    // Navigate to notification screen
                    router.push({
                        pathname: "/order-notification",
                        params: { orderId: offer.order_id },
                    });
                }
            }
        } catch (error) {
            console.error("Error checking for offers:", error);
        }
    }, [token, currentOffer, router]);

    const startPolling = useCallback(() => {
        if (pollIntervalRef.current) return;

        setIsPolling(true);
        // Check immediately
        checkForOffers();
        // Then poll at interval
        pollIntervalRef.current = setInterval(checkForOffers, POLL_INTERVAL);
    }, [checkForOffers]);

    const stopPolling = useCallback(() => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
        setIsPolling(false);
    }, []);

    const clearCurrentOffer = useCallback(() => {
        setCurrentOffer(null);
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

    // Handle app state changes (pause polling when backgrounded)
    useEffect(() => {
        const subscription = AppState.addEventListener("change", (nextAppState) => {
            if (appState.current.match(/inactive|background/) && nextAppState === "active") {
                // App came to foreground - check immediately
                if (isAuthenticated && token) {
                    checkForOffers();
                }
            }
            appState.current = nextAppState;
        });

        return () => subscription?.remove();
    }, [isAuthenticated, token, checkForOffers]);

    return (
        <OrderNotificationContext.Provider
            value={{
                currentOffer,
                isPolling,
                checkForOffers,
                clearCurrentOffer,
                startPolling,
                stopPolling,
            }}
        >
            {children}
        </OrderNotificationContext.Provider>
    );
}

export function useOrderNotification() {
    const context = useContext(OrderNotificationContext);
    if (!context) {
        throw new Error("useOrderNotification must be used within OrderNotificationProvider");
    }
    return context;
}
