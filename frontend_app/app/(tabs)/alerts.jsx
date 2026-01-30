import { Card } from "@/components/Card";
import { theme } from "@/constants/theme";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { getAlerts, acknowledgeAlert } from "@/services/safety";
import { useRouter } from "expo-router";
import {
  AlertTriangleIcon,
  Bell,
  BellIcon,
  HeartPulseIcon,
  MapPinIcon,
  PackageIcon,
  User,
  Zap,
  Car,
  RefreshCw,
  Coffee,
  Clock,
  MapIcon,
  CheckCircle,
  XCircle,
  Edit3,
  Megaphone,
  Settings,
  Navigation,
} from "lucide-react-native";
import React, { useState, useEffect, useCallback } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function AlertsScreen() {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const { token } = useAuth();

  const [alerts, setAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const bgColor = isDarkMode ? "#111827" : "#F9FAFB";

  const fetchAlerts = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getAlerts(token);
      setAlerts(data || []);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch alerts:", err);
      setError("Failed to load alerts");
    }
  }, [token]);

  useEffect(() => {
    const loadAlerts = async () => {
      setIsLoading(true);
      await fetchAlerts();
      setIsLoading(false);
    };
    loadAlerts();
  }, [fetchAlerts]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchAlerts();
    setIsRefreshing(false);
  };

  const handleAcknowledge = async (alertId) => {
    if (!token) return;
    try {
      await acknowledgeAlert(token, alertId, true);
      // Update local state
      setAlerts((prev) =>
        prev.map((a) =>
          a.alert_id === alertId ? { ...a, acknowledged: true } : a
        )
      );
    } catch (err) {
      console.error("Failed to acknowledge alert:", err);
    }
  };

  const getAlertIcon = (type) => {
    const iconProps = { size: 24, color: "#ffffff" };
    switch (type) {
      // Safety alerts
      case "fatigue":
      case "drowsiness":
        return <HeartPulseIcon {...iconProps} />;
      case "harsh_braking":
      case "harsh_acceleration":
      case "unusual_movement":
        return <Car {...iconProps} />;
      case "speeding":
        return <Zap {...iconProps} />;
      case "accident":
      case "crash":
      case "impact":
        return <AlertTriangleIcon {...iconProps} />;
      case "device":
        return <Settings {...iconProps} />;

      // Zone alerts
      case "zone_change":
      case "zone_assigned":
        return <MapPinIcon {...iconProps} />;
      case "zone_boundary":
        return <Navigation {...iconProps} />;

      // Order alerts
      case "order_assigned":
        return <PackageIcon {...iconProps} />;
      case "order_cancelled":
        return <XCircle {...iconProps} />;
      case "order_updated":
        return <Edit3 {...iconProps} />;
      case "order_completed":
        return <CheckCircle {...iconProps} />;

      // Break/shift alerts
      case "break_reminder":
      case "rest_required":
        return <Coffee {...iconProps} />;
      case "shift_start":
      case "shift_end":
        return <Clock {...iconProps} />;

      // System alerts
      case "system":
        return <Settings {...iconProps} />;
      case "admin_announcement":
        return <Megaphone {...iconProps} />;

      default:
        return <BellIcon {...iconProps} />;
    }
  };

  const getAlertColor = (severity) => {
    switch (severity) {
      case "critical":
        return theme.colors.error;
      case "high":
        return "#F97316"; // orange
      case "medium":
        return theme.colors.warning;
      case "low":
        return theme.colors.success;
      default:
        return theme.colors.accent;
    }
  };

  const getAlertTitle = (type) => {
    const titles = {
      // Safety alerts
      fatigue: "Fatigue Detected",
      drowsiness: "Drowsiness Alert",
      harsh_braking: "Harsh Braking",
      harsh_acceleration: "Harsh Acceleration",
      unusual_movement: "Unusual Movement",
      speeding: "Speed Alert",
      accident: "Accident Detected",
      device: "Device Alert",

      // Zone alerts
      zone_change: "Zone Changed",
      zone_assigned: "New Zone Assigned",
      zone_boundary: "Zone Boundary Alert",

      // Order alerts
      order_assigned: "New Order Assigned",
      order_cancelled: "Order Cancelled",
      order_updated: "Order Updated",
      order_completed: "Order Completed",

      // Break/shift alerts
      break_reminder: "Break Reminder",
      shift_start: "Shift Started",
      shift_end: "Shift Ended",
      rest_required: "Rest Required",

      // System alerts
      system: "System Alert",
      admin_announcement: "Admin Announcement",
    };
    return titles[type] || type?.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) || "Alert";
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.headerWrapper}>
        <SafeAreaView edges={["top"]} style={styles.safeArea}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Alerts</Text>
            <View style={styles.headerIcons}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => router.push("/alerts")}
              >
                <Bell color="#FFFFFF" size={24} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => router.push("/settings")}
              >
                <User color="#FFFFFF" size={24} />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading alerts...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.contentContainer}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
        >
          {alerts.length === 0 ? (
            <View style={styles.emptyContainer}>
              <BellIcon size={48} color={theme.colors.textSecondary} />
              <Text style={styles.emptyText}>No alerts yet</Text>
              <Text style={styles.emptySubtext}>
                Safety alerts will appear here when detected
              </Text>
            </View>
          ) : (
            alerts.map((alert) => (
              <TouchableOpacity
                key={alert.alert_id}
                onPress={() => !alert.acknowledged && handleAcknowledge(alert.alert_id)}
                activeOpacity={alert.acknowledged ? 1 : 0.7}
              >
                <Card
                  style={
                    !alert.acknowledged
                      ? { ...styles.alertCard, ...styles.unreadCard }
                      : styles.alertCard
                  }
                >
                  <View style={styles.alertContent}>
                    <View
                      style={[
                        styles.iconContainer,
                        { backgroundColor: getAlertColor(alert.severity) },
                      ]}
                    >
                      {getAlertIcon(alert.alert_type)}
                    </View>
                    <View style={styles.alertText}>
                      <View style={styles.alertHeader}>
                        <Text style={styles.alertTitle}>
                          {getAlertTitle(alert.alert_type)}
                        </Text>
                        <View
                          style={[
                            styles.severityBadge,
                            { backgroundColor: getAlertColor(alert.severity) + "20" },
                          ]}
                        >
                          <Text
                            style={[
                              styles.severityText,
                              { color: getAlertColor(alert.severity) },
                            ]}
                          >
                            {alert.severity}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.alertTimestamp}>
                        {formatTimestamp(alert.timestamp)}
                      </Text>
                      {!alert.acknowledged && (
                        <Text style={styles.tapToAcknowledge}>
                          Tap to acknowledge
                        </Text>
                      )}
                    </View>
                  </View>
                  {!alert.acknowledged && <View style={styles.unreadDot} />}
                </Card>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: theme.spacing.md,
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.base,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing.lg,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.fontSize.base,
    marginBottom: theme.spacing.md,
  },
  retryButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
  },
  retryButtonText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
    color: theme.colors.text,
    marginTop: theme.spacing.md,
  },
  emptySubtext: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  alertCard: {
    marginBottom: theme.spacing.md,
    position: "relative",
  },
  unreadCard: {
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.accent,
  },
  alertContent: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing.md,
  },
  alertText: {
    flex: 1,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.xs,
  },
  alertTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.text,
    flex: 1,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
    marginLeft: theme.spacing.sm,
  },
  severityText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  alertTimestamp: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
  },
  tapToAcknowledge: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.accent,
    marginTop: theme.spacing.xs,
    fontStyle: "italic",
  },
  unreadDot: {
    position: "absolute",
    top: theme.spacing.md,
    right: theme.spacing.md,
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
});
