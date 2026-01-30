import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { theme } from "@/constants/theme";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { zones } from "@/mocks/zones";
import { fetchDriverProfile, fetchDriverPerformanceStats } from "@/services/driver";
import { useRouter } from "expo-router";
import {
  Bell,
  ClockIcon,
  MapPinIcon,
  TrendingUpIcon,
  User,
} from "lucide-react-native";
import React, { useState, useEffect } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Only import react-native-maps on native platforms
let MapView, Polygon, PROVIDER_DEFAULT;
if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Polygon = Maps.Polygon;
  PROVIDER_DEFAULT = Maps.PROVIDER_DEFAULT;
}

import { useSensors } from "@/contexts/SensorContext";

export default function HomeScreen() {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const { token } = useAuth();
  const { isOnline, toggleOnline } = useSensors();

  // Dynamic data from API
  const [driverProfile, setDriverProfile] = useState(null);
  const [performanceStats, setPerformanceStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Default shift times (used when backend hasn't set values yet)
  const DEFAULT_SHIFT = {
    type: "Morning",
    start: "09:00",
    end: "17:00",
  };

  // Helper to format time from 24h ("09:00") to 12h ("9:00 AM")
  const formatTime = (time24) => {
    if (!time24) return null; // Return null to trigger fallback
    const [hours, minutes] = time24.split(":").map(Number);
    if (isNaN(hours) || isNaN(minutes)) return null;
    const period = hours >= 12 ? "PM" : "AM";
    const hours12 = hours % 12 || 12;
    return `${hours12}:${minutes.toString().padStart(2, "0")} ${period}`;
  };

  // Get shift times with fallbacks
  const shiftType = driverProfile?.shift_type || DEFAULT_SHIFT.type;
  const shiftStartTime = formatTime(driverProfile?.shift_start_time) || formatTime(DEFAULT_SHIFT.start);
  const shiftEndTime = formatTime(driverProfile?.shift_end_time) || formatTime(DEFAULT_SHIFT.end);

  // HARDCODED: Assigned zone - no backend endpoint for zone assignments
  const assignedZoneCode = "A3";

  useEffect(() => {
    loadData();
  }, [token]);

  const loadData = async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [profile, stats] = await Promise.all([
        fetchDriverProfile(token),
        fetchDriverPerformanceStats(token).catch(() => null), // Performance stats might fail
      ]);

      setDriverProfile(profile);
      setPerformanceStats(stats);
    } catch (err) {
      console.warn("Failed to load driver data:", err);
      setError("Failed to load data. Pull down to refresh.");
    } finally {
      setIsLoading(false);
    }
  };

  // Get zone data from hardcoded zones based on zone code from API
  const currentZoneCode = driverProfile?.current_zone || "A1";
  const currentZone = zones.find((z) => z.code === currentZoneCode);
  const assignedZone = zones.find((z) => z.code === assignedZoneCode);

  // Calculate deliveries progress
  const deliveriesCompleted = performanceStats?.today_orders || 0;
  const totalDeliveries = performanceStats?.total_orders || 20; // Fallback to 20
  const progressPercentage = totalDeliveries > 0
    ? Math.min((deliveriesCompleted / Math.max(totalDeliveries, deliveriesCompleted)) * 100, 100)
    : 0;

  const bgColor = isDarkMode ? "#111827" : "#F9FAFB";

  // Map driver status to display format
  const getStatusDisplay = (status) => {
    const statusMap = {
      available: { status: "online", label: "Status: Online" },
      offline: { status: "offline", label: "Status: Offline" },
      busy: { status: "busy", label: "Status: Busy" },
      on_break: { status: "break", label: "Status: On Break" },
    };
    return statusMap[status] || statusMap.offline;
  };

  const statusDisplay = getStatusDisplay(driverProfile?.status);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: bgColor }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.headerWrapper}>
        <SafeAreaView edges={["top"]} style={styles.safeArea}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>OptiRide</Text>
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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeText}>Welcome back,</Text>
          <Text style={styles.nameText}>{driverProfile?.name || "Driver"}</Text>
          <View style={styles.statusRow}>
            <StatusBadge
              status={statusDisplay.status}
              label={statusDisplay.label}
              style={styles.statusBadge}
            />
            <TouchableOpacity
              onPress={toggleOnline}
              style={[
                styles.miniActionButton,
                { backgroundColor: isOnline ? theme.colors.error : theme.colors.success }
              ]}
            >
              <Text style={styles.miniActionButtonText}>
                {isOnline ? "Go Offline" : "Go Online"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => router.push("/zone-change")}
          activeOpacity={0.9}
        >
          <Card style={styles.zoneCard}>
            <View style={styles.zoneHeader}>
              <MapPinIcon size={20} color={theme.colors.accent} />
              <Text style={styles.zoneTitle}>Current Zone</Text>
            </View>
            <View style={styles.zoneContent}>
              <View style={styles.zoneInfo}>
                <Text style={styles.zoneCode}>{currentZone?.code || currentZoneCode}</Text>
                <Text style={styles.zoneDescription}>
                  {currentZone?.description || "Loading zone..."} {/* HARDCODED: Zone description */}
                </Text>
                <StatusBadge
                  status={currentZone?.demand || "low"} // HARDCODED: Demand level
                  label={`${currentZone?.demand || "low"} demand`}
                />
              </View>
              <View style={styles.mapPreview}>
                {Platform.OS !== 'web' && MapView ? (
                  <MapView
                    provider={PROVIDER_DEFAULT}
                    style={styles.miniMap}
                    initialRegion={{
                      latitude: currentZone?.coordinates[0].latitude || 25.2048,
                      longitude: currentZone?.coordinates[0].longitude || 55.2708,
                      latitudeDelta: 0.02,
                      longitudeDelta: 0.02,
                    }}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                  >
                    {currentZone && (
                      <Polygon
                        coordinates={currentZone.coordinates}
                        fillColor={`${currentZone.color}40`}
                        strokeColor={currentZone.color}
                        strokeWidth={2}
                      />
                    )}
                  </MapView>
                ) : (
                  <View style={styles.webMapPlaceholder}>
                    <Text style={styles.webMapText}>🗺️</Text>
                  </View>
                )}
              </View>
            </View>
          </Card>
        </TouchableOpacity>

        {/* HARDCODED: Assigned zone - no backend endpoint for zone reassignment */}
        <Card style={styles.assignedCard}>
          <View style={styles.zoneHeader}>
            <TrendingUpIcon size={20} color={theme.colors.error} />
            <Text style={styles.zoneTitle}>Assigned Zone</Text>
          </View>
          <View style={styles.assignedContent}>
            <Text style={styles.assignedZoneCode}>{assignedZone?.code}</Text>
            <StatusBadge
              status={assignedZone?.demand || "high"}
              label={`${assignedZone?.demand} demand - Reassigned`}
            />
          </View>
          <Text style={styles.assignedNote}>
            Due to high demand, you have been reassigned to Zone{" "}
            {assignedZone?.code}
          </Text>
        </Card>

        <Card style={styles.shiftCard}>
          <View style={styles.zoneHeader}>
            <ClockIcon size={20} color={theme.colors.success} />
            <Text style={styles.zoneTitle}>Shift Timings</Text>
          </View>
          <View style={styles.shiftInfo}>
            <View style={styles.shiftRow}>
              <Text style={styles.shiftLabel}>Shift Type:</Text>
              <Text style={styles.shiftValue}>{shiftType}</Text>
            </View>
            <View style={styles.shiftRow}>
              <Text style={styles.shiftLabel}>Time:</Text>
              <Text style={styles.shiftValue}>
                {shiftStartTime} - {shiftEndTime}
              </Text>
            </View>
          </View>
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Deliveries Completed</Text>
              <Text style={styles.progressValue}>
                {deliveriesCompleted}/{Math.max(totalDeliveries, deliveriesCompleted)}
              </Text>
            </View>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progressPercentage}%` },
                ]}
              />
            </View>
          </View>
        </Card>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: theme.spacing.md,
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
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
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  welcomeSection: {
    marginBottom: theme.spacing.lg,
  },
  welcomeText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  nameText: {
    fontSize: theme.fontSize.xxl,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  statusBadge: {
    marginTop: 0,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: theme.spacing.sm,
  },
  miniActionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  miniActionButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
  zoneCard: {
    marginBottom: theme.spacing.md,
  },
  zoneHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.md,
  },
  zoneTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
    color: theme.colors.text,
    marginLeft: theme.spacing.sm,
  },
  zoneContent: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  zoneInfo: {
    flex: 1,
  },
  zoneCode: {
    fontSize: theme.fontSize.xxxl,
    fontWeight: "700",
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  zoneDescription: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  mapPreview: {
    width: 100,
    height: 100,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    marginLeft: theme.spacing.md,
  },
  miniMap: {
    width: "100%",
    height: "100%",
  },
  webMapPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: theme.colors.card,
    justifyContent: "center",
    alignItems: "center",
  },
  webMapText: {
    fontSize: 32,
  },
  assignedCard: {
    marginBottom: theme.spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.error,
  },
  assignedContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm,
  },
  assignedZoneCode: {
    fontSize: theme.fontSize.xxl,
    fontWeight: "700",
    color: theme.colors.error,
  },
  assignedNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
  shiftCard: {
    marginBottom: theme.spacing.md,
  },
  shiftInfo: {
    marginBottom: theme.spacing.md,
  },
  shiftRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm,
  },
  shiftLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
  },
  shiftValue: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.text,
  },
  progressSection: {
    marginTop: theme.spacing.md,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm,
  },
  progressLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.text,
  },
  progressValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.success,
  },
  progressBar: {
    height: 8,
    backgroundColor: "#e5e7eb",
    borderRadius: theme.borderRadius.full,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.colors.success,
    borderRadius: theme.borderRadius.full,
  },
  actionButton: {
    backgroundColor: theme.colors.accent,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
  },
  actionButtonText: {
    color: "#ffffff",
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
});
