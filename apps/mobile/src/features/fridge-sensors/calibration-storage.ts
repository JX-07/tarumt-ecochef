import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

import type { GasCalibration } from "./sensor-insights";

export type PendingGasCalibration = {
  sensorId: string;
  fridgeName: string;
  endsAt: number;
};

const BASELINE_PREFIX = "ecochef:gas-calibration:";
const PENDING_PREFIX = "ecochef:gas-calibration-pending:";

export const calibrationStorageKey = (sensorId: string) => `${BASELINE_PREFIX}${sensorId}`;
export const pendingCalibrationStorageKey = (sensorId: string) => `${PENDING_PREFIX}${sensorId}`;

export async function loadGasCalibration(sensorId: string) {
  const saved = await AsyncStorage.getItem(calibrationStorageKey(sensorId));
  if (!saved) return undefined;
  try {
    return JSON.parse(saved) as GasCalibration;
  } catch {
    await AsyncStorage.removeItem(calibrationStorageKey(sensorId));
    return undefined;
  }
}

export async function saveGasCalibration(sensorId: string, calibration: GasCalibration) {
  await AsyncStorage.setItem(calibrationStorageKey(sensorId), JSON.stringify(calibration));
}

export async function clearGasCalibration(sensorId: string) {
  await AsyncStorage.removeItem(calibrationStorageKey(sensorId));
}

export async function loadPendingGasCalibration(sensorId: string) {
  const saved = await AsyncStorage.getItem(pendingCalibrationStorageKey(sensorId));
  if (!saved) return undefined;
  try {
    return JSON.parse(saved) as PendingGasCalibration;
  } catch {
    await AsyncStorage.removeItem(pendingCalibrationStorageKey(sensorId));
    return undefined;
  }
}

export async function savePendingGasCalibration(pending: PendingGasCalibration) {
  await AsyncStorage.setItem(
    pendingCalibrationStorageKey(pending.sensorId),
    JSON.stringify(pending),
  );
}

export async function clearPendingGasCalibration(sensorId: string) {
  await AsyncStorage.removeItem(pendingCalibrationStorageKey(sensorId));
}

export async function scheduleCalibrationNotification(pending: PendingGasCalibration) {
  const Notifications: typeof import("expo-notifications") | null =
    Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
      ? null
      : require("expo-notifications");
  if (!Notifications) return;
  const permission = await Notifications.getPermissionsAsync();
  const granted =
    permission.status === "granted" ? permission : await Notifications.requestPermissionsAsync();
  if (granted.status !== "granted") return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("fridge-calibration", {
      name: "Fridge calibration",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Fridge calibration complete",
      body: `${pending.fridgeName} has collected enough clean-air readings. Open EcoChef to finish setting the baseline.`,
      data: { action_path: `/fridge-sensors/${pending.sensorId}` },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(pending.endsAt),
      channelId: Platform.OS === "android" ? "fridge-calibration" : undefined,
    },
  });
}
