import { ApiOrder, ApiOrderStatus } from "./backend";

// Driver earnings calculation constants
const DRIVER_BASE_FEE = 5.0; // Base fee in AED
const DRIVER_PER_KM_RATE = 3.0; // Per kilometer rate in AED

export function calculateDriverEarnings(order) {
  // If delivery_fee is set, use it; otherwise calculate from distance
  if (order.delivery_fee) {
    return order.delivery_fee;
  }

  const distance = order.estimated_distance_km || order.actual_distance_km || 0;
  return DRIVER_BASE_FEE + (distance * DRIVER_PER_KM_RATE);
}

export function mapApiStatusToUi(status) {
  switch (status) {
    case "pending":
      return { status: "pending", statusBadge: "Pending", pickupConfirmed: false, actionType: "pickup" };
    case "offered":
      return { status: "pending", statusBadge: "Awaiting Accept", pickupConfirmed: false, actionType: "pickup" };
    case "assigned":
      return { status: "assigned", statusBadge: "Awaiting Pickup", pickupConfirmed: false, actionType: "pickup" };
    case "picked_up":
      return { status: "assigned", statusBadge: "In Transit", pickupConfirmed: true, actionType: "delivery" };
    case "delivered":
      return { status: "completed", statusBadge: "Completed", pickupConfirmed: true, actionType: "delivery" };
    case "cancelled":
      return { status: "completed", statusBadge: "Cancelled", pickupConfirmed: false, actionType: "pickup" };
    default:
      return { status: "pending", statusBadge: "Unknown", pickupConfirmed: false, actionType: "pickup" };
  }
}

export function mapApiOrderToOrder(order) {
  const mapping = mapApiStatusToUi(order.status);
  const driverEarnings = calculateDriverEarnings(order);
  return {
    id: order.order_id,
    orderNumber: `#${order.order_id.slice(0, 6).toUpperCase()}`,
    restaurant: order.restaurant_name,
    restaurantLogo: undefined,
    location: order.pickup_address,
    estimatedTime: (() => {
      const timeStr = order.pickup_time || order.dropoff_time;
      if (!timeStr) return "TBD";

      try {
        // 1. Ensure the string is treated as UTC (Z suffix)
        const normalizedTime = timeStr.endsWith('Z') ? timeStr : `${timeStr}Z`;
        const date = new Date(normalizedTime);
        const now = new Date();

        // 2. Calculation (Now both are in the same reference frame)
        const diffMs = date.getTime() - now.getTime();
        const diffMin = Math.round(diffMs / 60000);

        // 3. Display Logic
        if (diffMin > 0 && diffMin < 60) {
          return `${diffMin} mins`;
        }
        
        // 4. toLocaleTimeString automatically converts to the user's system timezone
        return date.toLocaleTimeString([], { 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: false 
        });
      } catch (e) {
        console.error("Time calc error:", e);
        return "TBD";
      }
    })(),
    status: mapping.status,
    statusBadge: mapping.statusBadge,
    actionType: mapping.actionType,
    pickupConfirmed: mapping.pickupConfirmed,
    details: {
      customerName: order.customer_name,
      customerPhone: order.customer_contact,
      items: [],
      totalAmount: `AED ${driverEarnings.toFixed(2)}`,
      orderPrice: order.price ? `AED ${order.price.toFixed(2)}` : undefined,
      driverEarnings: driverEarnings,
      deliveryTime: order.delivered_at ?? undefined,
    },
    pickupLatitude: order.pickup_latitude,
    pickupLongitude: order.pickup_longitude,
    dropoffLatitude: order.dropoff_latitude,
    dropoffLongitude: order.dropoff_longitude,
    optimized_sequence: order.optimized_sequence,
    raw: order,
  };
}
