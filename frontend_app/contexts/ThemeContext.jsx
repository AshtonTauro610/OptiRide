import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const lightTheme = {
  colors: {
    primary: "#1e3a5f",
    secondary: "#2d4a6f",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    background: "#f5f7fa",
    card: "#ffffff",
    text: "#1f2937",
    textSecondary: "#6b7280",
    border: "#e5e7eb",
    accent: "#3b82f6",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  borderRadius: {
    sm: 8,
    md: 12,
    lg: 16,
    full: 9999,
  },
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
};

const darkTheme = {
  ...lightTheme,
  colors: {
    ...lightTheme.colors,
    primary: "#2d4a6f",
    secondary: "#1e3a5f",
    background: "#0f1419",
    card: "#1a1f2e",
    text: "#f9fafb",
    textSecondary: "#9ca3af",
    border: "#374151",
  },
};

export const [ThemeProvider, useTheme] = createContextHook(() => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const stored = await AsyncStorage.getItem("darkMode");
      if (stored !== null) {
        setIsDarkMode(JSON.parse(stored));
      }
    } catch (error) {
      console.error("Failed to load theme:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleDarkMode = async () => {
    const newValue = !isDarkMode;
    setIsDarkMode(newValue);
    try {
      await AsyncStorage.setItem("darkMode", JSON.stringify(newValue));
    } catch (error) {
      console.error("Failed to save theme:", error);
    }
  };

  const theme = isDarkMode ? darkTheme : lightTheme;

  return {
    theme,
    isDarkMode,
    toggleDarkMode,
    isLoading,
  };
});
