import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase";
import { fetchCurrentUser } from "@/services/auth";

const STORAGE_KEY = "authToken";

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    restoreSession();
  }, []);

  const restoreSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const storedToken = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedToken) {
        setToken(storedToken);
        const profile = await fetchCurrentUser(storedToken);
        setUser(profile);
      }
    } catch (err) {
      console.error("Failed to restore auth session", err);
      setError("Session expired. Please sign in again.");
      setToken(null);
      setUser(null);
      await AsyncStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

      await AsyncStorage.setItem(STORAGE_KEY, idToken);
      setToken(idToken);

      const profile = await fetchCurrentUser(idToken);
      setUser(profile);

      return profile;
    } catch (err) {
      const friendlyMessage = getErrorMessage(err);
      setError(friendlyMessage);
      // Create a new error with the friendly message
      const userError = new Error(friendlyMessage);
      userError.code = err.code;
      throw userError;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const auth = getFirebaseAuth();
      if (auth) {
        await signOut(auth);
      }
    } catch (err) {
      console.warn("Firebase signOut warning", err);
    } finally {
      await AsyncStorage.removeItem(STORAGE_KEY);
      setToken(null);
      setUser(null);
    }
  }, []);

  return {
    token,
    user,
    isAuthenticated: Boolean(token),
    isLoading,
    error,
    login,
    logout,
    refresh: restoreSession,
  };
});
