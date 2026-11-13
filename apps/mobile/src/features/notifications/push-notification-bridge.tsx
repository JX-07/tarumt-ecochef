import { apiBaseUrl } from "../../lib/api-url";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type { NotificationResponse } from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useMemo } from "react";
import { Platform } from "react-native";

import { useAuth } from "../auth/auth-provider";
import { createMobileApi } from "../../lib/api";

const DEVICE_ID_KEY = "ecochef.push-device-id";
const Notifications: typeof import("expo-notifications") | null =
  Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
    ? null
    : require("expo-notifications");

Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function openResponse(response: NotificationResponse | null) {
  const data = response?.notification.request.content.data as { action_path?: unknown } | undefined;
  if (typeof data?.action_path === "string" && data.action_path.startsWith("/")) {
    router.push(data.action_path as never);
  }
}

async function deviceId() {
  const saved = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (saved) return saved;
  const created = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export function PushNotificationBridge() {
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);

  useEffect(() => {
    if (!Notifications) return;
    const subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    void Notifications.getLastNotificationResponseAsync()
      .then(openResponse)
      .catch(() => undefined);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!user || Platform.OS === "web" || !Notifications) return;
    let active = true;
    void (async () => {
      if (!active) return;
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("fridge-alerts", {
          name: "Fridge alerts",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 180, 250],
        });
      }
      const current = await Notifications.getPermissionsAsync();
      const permission =
        current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
      if (permission.status !== "granted") return;
      const projectId =
        process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
        Constants.easConfig?.projectId ??
        (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
      if (!projectId) return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      await api.registerPushToken({
        device_id: await deviceId(),
        expo_push_token: token,
        platform: Platform.OS as "android" | "ios",
      });
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, user]);

  return null;
}
