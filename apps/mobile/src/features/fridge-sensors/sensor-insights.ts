import { colors, palette } from "@ecochef/design-tokens";
import type { FreshnessStatus, FridgeSensorReading } from "./types";

export const freshnessAppearance: Record<FreshnessStatus, { label: string; color: string; tint: string; explanation: string }> = {
  excellent: { label: "Fresh pattern", color: colors.success, tint: colors.successSoft, explanation: "The recent pattern is closest to the model’s freshest training examples." },
  good: { label: "Stable", color: colors.primaryStrong, tint: colors.primarySoft, explanation: "No strong spoilage-like change is present in the latest model result." },
  acceptable: { label: "Check soon", color: colors.warningStrong, tint: colors.warningSoft, explanation: "The odour pattern is changing. Check stored food and keep monitoring." },
  spoiled: { label: "Inspect food", color: colors.danger, tint: colors.dangerSoft, explanation: "Repeated readings resemble the model’s spoilage examples. Inspect food and follow normal food-safety guidance." },
  unknown: { label: "Learning baseline", color: palette.c68758a, tint: colors.surfaceMuted, explanation: "EcoChef needs compatible readings before it can estimate an odour pattern." },
};

export const metricDefinitions = [
  { key: "mq3", name: "MQ-3", short: "Fermentation vapours", description: "Responds strongly to alcohol vapours. Changes may accompany fermentation, overripe fruit, cleaners or alcoholic food." },
  { key: "mq135", name: "MQ-135", short: "Broad air-quality change", description: "A broad-response channel for several vapours, including ammonia-like and other volatile compounds. It is useful as a pattern signal, not a specific-gas identification." },
  { key: "mq136", name: "MQ-136", short: "Sulphur-like vapours", description: "Sensitive to hydrogen-sulphide-related gases. A sustained rise can occur around some decomposing protein foods, but other sources can interfere." },
  { key: "mq137", name: "MQ-137", short: "Ammonia-like vapours", description: "Sensitive to ammonia. It can support detection of protein breakdown, while cleaning products and other sources may also affect it." },
] as const;

export function readingSummary(reading?: FridgeSensorReading) {
  if (!reading) return "Waiting for the first sensor reading.";
  const condition = freshnessAppearance[reading.freshness_status];
  return `${condition.explanation} Temperature and humidity are included because both affect food and MQ sensor response.`;
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
