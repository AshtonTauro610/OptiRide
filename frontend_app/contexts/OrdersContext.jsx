import { useAuth } from "@/contexts/AuthContext";
import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchDriverOrders, submitDelivery, submitPickup } from "@/services/orders";
import { mapApiOrderToOrder } from "@/types/order";
import * as Location from 'expo-location';

const ORDER_QUERY_KEY = ["orders"];

export const [OrdersProvider, useOrders] = createContextHook(() => {
  const { token, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ORDER_QUERY_KEY,
    enabled: Boolean(token),
    queryFn: async () => {
      if (!token) return { orders: [], count: 0 };
      return fetchDriverOrders(token);
    },
  });

  const orders = useMemo(
    () => (data?.orders ?? []).map((order) => mapApiOrderToOrder(order)),
    [data?.orders],
  );

  const invalidateOrders = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ORDER_QUERY_KEY });
  }, [queryClient]);

  const confirmPickup = useCallback(
    async (orderId) => {
      if (!token) throw new Error("Not authenticated");
      // Get driver's actual GPS location for proximity verification
      let lat = 0, lng = 0;
      try {
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        lat = location.coords.latitude;
        lng = location.coords.longitude;
      } catch (e) {
        console.warn('Could not get GPS for pickup verification:', e);
      }
      await submitPickup(token, orderId, {
        pickup_latitude: lat,
        pickup_longitude: lng,
      });
      await invalidateOrders();
    },
    [invalidateOrders, token],
  );

  const completeDelivery = useCallback(
    async (orderId) => {
      if (!token) throw new Error("Not authenticated");
      // Get driver's actual GPS location for proximity verification
      let lat = 0, lng = 0;
      try {
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        lat = location.coords.latitude;
        lng = location.coords.longitude;
      } catch (e) {
        console.warn('Could not get GPS for delivery verification:', e);
      }
      await submitDelivery(token, orderId, {
        dropoff_latitude: lat,
        dropoff_longitude: lng,
      });
      await invalidateOrders();
    },
    [invalidateOrders, token],
  );

  return {
    orders,
    isLoadingOrders: isLoading,
    isRefetchingOrders: isRefetching,
    ordersError: error,
    refetchOrders: refetch,
    invalidateOrders,
    isAuthenticated,
    completeDelivery,
    confirmPickup,
  };
});
