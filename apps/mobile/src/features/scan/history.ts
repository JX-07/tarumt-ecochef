import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ScanHistoryEntry } from "./types";

const STORAGE_KEY = "ecochef.scan-history.v1";
const HISTORY_LIMIT = 50;

export async function getScanHistory(): Promise<ScanHistoryEntry[]> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? (parsed as ScanHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function saveScanHistory(entry: ScanHistoryEntry) {
  const previous = await getScanHistory();
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([entry, ...previous].slice(0, HISTORY_LIMIT)),
  );
}
