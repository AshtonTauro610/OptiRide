import { ApiOrder, ApiOrderStatus } from "./backend";

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
  return {
    id: order.order_id,
    orderNumber: `#${order.order_id.slice(0, 6).toUpperCase()}`,
    restaurant: order.restaurant_name,
    restaurantLogo: undefined,
    location: order.pickup_address,
    estimatedTime: order.estimated_pickup_time || order.estimated_dropoff_time || undefined,
    status: mapping.status,
    statusBadge: mapping.statusBadge,
    actionType: mapping.actionType,
    pickupConfirmed: mapping.pickupConfirmed,
    details: {
      customerName: order.customer_name,
      customerPhone: order.customer_contact,
      items: [],
      totalAmount: order.price ? `AED ${order.price.toFixed(2)}` : undefined,
      deliveryTime: order.delivered_at ?? undefined,
    },
    pickupLatitude: order.pickup_latitude,
    pickupLongitude: order.pickup_longitude,
    dropoffLatitude: order.dropoff_latitude,
    dropoffLongitude: order.dropoff_longitude,
    raw: order,
  };
}
