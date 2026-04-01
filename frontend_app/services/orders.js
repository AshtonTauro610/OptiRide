import { apiFetch } from "@/lib/http";

export async function fetchDriverOrders(token) {
  // Use all-orders endpoint to include completed orders for the completed tab
  return apiFetch("/orders/driver/all-orders?include_completed=true&days=7", { token });
}

export async function fetchActiveDriverOrders(token) {
  // Only active (assigned, picked_up) orders
  return apiFetch("/orders/driver/orders", { token });
}

export async function fetchOfferedOrders(token) {
  return apiFetch("/orders/offered/me", { token });
}

export async function acceptOrder(token, orderId) {
  return apiFetch(`/orders/${orderId}/accept`, {
    method: "POST",
    token,
  });
}

export async function rejectOrder(token, orderId) {
  return apiFetch(`/orders/${orderId}/reject`, {
    method: "POST",
    token,
  });
}

export async function submitPickup(
  token,
  orderId,
  payload,
) {
  return apiFetch(`/orders/${orderId}/pickup`, {
    method: "POST",
    token,
    body: payload,
  });
}

export async function submitDelivery(
  token,
  orderId,
  payload,
) {
  return apiFetch(`/orders/${orderId}/deliver`, {
    method: "POST",
    token,
    body: payload,
  });
}

