import React, { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Bell, Search, User, X, Check } from "lucide-react-native";
import { useOrders } from "@/contexts/OrdersContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { acceptOrder, rejectOrder } from "@/services/orders";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function OrdersScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { token } = useAuth();
  const {
    orders,
    isLoadingOrders,
    isRefetchingOrders,
    ordersError,
    refetchOrders,
    confirmPickup,
    completeDelivery,
  } = useOrders();

  const [activeTab, setActiveTab] = useState("assigned");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [acceptingOrderId, setAcceptingOrderId] = useState(null);
  const [rejectingOrderId, setRejectingOrderId] = useState(null);

  const textColor = theme.colors.text;
  const subTextColor = theme.colors.textSecondary;
  const cardBg = theme.colors.card;
  const borderColor = theme.colors.border;

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders
      .filter((o) => o.status === activeTab)
      .filter((o) =>
        q
          ? [o.orderNumber, o.restaurant, o.location, o.details?.customerName]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
          : true,
      );
  }, [orders, activeTab, searchQuery]);

  const handleMoreInfo = (order) => {
    setSelectedOrder(order);
    setModalVisible(true);
  };

  const handleAction = async (order) => {
    try {
      if (order.actionType === "pickup" && !order.pickupConfirmed) {
        await confirmPickup(order.id);
      } else {
        await completeDelivery(order.id);
      }
      await refetchOrders();
    } catch (e) {
      console.warn("Order action failed:", e?.details?.detail || e?.message);
      const message = e?.details?.detail || e?.message || "Something went wrong. Please try again.";
      Alert.alert(
        order.actionType === "pickup" ? "Cannot Confirm Pickup" : "Cannot Complete Delivery",
        message
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerWrapper}>
        <SafeAreaView edges={["top"]} style={styles.safeArea}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>My Orders</Text>
            <View style={styles.headerIcons}>
              <TouchableOpacity style={styles.iconButton} onPress={() => router.push("/(tabs)/alerts")}>
                <Bell color="#FFFFFF" size={20} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconButton} onPress={() => router.push("/(tabs)/settings")}>
                <User color="#FFFFFF" size={20} />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "assigned" && styles.tabActive]}
          onPress={() => setActiveTab("assigned")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "assigned" && styles.tabTextActive,
              { color: activeTab === "assigned" ? "#FFFFFF" : subTextColor },
            ]}
          >
            Assigned
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "pending" && styles.tabActive]}
          onPress={() => setActiveTab("pending")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "pending" && styles.tabTextActive,
              { color: activeTab === "pending" ? "#FFFFFF" : subTextColor },
            ]}
          >
            Pending
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "completed" && styles.tabActive]}
          onPress={() => setActiveTab("completed")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "completed" && styles.tabTextActive,
              { color: activeTab === "completed" ? "#FFFFFF" : subTextColor },
            ]}
          >
            Completed
          </Text>
        </TouchableOpacity>
      </View>

      {ordersError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>Unable to load orders. Pull to refresh.</Text>
        </View>
      )}

      <ScrollView
        style={styles.ordersList}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetchingOrders || false} onRefresh={refetchOrders} />
        }
      >
        {isLoadingOrders && filteredOrders.length === 0 ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.loadingText, { color: subTextColor }]}>Fetching your orders</Text>
          </View>
        ) : (
          filteredOrders.map((order) => (
            <View key={order.id} style={[styles.orderCard, { backgroundColor: cardBg }]}>
              <View style={styles.orderHeader}>
                <Image
                  source={{
                    uri: order.restaurantLogo || "https://dummyimage.com/100x100/0b0f3d/ffffff&text=OR",
                  }}
                  style={styles.restaurantLogo}
                />
                <View style={styles.orderInfo}>
                  <Text style={[styles.orderNumber, { color: textColor }]}>{order.orderNumber}</Text>
                  <Text style={[styles.restaurantName, { color: subTextColor }]}>{order.restaurant}</Text>
                  <Text style={[styles.location, { color: subTextColor }]}>Location: {order.location}</Text>
                  <Text style={[styles.estimatedTime, { color: subTextColor }]}>
                    {order.status === "completed"
                      ? "Delivered To:"
                      : "Est. " + (order.actionType === "pickup" ? "Pickup" : "Delivery") + ":"}{" "}
                    {order.details.customerName}
                  </Text>
                  {order.status === "completed" && order.details.deliveryTime && (
                    <Text style={[styles.estimatedTime, { color: subTextColor }]}>Delivery Time: {order.details.deliveryTime}</Text>
                  )}
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    order.status === "assigned" && order.statusBadge === "Awaiting Pickup" && styles.statusBadgeAwaitingPickup,
                    order.status === "assigned" && order.statusBadge === "In Transit" && styles.statusBadgeInTransit,
                    order.status === "pending" && styles.statusBadgePending,
                    order.status === "completed" && styles.statusBadgeCompleted,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      order.status === "assigned" && order.statusBadge === "Awaiting Pickup" && styles.statusBadgeTextAwaitingPickup,
                      order.status === "assigned" && order.statusBadge === "In Transit" && styles.statusBadgeTextInTransit,
                      order.status === "pending" && styles.statusBadgeTextPending,
                      order.status === "completed" && styles.statusBadgeTextCompleted,
                    ]}
                  >
                    {order.statusBadge}
                  </Text>
                </View>
              </View>

              <View style={styles.orderActions}>
                <TouchableOpacity onPress={() => handleMoreInfo(order)}>
                  <Text style={styles.moreInfoLink}>More Info</Text>
                </TouchableOpacity>

                {order.status === "assigned" && (
                  <TouchableOpacity
                    style={styles.navigateButton}
                    onPress={() => {
                      // Navigate to the map tab which will show the active order route
                      router.push("/(tabs)/map");
                    }}
                  >
                    <Text style={styles.navigateButtonText}>Navigate</Text>
                  </TouchableOpacity>
                )}

                {order.status === "completed" ? (
                  <TouchableOpacity style={styles.reviewSummaryButton} onPress={() => handleMoreInfo(order)}>
                    <Text style={styles.reviewSummaryButtonText}>Review Summary</Text>
                  </TouchableOpacity>
                ) : order.status === "pending" ? (
                  <View style={styles.pendingActions}>
                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={async () => {
                        if (!token) return;
                        setAcceptingOrderId(order.id);
                        try {
                          await acceptOrder(token, order.id);
                          await refetchOrders();

                          const otherOngoingOrders = orders.filter(o =>
                            o.id !== order.id &&
                            (o.status === "assigned" || o.status === "picked_up")
                          );

                          if (otherOngoingOrders.length > 0) {
                            console.log("Found ongoing orders, skipping fatigue scan");
                            router.push("/(tabs)/map");
                          } else {
                            // Navigate to fatigue detection
                            router.push({
                              pathname: '/fatigue-detection',
                              params: { orderId: order.id }
                            });
                          }
                        } catch (e) {
                          console.error('Failed to accept order:', e);
                        }
                        setAcceptingOrderId(null);
                      }}
                      disabled={acceptingOrderId === order.id}
                    >
                      {acceptingOrderId === order.id ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.acceptButtonText}>Accept</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.declineButton}
                      onPress={async () => {
                        if (!token) return;
                        setRejectingOrderId(order.id);
                        try {
                          await rejectOrder(token, order.id);
                          await refetchOrders();
                        } catch (e) {
                          console.error('Failed to reject order:', e);
                        }
                        setRejectingOrderId(null);
                      }}
                      disabled={rejectingOrderId === order.id}
                    >
                      {rejectingOrderId === order.id ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.declineButtonText}>Decline</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[
                      order.actionType === "pickup" && !order.pickupConfirmed && styles.confirmPickupButton,
                      (order.actionType === "delivery" || order.pickupConfirmed) && styles.completeDeliveryButton,
                    ]}
                    onPress={() => handleAction(order)}
                  >
                    <Text style={styles.actionButtonText}>
                      {order.actionType === "pickup" && !order.pickupConfirmed ? "Confirm Pickup" : "Complete Delivery"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}

        {filteredOrders.length === 0 && !isLoadingOrders && (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyStateText, { color: subTextColor }]}>No {activeTab} orders found</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)}>
          <Pressable style={[styles.modalContent, { backgroundColor: cardBg }]} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.modalHeader, { borderBottomColor: borderColor }]}>
              <Text style={[styles.modalTitle, { color: textColor }]}>Order Details</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X color={subTextColor} size={24} />
              </TouchableOpacity>
            </View>

            {selectedOrder && (
              <ScrollView style={styles.modalBody}>
                <View style={styles.modalSection}>
                  <Text style={[styles.modalLabel, { color: subTextColor }]}>Order Number</Text>
                  <Text style={[styles.modalValue, { color: textColor }]}>{selectedOrder.orderNumber}</Text>
                </View>
                <View style={styles.modalSection}>
                  <Text style={[styles.modalLabel, { color: subTextColor }]}>Restaurant</Text>
                  <Text style={[styles.modalValue, { color: textColor }]}>{selectedOrder.restaurant}</Text>
                </View>
                <View style={styles.modalSection}>
                  <Text style={[styles.modalLabel, { color: subTextColor }]}>Customer Name</Text>
                  <Text style={[styles.modalValue, { color: textColor }]}>{selectedOrder.details.customerName}</Text>
                </View>
                <View style={styles.modalSection}>
                  <Text style={[styles.modalLabel, { color: subTextColor }]}>Customer Phone</Text>
                  <Text style={[styles.modalValue, { color: textColor }]}>{selectedOrder.details.customerPhone}</Text>
                </View>
                <View style={styles.modalSection}>
                  <Text style={[styles.modalLabel, { color: subTextColor }]}>Items</Text>
                  {selectedOrder.details.items.map((item, index) => (
                    <Text key={index} style={[styles.modalItem, { color: textColor }]}> {item}</Text>
                  ))}
                </View>
                <View style={styles.modalSection}>
                  <Text style={[styles.modalLabel, { color: subTextColor }]}>Total Amount</Text>
                  <Text style={[styles.modalValueBold, { color: textColor }]}>{selectedOrder.details.totalAmount}</Text>
                </View>
                {selectedOrder.details.specialInstructions && (
                  <View style={styles.modalSection}>
                    <Text style={[styles.modalLabel, { color: subTextColor }]}>Special Instructions</Text>
                    <Text style={[styles.modalValue, { color: textColor }]}>{selectedOrder.details.specialInstructions}</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerWrapper: {
    backgroundColor: "#0b0f3d",
  },
  safeArea: {
    backgroundColor: "#0b0f3d",
  },
  header: {
    backgroundColor: "#0b0f3d",
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  headerIcons: {
    flexDirection: "row",
    gap: 12,
  },
  iconButton: {
    padding: 8,
  },
  tabsContainer: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 0,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: "#0b0f3d",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  ordersList: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  errorBanner: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FCA5A5",
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
  },
  errorText: {
    color: "#991B1B",
    fontWeight: "600",
    fontSize: 13,
  },
  loadingState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
  },
  orderCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  orderHeader: {
    flexDirection: "row",
    marginBottom: 12,
  },
  restaurantLogo: {
    width: 50,
    height: 50,
    borderRadius: 12,
    marginRight: 12,
  },
  orderInfo: {
    flex: 1,
  },
  orderNumber: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  restaurantName: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  location: {
    fontSize: 13,
    marginBottom: 2,
  },
  estimatedTime: {
    fontSize: 13,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  statusBadgeAwaitingPickup: {
    backgroundColor: "#FEF3C7",
  },
  statusBadgeInTransit: {
    backgroundColor: "#DBEAFE",
  },
  statusBadgePending: {
    backgroundColor: "#fca85f",
  },
  statusBadgeCompleted: {
    backgroundColor: "#D1FAE5",
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  statusBadgeTextAwaitingPickup: {
    color: "#F59E0B",
  },
  statusBadgeTextInTransit: {
    color: "#2563EB",
  },
  statusBadgeTextPending: {
    color: "#a9560e",
  },
  statusBadgeTextCompleted: {
    color: "#10B981",
  },
  orderActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    gap: 12,
  },
  moreInfoLink: {
    fontSize: 14,
    fontWeight: "600",
    color: "#3B82F6",
  },
  confirmPickupButton: {
    backgroundColor: "#16A34A",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  completeDeliveryButton: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 12,
  },
  pendingActions: {
    flexDirection: "row",
    gap: 12,
  },
  acceptButton: {
    backgroundColor: "#10B981",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    minWidth: 70,
    alignItems: "center",
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  declineButton: {
    backgroundColor: "#EF4444",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    minWidth: 70,
    alignItems: "center",
  },
  declineButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  refreshButton: {
    backgroundColor: "#547690",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  refreshButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  reviewSummaryButton: {
    backgroundColor: "#7C3AED",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  reviewSummaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  emptyStateText: {
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  modalBody: {
    padding: 20,
  },
  modalSection: {
    marginBottom: 16,
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  modalValue: {
    fontSize: 16,
  },
  modalValueBold: {
    fontSize: 18,
    fontWeight: "700",
  },
  modalItem: {
    fontSize: 15,
    marginBottom: 4,
  },
  navigateButton: {
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  navigateButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
