import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { OrdersProvider } from "@/contexts/OrdersContext";
import { OrderNotificationProvider } from "@/contexts/OrderNotificationContext";
import { AllocationNotificationProvider } from "@/contexts/AllocationNotificationContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SensorProvider } from "@/contexts/SensorContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "login";

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to the login page if the user is not authenticated
      router.replace("/login");
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect to the home page if the user is already authenticated
      router.replace("/(tabs)");
    }
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) {
    return null; // Or a splash screen / loading spinner
  }

  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="zone-change"
        options={{ headerShown: false, presentation: "modal" }}
      />
      <Stack.Screen name="zone-navigation" options={{ headerShown: false }} />
      <Stack.Screen
        name="order-notification"
        options={{ headerShown: false, presentation: "modal" }}
      />
      <Stack.Screen name="order-pickup" options={{ headerShown: false }} />
      <Stack.Screen name="order-delivery" options={{ headerShown: false }} />
      <Stack.Screen
        name="fatigue-detection"
        options={{ headerShown: false, presentation: "modal" }}
      />
      <Stack.Screen
        name="fall-detection"
        options={{ headerShown: false, presentation: "modal" }}
      />
      <Stack.Screen
        name="fall-assistance"
        options={{ headerShown: false, presentation: "modal" }}
      />
      <Stack.Screen
        name="take-break"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <OrdersProvider>
            <OrderNotificationProvider>
              <AllocationNotificationProvider>
                <SensorProvider>
                  <GestureHandlerRootView>
                    <RootLayoutNav />
                  </GestureHandlerRootView>
                </SensorProvider>
              </AllocationNotificationProvider>
            </OrderNotificationProvider>
          </OrdersProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
