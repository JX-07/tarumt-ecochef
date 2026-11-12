import { Platform } from "react-native";

// Expo only inlines public environment variables accessed with this exact syntax.
// Access through globalThis/process aliases silently loses the configured URL.
const configuredUrl = process.env.EXPO_PUBLIC_API_URL;
export const apiBaseUrl = (configuredUrl?.trim() ||
  (Platform.OS === "android" ? "http://10.0.2.2:8000/api/v1" : "http://localhost:8000/api/v1")
).replace(/\/$/, "");
