import { API_BASE_URL } from "./config";
import { DeviceEventEmitter } from "react-native";

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch(path, options = {}) {
  const { method = "GET", token, body, headers = {} } = options;
  const url = `${API_BASE_URL}${path}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorDetails;
      try {
        const text = await response.text();
        try {
          errorDetails = JSON.parse(text);
        } catch (_) {
          errorDetails = text;
        }
      } catch (_) {
        errorDetails = "Failed to parse error response";
      }

      if (response.status === 401) {
        DeviceEventEmitter.emit('auth_error_401');
      }

      throw new ApiError(`Request failed with status ${response.status}`, response.status, errorDetails);
    }

    if (response.status === 204) {
      return undefined;
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new ApiError("Request timed out after 15 seconds", 408);
    }
    throw error;
  }
}
