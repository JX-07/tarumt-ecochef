import type { FridgeSensorDetail } from "./types";

export type SensorHealthCheck = {
  key: "connection" | "gas" | "temperature" | "humidity";
  label: string;
  detail: string;
  passed: boolean;
};

export function sensorHealthChecks(sensor?: FridgeSensorDetail): SensorHealthCheck[] {
  const reading = sensor?.latest_reading;
  const gasValues = reading ? [reading.mq3, reading.mq135, reading.mq136, reading.mq137] : [];
  const gasChannelsValid =
    gasValues.length === 4 && gasValues.every((value) => Number.isFinite(value) && value > 0);
  return [
    {
      key: "connection",
      label: "Gateway connection",
      detail:
        sensor?.connection_status === "online"
          ? "A recent reading reached EcoChef."
          : "Waiting for the ESP32 to send a reading.",
      passed: sensor?.connection_status === "online",
    },
    {
      key: "gas",
      label: "MQ-3, MQ-135, MQ-136 and MQ-137",
      detail: gasChannelsValid
        ? "All four gas channels are reporting non-zero raw values."
        : "A channel is missing or reporting zero. Check its power and signal wiring.",
      passed: gasChannelsValid,
    },
    {
      key: "temperature",
      label: "Temperature sensor",
      detail:
        reading && Number.isFinite(reading.temperature_c)
          ? `${reading.temperature_c.toFixed(1)}°C received.`
          : "Waiting for a temperature value.",
      passed: Boolean(reading && Number.isFinite(reading.temperature_c)),
    },
    {
      key: "humidity",
      label: "Humidity sensor",
      detail:
        reading && Number.isFinite(reading.humidity_percent)
          ? `${Math.round(reading.humidity_percent)}% RH received.`
          : "Waiting for a humidity value.",
      passed: Boolean(reading && Number.isFinite(reading.humidity_percent)),
    },
  ];
}

export const sensorSetIsHealthy = (sensor?: FridgeSensorDetail) =>
  sensorHealthChecks(sensor).every((check) => check.passed);
