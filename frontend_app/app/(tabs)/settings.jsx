import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { fetchDriverProfile } from "@/services/driver";
import { useRouter } from "expo-router";
import {
  AlertCircle,
  ChevronRight,
  Clock,
  Database,
  FileText,
  Globe,
  MapPin,
  MessageCircle,
  Phone,
  Smartphone,
  Loader2,
} from "lucide-react-native";
import React, { useState, useEffect, useCallback } from "react";
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function SettingItem({
  icon: Icon,
  label,
  value,
  showArrow = false,
  showToggle = false,
  toggleValue = false,
  onToggle,
  onPress,
  isDark,
}) {
  return (
    <TouchableOpacity
      style={[
        styles.settingItem,
        { backgroundColor: isDark ? "#1F2937" : "#FFFFFF" },
      ]}
      onPress={onPress}
      disabled={!onPress && !showToggle}
      activeOpacity={onPress ? 0.6 : 1}
    >
      <View style={styles.settingLeft}>
        {Icon && <Icon color={isDark ? "#9CA3AF" : "#6B7280"} size={20} />}
        <Text
          style={[
            styles.settingLabel,
            { color: isDark ? "#F3F4F6" : "#1F2937" },
          ]}
        >
          {label}
        </Text>
      </View>
      <View style={styles.settingRight}>
        {value && (
          <Text
            style={[
              styles.settingValue,
              { color: isDark ? "#9CA3AF" : "#6B7280" },
            ]}
          >
            {value}
          </Text>
        )}
        {showToggle && (
          <Switch
            value={toggleValue}
            onValueChange={onToggle}
            trackColor={{ false: "#D1D5DB", true: "#10B981" }}
            thumbColor="#FFFFFF"
          />
        )}
        {showArrow && (
          <ChevronRight color={isDark ? "#6B7280" : "#9CA3AF"} size={20} />
        )}
      </View>
    </TouchableOpacity>
  );
}

import { useSensors } from "@/contexts/SensorContext";

