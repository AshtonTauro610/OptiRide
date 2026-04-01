import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { theme } from "@/constants/theme";
import { useTheme } from "@/contexts/ThemeContext";
import { useSensors } from "@/contexts/SensorContext";
import { Coffee, Play, Square, ArrowLeft } from "lucide-react-native";

export default function TakeBreakScreen() {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const { isOnBreak, breakDuration, startBreak, endBreak } = useSensors();

  const bgColor = isDarkMode ? "#111827" : "#F9FAFB";
  const cardBg = isDarkMode ? "#1F2937" : "#FFFFFF";

  const handleStartBreak = async () => {
    const success = await startBreak();
    if (!success) {
      Alert.alert("Error", "Failed to start break. Please try again.");
    }
  };

  const handleEndBreak = async () => {
    const duration = await endBreak();
    if (duration !== false) {
      Alert.alert(
        "Break Ended",
        `You took a ${formatDuration(duration)} break. Stay safe!`,
        [{ text: "OK", onPress: () => router.back() }]
      );
    } else {
      Alert.alert("Error", "Failed to end break. Please try again.");
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            // Can navigate away even if on break - timer persists in context
            router.back();
          }}
        >
          <ArrowLeft size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
          Take a Break
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: cardBg }]}>
          <View style={styles.iconContainer}>
            <Coffee size={64} color={isOnBreak ? theme.colors.warning : theme.colors.primary} />
          </View>

          <Text style={[styles.title, { color: theme.colors.text }]}>
            {isOnBreak ? "You're on a break" : "Ready to take a break?"}
          </Text>

          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
            {isOnBreak
              ? "Take your time to rest and recharge. You can navigate to other pages - the timer will keep running."
              : "Taking regular breaks helps prevent fatigue and keeps you safe on the road."}
          </Text>

          {isOnBreak && (
            <View style={styles.timerContainer}>
              <Text style={styles.timerLabel}>Break Duration</Text>
              <Text style={styles.timer}>{formatDuration(breakDuration)}</Text>
            </View>
          )}

          {!isOnBreak ? (
            <TouchableOpacity style={styles.startButton} onPress={handleStartBreak}>
              <Play size={20} color="#FFFFFF" />
              <Text style={styles.buttonText}>Start Break</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.endButton} onPress={handleEndBreak}>
              <Square size={20} color="#FFFFFF" />
              <Text style={styles.buttonText}>End Break</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Tips */}
        <View style={[styles.tipsCard, { backgroundColor: cardBg }]}>
          <Text style={[styles.tipsTitle, { color: theme.colors.text }]}>
            Break Tips
          </Text>
          <Text style={[styles.tip, { color: theme.colors.textSecondary }]}>
            • Stretch your legs and walk around
          </Text>
          <Text style={[styles.tip, { color: theme.colors.textSecondary }]}>
            • Hydrate with water or a healthy drink
          </Text>
          <Text style={[styles.tip, { color: theme.colors.textSecondary }]}>
            • Rest your eyes from the screen
          </Text>
          <Text style={[styles.tip, { color: theme.colors.textSecondary }]}>
            • Take deep breaths to reduce stress
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
  },
  content: {
    flex: 1,
    padding: theme.spacing.md,
  },
  card: {
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.xl,
    alignItems: "center",
    marginBottom: theme.spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: theme.colors.warning + "20",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: "700",
    marginBottom: theme.spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    fontSize: theme.fontSize.base,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: theme.spacing.lg,
  },
  timerContainer: {
    alignItems: "center",
    marginBottom: theme.spacing.lg,
  },
  timerLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  timer: {
    fontSize: 48,
    fontWeight: "700",
    color: theme.colors.warning,
    fontVariant: ["tabular-nums"],
  },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.success,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.borderRadius.md,
    gap: 8,
    width: "100%",
  },
  endButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.error,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.borderRadius.md,
    gap: 8,
    width: "100%",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  tipsCard: {
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tipsTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
    marginBottom: theme.spacing.md,
  },
  tip: {
    fontSize: theme.fontSize.base,
    marginBottom: theme.spacing.sm,
    lineHeight: 22,
  },
});
