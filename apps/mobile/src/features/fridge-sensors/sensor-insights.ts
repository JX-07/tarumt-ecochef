import { colors } from "@ecochef/design-tokens";
import type { FreshnessStatus, FridgeSensorReading } from "./types";

export const freshnessAppearance: Record<
  FreshnessStatus,
  { label: string; color: string; tint: string; explanation: string }
> = {
  excellent: {
    label: "Fresh pattern",
    color: colors.success,
    tint: colors.successSoft,
    explanation: "The recent pattern is closest to the model’s freshest training examples.",
  },
  good: {
    label: "Stable",
    color: colors.primaryStrong,
    tint: colors.primarySoft,
    explanation: "No strong spoilage-like change is present in the latest model result.",
  },
  acceptable: {
    label: "Check soon",
    color: colors.warningStrong,
    tint: colors.warningSoft,
    explanation: "The odour pattern is changing. Check stored food and keep monitoring.",
  },
  spoiled: {
    label: "Inspect food",
    color: colors.danger,
    tint: colors.dangerSoft,
    explanation:
      "Repeated readings resemble the model’s spoilage examples. Inspect food and follow normal food-safety guidance.",
  },
  unknown: {
    label: "Monitoring",
    color: colors.primaryStrong,
    tint: colors.primarySoft,
    explanation:
      "Temperature, air moisture and gas readings are live. Watch how they change over time.",
  },
};

export const metricDefinitions = [
  {
    key: "mq3",
    name: "MQ-3",
    short: "Fruit and fermentation",
    description: "May rise near overripe fruit, fermented food or some cleaning products.",
  },
  {
    key: "mq135",
    name: "MQ-135",
    short: "General air changes",
    description: "Notices a mix of food smells and other changes in the fridge air.",
  },
  {
    key: "mq136",
    name: "MQ-136",
    short: "Strong food smells",
    description: "May rise as some meat, fish or eggs start to break down.",
  },
  {
    key: "mq137",
    name: "MQ-137",
    short: "Protein food changes",
    description: "May rise as protein foods age. Cleaning products can affect it too.",
  },
] as const;

const gasChannels = [
  { key: "mq3", label: "MQ-3" },
  { key: "mq135", label: "MQ-135" },
  { key: "mq136", label: "MQ-136" },
  { key: "mq137", label: "MQ-137" },
] as const;

export type GasChannelKey = (typeof gasChannels)[number]["key"];

export type GasChannelReference = {
  baseline: number;
  current: number;
  riseAt: number;
};

export type GasCalibration = {
  capturedAt: string;
  channels: Partial<Record<GasChannelKey, { baseline: number; variation: number }>>;
};

export type GasTrendInsight = {
  kind: "collecting" | "steady" | "single_change" | "multiple_changes";
  channels: string[];
};

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validGasValue(value: number) {
  return Number.isFinite(value) && value > 5 && value < 4090;
}

export function createGasCalibration(readings: FridgeSensorReading[]): GasCalibration | undefined {
  const ordered = readings
    .filter((item) => Number.isFinite(Date.parse(item.captured_at)))
    .sort((left, right) => Date.parse(left.captured_at) - Date.parse(right.captured_at));
  const recent = ordered.slice(-6);
  if (recent.length < 6) return undefined;

  const channels: GasCalibration["channels"] = {};
  for (const channel of gasChannels) {
    const values = recent.map((item) => item[channel.key]).filter(validGasValue);
    if (values.length < 5) continue;
    const baseline = median(values);
    channels[channel.key] = {
      baseline,
      variation: median(values.map((value) => Math.abs(value - baseline))),
    };
  }
  if (Object.keys(channels).length < 2) return undefined;
  return { capturedAt: recent.at(-1)!.captured_at, channels };
}

export function gasChannelReference(
  readings: FridgeSensorReading[],
  channel: GasChannelKey,
  calibration?: GasCalibration,
): GasChannelReference | undefined {
  const ordered = readings
    .filter((item) => Number.isFinite(Date.parse(item.captured_at)))
    .sort((left, right) => Date.parse(left.captured_at) - Date.parse(right.captured_at));
  const latest = ordered.at(-1);
  if (!latest) return undefined;
  const now = Date.parse(latest.captured_at);
  const valid = (item: FridgeSensorReading) => validGasValue(item[channel]);
  if (calibration) {
    const saved = calibration.channels[channel];
    if (!saved) return undefined;
    const after = ordered
      .filter(
        (item) => Date.parse(item.captured_at) > Date.parse(calibration.capturedAt) && valid(item),
      )
      .slice(-3)
      .map((item) => item[channel]);
    if (after.length < 3) return undefined;
    return {
      baseline: saved.baseline,
      current: median(after),
      riseAt: saved.baseline + Math.max(40, saved.baseline * 0.25, saved.variation * 4),
    };
  }
  const before = ordered
    .filter((item) => now - Date.parse(item.captured_at) > 20 * 60_000 && valid(item))
    .map((item) => item[channel]);
  const after = ordered
    .filter((item) => now - Date.parse(item.captured_at) <= 20 * 60_000 && valid(item))
    .map((item) => item[channel]);
  if (before.length < 5 || after.length < 3) return undefined;
  const baseline = median(before);
  const current = median(after);
  const variation = median(before.map((value) => Math.abs(value - baseline)));
  return { baseline, current, riseAt: baseline + Math.max(40, baseline * 0.25, variation * 4) };
}

export function gasTrendInsight(
  readings: FridgeSensorReading[],
  calibration?: GasCalibration,
): GasTrendInsight {
  const changed: string[] = [];
  let validChannels = 0;
  for (const channel of gasChannels) {
    const reference = gasChannelReference(readings, channel.key, calibration);
    if (!reference) continue;
    validChannels++;
    if (reference.current >= reference.riseAt) changed.push(channel.label);
  }
  if (validChannels < 2) return { kind: "collecting", channels: [] };
  return {
    kind:
      changed.length >= 2 ? "multiple_changes" : changed.length === 1 ? "single_change" : "steady",
    channels: changed,
  };
}

export function readingSummary(reading?: FridgeSensorReading) {
  if (!reading) return "Waiting for the first sensor reading.";
  const condition = freshnessAppearance[reading.freshness_status];
  return condition.explanation;
}

export function relativeTime(value?: string) {
  if (!value) return "No readings yet";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Updated now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}
