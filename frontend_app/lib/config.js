import Constants from "expo-constants";

// Get raw values from either Expo's extra config or direct env access
const extra = Constants.expoConfig?.extra ?? {};

// Helper to get env variable - Expo handles EXPO_PUBLIC_ prefixed vars specially
const getEnvVar = (key, extraKey) => {
  // First check if it's in extra (from app.json/app.config.js)
  if (extra[extraKey] && !extra[extraKey].startsWith('${')) {
    return extra[extraKey];
  }
  // Then check process.env (Expo SDK 49+ exposes EXPO_PUBLIC_ vars)
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return null;
};

const rawApiBaseUrl =
  getEnvVar('EXPO_PUBLIC_API_BASE_URL', 'apiBaseUrl') ?? "http://localhost:8000";

export const API_BASE_URL = rawApiBaseUrl.replace(/\/$/, "");

// Firebase configuration - use hardcoded values if env vars don't work
// These are the same values from AdminDashboard's .env
export const FIREBASE_CONFIG = {
  apiKey: getEnvVar('EXPO_PUBLIC_FIREBASE_API_KEY', 'firebaseApiKey'),
  authDomain: getEnvVar('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'firebaseAuthDomain'),
  projectId: getEnvVar('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'firebaseProjectId'),
  storageBucket: getEnvVar('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', 'firebaseStorageBucket'),
  messagingSenderId: getEnvVar('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'firebaseMessagingSenderId'),
  appId: getEnvVar('EXPO_PUBLIC_FIREBASE_APP_ID', 'firebaseAppId'),
};

export const hasFirebaseConfig = Object.values(FIREBASE_CONFIG).every((value) => Boolean(value));
