import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState, useRef } from "react";
import { DeviceEventEmitter } from "react-native";
import { signInWithEmailAndPassword, signOut, onIdTokenChanged } from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase";
import { fetchCurrentUser } from "@/services/auth";
import { fetchDriverProfile } from "@/services/driver";
import { joinDriverRoom } from "@/services/socket";

const STORAGE_KEY = "authToken";
const STORAGE_KEY_EXPIRY = "authTokenExpiry";
const TOKEN_REFRESH_INTERVAL = 45 * 60 * 1000; // Refresh every 45 minutes (tokens expire at 60 min)
const SESSION_DURATION_DAYS = 15; // Session valid for 15 days

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshIntervalRef = useRef(null);
  const unsubscribeRef = useRef(null);

  // Refresh the Firebase ID token
  const refreshToken = useCallback(async () => {
    try {
      const auth = getFirebaseAuth();
      if (!auth?.currentUser) {
        console.log("No current user, cannot refresh token");
        return null;
      }

      // Force refresh the token
      const newToken = await auth.currentUser.getIdToken(true);
      await AsyncStorage.setItem(STORAGE_KEY, newToken);
      setToken(newToken);
      console.log("Token refreshed successfully");
      return newToken;
    } catch (err) {
      console.error("Failed to refresh token:", err);
      return null;
    }
  }, []);

  // Start periodic token refresh
  const startTokenRefresh = useCallback(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }

    refreshIntervalRef.current = setInterval(() => {
      console.log("Periodic token refresh triggered");
      refreshToken();
    }, TOKEN_REFRESH_INTERVAL);
  }, [refreshToken]);

  // Stop periodic token refresh
  const stopTokenRefresh = useCallback(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  }, []);

  // Check if session has expired (15 days)
  const isSessionExpired = useCallback(async () => {
    try {
      const expiryStr = await AsyncStorage.getItem(STORAGE_KEY_EXPIRY);
      if (!expiryStr) return true;

      const expiry = new Date(expiryStr);
      return new Date() > expiry;
    } catch {
      return true;
    }
  }, []);

  // Set session expiry
  const setSessionExpiry = useCallback(async () => {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + SESSION_DURATION_DAYS);
    await AsyncStorage.setItem(STORAGE_KEY_EXPIRY, expiry.toISOString());
  }, []);

  useEffect(() => {
    restoreSession();

    // Set up Firebase auth state listener for automatic token refresh
    const auth = getFirebaseAuth();
    if (auth) {
      unsubscribeRef.current = onIdTokenChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          try {
            const newToken = await firebaseUser.getIdToken();
            await AsyncStorage.setItem(STORAGE_KEY, newToken);
            setToken(newToken);
          } catch (err) {
            console.error("Error getting token from auth state change:", err);
          }
        }
      });
    }

    return () => {
      stopTokenRefresh();
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const restoreSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Check if session has expired (15 days)
      const expired = await isSessionExpired();
      if (expired) {
        console.log("Session expired after 15 days");
        await AsyncStorage.removeItem(STORAGE_KEY);
        await AsyncStorage.removeItem(STORAGE_KEY_EXPIRY);
        setIsLoading(false);
        return;
      }

      const storedToken = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedToken) {
        // Try to refresh the token first (in case it's expired)
        const auth = getFirebaseAuth();
        let validToken = storedToken;

        if (auth?.currentUser) {
          try {
            validToken = await auth.currentUser.getIdToken(true);
            await AsyncStorage.setItem(STORAGE_KEY, validToken);
          } catch (refreshErr) {
            console.log("Token refresh failed, trying stored token:", refreshErr);
          }
        }

        setToken(validToken);
        let profile = await fetchCurrentUser(validToken);

        // Validate that the user is a driver
        if (profile.user_type !== 'driver') {
          throw new Error('This app is for drivers only.');
        }

        try {
          const driverProfile = await fetchDriverProfile(validToken);
          profile = { ...profile, ...driverProfile };
        } catch (e) {
          console.warn("Could not fetch driver profile during restoreSession", e);
        }

        setUser(profile);
        startTokenRefresh();

        // Join socket room for real-time events
        if (profile.driver_id) joinDriverRoom(profile.driver_id);
      }
    } catch (err) {
      console.error("Failed to restore auth session", err);
      setError("Session expired. Please sign in again.");
      setToken(null);
      setUser(null);
      await AsyncStorage.removeItem(STORAGE_KEY);
      await AsyncStorage.removeItem(STORAGE_KEY_EXPIRY);
    } finally {
      setIsLoading(false);
    }
  }, [isSessionExpired, startTokenRefresh]);

  const login = useCallback(async (email, password) => {
    setError(null);

    // Helper function to get user-friendly error messages
    const getErrorMessage = (error) => {
      const errorCode = error.code || '';

      const errorMessages = {
        'auth/invalid-credential': 'Invalid email or password. Please try again.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/user-disabled': 'This account has been disabled. Please contact support.',
        'auth/user-not-found': 'No account found with this email address.',
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
        'auth/network-request-failed': 'Network error. Please check your internet connection.',
        'auth/email-already-in-use': 'This email is already registered.',
        'auth/weak-password': 'Password is too weak. Please use a stronger password.',
        'auth/operation-not-allowed': 'This sign-in method is not enabled.',
        'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'App configuration error. Please contact support.',
      };

      return errorMessages[errorCode] || 'Login failed. Please check your credentials and try again.';
    };

    try {
      const auth = getFirebaseAuth();

      if (!auth) {
        throw new Error("Unable to connect to authentication service. Please try again later.");
      }

      const credentials = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await credentials.user.getIdToken();

      // Fetch user profile BEFORE storing the token
      // This ensures we don't redirect if the API is unreachable or role is wrong
      let profile;
      try {
        profile = await fetchCurrentUser(idToken);
      } catch (apiError) {
        console.error("Failed to fetch user profile:", apiError);
        throw new Error('Unable to connect to server. Please check your internet connection.');
      }

      // Validate that the user is a driver - this app is for drivers only
      if (profile.user_type !== 'driver') {
        throw new Error('This app is for drivers only. Please use the appropriate app for your role.');
      }

      try {
        const driverProfile = await fetchDriverProfile(idToken);
        profile = { ...profile, ...driverProfile };
      } catch (e) {
        console.warn("Could not fetch driver profile during login", e);
      }

      // Only store token and set state AFTER validation passes
      await AsyncStorage.setItem(STORAGE_KEY, idToken);
      await setSessionExpiry(); // Set 15-day session expiry
      setToken(idToken);
      setUser(profile);
      startTokenRefresh();

      // Join socket room for real-time events
      if (profile.driver_id) joinDriverRoom(profile.driver_id);

      return profile;
    } catch (err) {
      const friendlyMessage = getErrorMessage(err);
      setError(friendlyMessage);
      // Create a new error with the friendly message
      const userError = new Error(friendlyMessage);
      userError.code = err.code;
      throw userError;
    }
  }, [setSessionExpiry, startTokenRefresh]);

  const logout = useCallback(async () => {
    stopTokenRefresh(); // Stop token refresh interval
    try {
      const auth = getFirebaseAuth();
      if (auth) {
        await signOut(auth);
      }
    } catch (err) {
      console.warn("Firebase signOut warning", err);
    } finally {
      await AsyncStorage.removeItem(STORAGE_KEY);
      await AsyncStorage.removeItem(STORAGE_KEY_EXPIRY);
      setToken(null);
      setUser(null);
    }
  }, [stopTokenRefresh]);

  useEffect(() => {
    const authListener = DeviceEventEmitter.addListener('auth_error_401', async () => {
      console.log("Interceptor caught 401 error. Forcing token refresh...");
      if (!getFirebaseAuth()?.currentUser) {
        logout();
        return;
      }
      const newToken = await refreshToken();
      if (!newToken) {
        console.log("Token refresh failed. Forcing logout.");
        logout();
      }
    });

    return () => {
      authListener.remove();
    };
  }, [refreshToken, logout]);

  return {
    token,
    user,
    isAuthenticated: Boolean(token),
    isLoading,
    error,
    login,
    logout,
    refresh: restoreSession,
    refreshToken, // Expose manual refresh if needed
  };
});
