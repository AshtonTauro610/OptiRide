import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchOfferedOrders } from "@/services/orders";
import { useRouter } from "expo-router";
import { AppState } from "react-native";
import socket from "@/services/socket";

const OrderNotificationContext = createContext(null);

export function OrderNotificationProvider({ children }) {
    const { token, isAuthenticated } = useAuth();
    const router = useRouter();
    const [currentOffer, setCurrentOffer] = useState(null);
    const appState = useRef(AppState.currentState);

    // Initial sync / background recovery sync
    const syncOffers = useCallback(async () => {
        if (!token) return;

        try {
            const offers = await fetchOfferedOrders(token);
            if (offers && offers.length > 0) {
                const offer = offers[0];
                if (!currentOffer || currentOffer.order_id !== offer.order_id) {
                    setCurrentOffer(offer);
                    router.push({
                        pathname: "/order-notification",
                        params: { orderId: offer.order_id },
                    });
                }
            } else if (currentOffer) {
                // Offer disappeared
                setCurrentOffer(null);
            }
        } catch (error) {
            console.error("Error checking for offers:", error);
        }
    }, [token, currentOffer, router]);

    // Setup Socket Listeners
    useEffect(() => {
        if (!isAuthenticated || !token) {
            setCurrentOffer(null);
            return;
        }

        // Perform initial sync on mount or auth
        syncOffers();

        // Socket listener for instantaneous broadcast push
        const handleNewOffer = (offerData) => {
            console.log("[Sockets] Received order_offer:", offerData.order_id);
            setCurrentOffer(offerData);
            router.push({
                pathname: "/order-notification",
                params: { orderId: offerData.order_id },
            });
        };

        // Socket listener for when someone else accepted the broadcast
        const handleOfferExpired = (data) => {
            const orderId = typeof data === 'string' ? data : data.order_id;
            console.log("[Sockets] Received order_offer_expired:", orderId);
            setCurrentOffer(prev => {
                if (prev && prev.order_id === orderId) {
                    return null;
                }
                return prev;
            });
        };

        socket.on("order_offer", handleNewOffer);
        socket.on("order_offer_expired", handleOfferExpired);

        return () => {
            socket.off("order_offer", handleNewOffer);
            socket.off("order_offer_expired", handleOfferExpired);
        };
    }, [isAuthenticated, token, router]); // currentOffer left out specifically so we don't rebind socket listeners constantly

    // Handle app state changes (sync when waking up from background)
    useEffect(() => {
        const subscription = AppState.addEventListener("change", (nextAppState) => {
            if (appState.current.match(/inactive|background/) && nextAppState === "active") {
                if (isAuthenticated && token) {
                    syncOffers();
                }
            }
            appState.current = nextAppState;
        });

        return () => subscription?.remove();
    }, [isAuthenticated, token, syncOffers]);

    const clearCurrentOffer = useCallback(() => {
        setCurrentOffer(null);
    }, []);

    return (
        <OrderNotificationContext.Provider
            value={{
                currentOffer,
                clearCurrentOffer,
                syncOffers
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
