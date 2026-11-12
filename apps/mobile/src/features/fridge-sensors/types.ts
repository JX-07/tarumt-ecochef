export type FreshnessStatus = "excellent" | "good" | "acceptable" | "spoiled" | "unknown";
export type SensorConnectionStatus = "online" | "offline" | "waiting";

export type FridgeSensorReading = {
  id: number;
  captured_at: string;
  mq3: number;
  mq135: number;
  mq136: number;
  mq137: number;
  temperature_c: number;
  humidity_percent: number;
  freshness_status: FreshnessStatus;
  confidence?: number;
  model_version?: string;
};

export type FridgeSensorSummary = {
  id: string;
  device_code: string;
  sensor_name: string;
  fridge_name: string;
  connection_status: SensorConnectionStatus;
  created_at: string;
  last_seen_at?: string;
  latest_reading?: FridgeSensorReading;
};

export type FridgeSensorList = { items: FridgeSensorSummary[] };
export type FridgeSensorDetail = FridgeSensorSummary & { readings: FridgeSensorReading[] };
export type PairFridgeSensorResponse = FridgeSensorSummary & { ingest_key: string };
export type ClaimFridgeSensorResponse = PairFridgeSensorResponse & { ble_name: string };

export type SensorSetupQr = {
  version: 1;
  deviceCode: string;
  claimSecret: string;
  bleName: string;
};