export default function SettingsScreen() {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { token, logout } = useAuth();
  const { isOnline, toggleOnline } = useSensors();
  const router = useRouter();

  // Profile state - dynamic from backend
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Settings state - these are stored locally as no backend endpoint exists
  // TODO: Add backend endpoints for user preferences when available
  const [trafficAlerts, setTrafficAlerts] = useState(true);
  const [orderUpdates, setOrderUpdates] = useState(true);
  const [adminAnnouncements, setAdminAnnouncements] = useState(false);

  // TODO: Connect to backend authentication settings when implemented
  const [biometricLogin, setBiometricLogin] = useState(true);
  const [twoFactorAuth, setTwoFactorAuth] = useState(true);

  const bgColor = isDarkMode ? "#111827" : "#F3F4F6";
  const headerBg = isDarkMode ? "#0b0f3d" : "#0b0f3d";
  const cardBg = isDarkMode ? "#1F2937" : "#FFFFFF";
  const textColor = isDarkMode ? "#F3F4F6" : "#1F2937";
  const subTextColor = isDarkMode ? "#9CA3AF" : "#6B7280";
  const borderColor = isDarkMode ? "#374151" : "#E5E7EB";

  const loadProfile = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchDriverProfile(token);
      setProfile(data);
      setError(null);
    } catch (err) {
      console.error("Failed to load profile:", err);
      setError("Failed to load profile");
    }
  }, [token]);

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await loadProfile();
      setIsLoading(false);
    };
    init();
  }, [loadProfile]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadProfile();
    setIsRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          if (logout) await logout();
          router.replace("/login");
        },
      },
    ]);
  };

  // Format working hours from profile
  const formatWorkingHours = () => {
    if (!profile?.shift_start_time || !profile?.shift_end_time) {
      return "Not set";
    }
    return `${profile.shift_start_time}\n${profile.shift_end_time}`;
  };

  // Generate avatar URL
  const getAvatarUrl = () => {
    const name = profile?.name || "Driver";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=200&background=1E3A8A&color=fff`;
  };

  // Format driver ID
  const formatDriverId = () => {
    if (!profile?.driver_id) return "Loading...";
    return `Rider ID #${profile.driver_id.slice(0, 6).toUpperCase()}`;
  };

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={[styles.headerWrapper, { backgroundColor: headerBg }]}>
        <SafeAreaView edges={["top"]} style={{ backgroundColor: headerBg }}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Settings</Text>
          </View>
        </SafeAreaView>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={[styles.loadingText, { color: subTextColor }]}>
            Loading profile...
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
        >
          <View style={[styles.profileSection, { backgroundColor: cardBg }]}>
            <View style={styles.profileHeader}>
              <Image
                source={{ uri: getAvatarUrl() }}
                style={styles.profileImage}
              />
              <View style={styles.profileInfo}>
                <Text style={[styles.profileName, { color: textColor }]}>
                  {profile?.name || "Driver"}
                </Text>
                <Text style={[styles.profileId, { color: subTextColor }]}>
                  {formatDriverId()}
                </Text>
                <Text style={[styles.profilePhone, { color: subTextColor }]}>
                  {profile?.phone_number || profile?.email || "No contact info"}
                </Text>
              </View>
              <TouchableOpacity style={styles.editButton}>
                <Text style={styles.editButtonText}>Edit Profile</Text>
              </TouchableOpacity>
            </View>

            <View
              style={[styles.vehicleSection, { borderTopColor: borderColor }]}
            >
              <Text style={[styles.vehicleTitle, { color: textColor }]}>
                Vehicle Information
              </Text>
              <Text style={[styles.vehicleInfo, { color: subTextColor }]}>
                {profile?.vehicle_type || "Not specified"}
                {profile?.license_plate ? ` - ${profile.license_plate}` : ""}
              </Text>
            </View>

            {/* TODO: Implement change password functionality with backend */}
            <TouchableOpacity style={styles.changePasswordButton}>
              <Text style={styles.changePasswordText}>Change Password</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              Notifications
            </Text>
            {/* TODO: Connect notification preferences to backend when endpoints available */}
            <View style={[styles.sectionContent, { backgroundColor: cardBg }]}>
              <SettingItem
                label="Traffic Alerts"
                showToggle
                toggleValue={trafficAlerts}
                onToggle={setTrafficAlerts}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              <SettingItem
                label="Order Updates"
                showToggle
                toggleValue={orderUpdates}
                onToggle={setOrderUpdates}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              <SettingItem
                label="Administrative Announcements"
                showToggle
                toggleValue={adminAnnouncements}
                onToggle={setAdminAnnouncements}
                isDark={isDarkMode}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              Availability
            </Text>
            <View style={[styles.sectionContent, { backgroundColor: cardBg }]}>
              <SettingItem
                label="Offline Mode"
                showToggle
                toggleValue={!isOnline}
                onToggle={toggleOnline}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              <SettingItem
                icon={Clock}
                label="Working Hours"
                value={formatWorkingHours()}
                showArrow
                onPress={() => console.log("Working Hours")}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              <SettingItem
                icon={MapPin}
                label="Current Zone"
                value={profile?.current_zone || "Not assigned"}
                showArrow
                onPress={() => console.log("Set Areas")}
                isDark={isDarkMode}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              System Preferences
            </Text>
            <View style={[styles.sectionContent, { backgroundColor: cardBg }]}>
              <SettingItem
                label="Dark Mode"
                showToggle
                toggleValue={isDarkMode}
                onToggle={toggleDarkMode}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              {/* TODO: Implement language selection with backend */}
              <SettingItem
                icon={Globe}
                label="Language"
                value="English"
                showArrow
                onPress={() => console.log("Language")}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              {/* TODO: Implement data sync functionality */}
              <SettingItem
                icon={Database}
                label="Data Sync & Backup"
                showArrow
                onPress={() => console.log("Data Sync")}
                isDark={isDarkMode}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              Security & Access Control
            </Text>
            {/* TODO: Connect security settings to backend when implemented */}
            <View style={[styles.sectionContent, { backgroundColor: cardBg }]}>
              <SettingItem
                label="Biometric Login"
                showToggle
                toggleValue={biometricLogin}
                onToggle={setBiometricLogin}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              <SettingItem
                label="Two-Factor Authentication"
                showToggle
                toggleValue={twoFactorAuth}
                onToggle={setTwoFactorAuth}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              {/* TODO: Implement device management */}
              <SettingItem
                icon={Smartphone}
                label="Manage Connected Devices"
                showArrow
                onPress={() => console.log("Connected Devices")}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              {/* TODO: Implement emergency contacts management */}
              <SettingItem
                icon={Phone}
                label="Emergency Contacts"
                showArrow
                onPress={() => console.log("Emergency Contacts")}
                isDark={isDarkMode}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              Legal & Compliance
            </Text>
            {/* These are static links - no backend needed */}
            <View style={[styles.sectionContent, { backgroundColor: cardBg }]}>
              <SettingItem
                icon={FileText}
                label="Privacy Policy"
                showArrow
                onPress={() => console.log("Privacy Policy")}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              <SettingItem
                icon={FileText}
                label="Terms & Conditions"
                showArrow
                onPress={() => console.log("Terms")}
                isDark={isDarkMode}
              />
              <View style={[styles.divider, { backgroundColor: borderColor }]} />
              <SettingItem
                icon={AlertCircle}
                label="Report a security issue"
                showArrow
                onPress={() => console.log("Report Issue")}
                isDark={isDarkMode}
              />
            </View>
          </View>

          <View style={styles.section}>
            {/* TODO: Implement support contact functionality */}
            <View style={[styles.sectionContent, { backgroundColor: cardBg }]}>
              <SettingItem
                icon={MessageCircle}
                label="Contact Support"
                showArrow
                onPress={() => console.log("Contact Support")}
                isDark={isDarkMode}
              />
            </View>
          </View>

          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
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
  header: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  scrollView: {
    flex: 1,
  },
  profileSection: {
    padding: 16,
    marginBottom: 16,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  profileImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 12,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  profileId: {
    fontSize: 14,
    marginBottom: 2,
  },
  profilePhone: {
    fontSize: 14,
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#3B82F6",
    borderRadius: 8,
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  vehicleSection: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginBottom: 12,
  },
  vehicleTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 6,
  },
  vehicleInfo: {
    fontSize: 14,
  },
  changePasswordButton: {
    backgroundColor: "#000000",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  changePasswordText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  section: {
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  sectionContent: {
    borderRadius: 12,
    overflow: "hidden",
  },
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: "400",
  },
  settingRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  settingValue: {
    fontSize: 14,
  },
  divider: {
    height: 1,
    marginLeft: 16,
  },
  logoutButton: {
    backgroundColor: "#DC2626",
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  logoutText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
