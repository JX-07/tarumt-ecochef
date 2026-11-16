import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { colors, palette, spacing, typography } from "@ecochef/design-tokens";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP, PageHeader } from "../../../shared/components/page-header";
import { SensorTrendChart } from "../components/sensor-trend-chart";
import {
  clearGasCalibration,
  clearPendingGasCalibration,
  loadGasCalibration,
  loadPendingGasCalibration,
  saveGasCalibration,
  savePendingGasCalibration,
  scheduleCalibrationNotification,
} from "../calibration-storage";
import {
  freshnessAppearance,
  createGasCalibration,
  gasChannelReference,
  gasTrendInsight,
  metricDefinitions,
  readingSummary,
  relativeTime,
} from "../sensor-insights";
import type { GasCalibration, GasChannelReference, GasTrendInsight } from "../sensor-insights";
import type { FridgeSensorDetail, FridgeSensorReading, SensorConnectionStatus } from "../types";

const ranges = [
  { label: "6h", value: 6 },
  { label: "24h", value: 24 },
  { label: "7d", value: 168 },
];

const CALIBRATION_DURATION_MS = 3 * 60_000;

export function FridgeSensorDetailScreen() {
  const { sensorId } = useLocalSearchParams<{ sensorId: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [sensor, setSensor] = useState<FridgeSensorDetail>();
  const [gasHistory, setGasHistory] = useState<FridgeSensorReading[]>([]);
  const [gasCalibration, setGasCalibration] = useState<GasCalibration>();
  const [calibrationMessage, setCalibrationMessage] = useState<string>();
  const [calibrationEndsAt, setCalibrationEndsAt] = useState<number>();
  const [calibrationNow, setCalibrationNow] = useState(Date.now());
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [calibrationConfirmOpen, setCalibrationConfirmOpen] = useState(false);
  const [calibrationCompleteOpen, setCalibrationCompleteOpen] = useState(false);
  const [hours, setHours] = useState(24);
  const [loadedHours, setLoadedHours] = useState<number>();
  const [historyWindowEnd, setHistoryWindowEnd] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const requestId = useRef(0);
  const finishingCalibration = useRef(false);

  useEffect(() => {
    if (!sensorId) return;
    let active = true;
    void Promise.all([loadGasCalibration(sensorId), loadPendingGasCalibration(sensorId)]).then(
      ([saved, pending]) => {
        if (!active) return;
        if (saved) setGasCalibration(saved);
        if (pending) setCalibrationEndsAt(pending.endsAt);
      },
    );
    return () => {
      active = false;
    };
  }, [sensorId]);

  useEffect(() => {
    if (!calibrationEndsAt) return;
    const update = () => setCalibrationNow(Date.now());
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [calibrationEndsAt]);

  useEffect(() => {
    if (
      !calibrationEndsAt ||
      calibrationNow < calibrationEndsAt ||
      finishingCalibration.current ||
      gasHistory.length < 6
    )
      return;
    const calibration = createGasCalibration(gasHistory);
    if (!calibration) {
      setCalibrationMessage("Calibration is waiting for enough valid gas readings.");
      return;
    }
    finishingCalibration.current = true;
    void Promise.all([
      saveGasCalibration(sensorId, calibration),
      clearPendingGasCalibration(sensorId),
    ])
      .then(() => {
        setGasCalibration(calibration);
        setCalibrationEndsAt(undefined);
        setCalibrationMessage(undefined);
        setCalibrationCompleteOpen(true);
      })
      .catch(() =>
        setCalibrationMessage("The baseline could not be saved. Keep this page open and retry."),
      )
      .finally(() => {
        finishingCalibration.current = false;
      });
  }, [calibrationEndsAt, calibrationNow, gasHistory, sensorId]);

  const load = useCallback(
    async (mode: "initial" | "manual" | "background" = "initial") => {
      if (!sensorId) return;
      const currentRequest = ++requestId.current;
      if (mode === "manual") setRefreshing(true);
      if (mode === "initial") setLoading(true);
      if (mode !== "background") setError(undefined);
      try {
        const [result, recent] = await Promise.all([
          api.getFridgeSensor<FridgeSensorDetail>(sensorId, hours),
          api.getFridgeSensor<FridgeSensorDetail>(sensorId, 1),
        ]);
        if (currentRequest === requestId.current) {
          setSensor(result);
          setGasHistory(recent.readings);
          setLoadedHours(hours);
          setHistoryWindowEnd(Date.now());
          setError(undefined);
        }
      } catch (nextError) {
        if (currentRequest === requestId.current && mode !== "background")
          setError(
            nextError instanceof Error ? nextError.message : "Sensor details could not be loaded.",
          );
      } finally {
        if (currentRequest === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, hours, sensorId],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        void load("background");
      }, 15_000);
      return () => {
        clearInterval(timer);
        requestId.current++;
      };
    }, [load]),
  );

  const remove = async () => {
    setRemoving(true);
    setError(undefined);
    try {
      await api.removeFridgeSensor(sensorId);
      await Promise.all([clearGasCalibration(sensorId), clearPendingGasCalibration(sensorId)]);
      setRemoveOpen(false);
      router.replace("/fridge-sensors" as never);
    } catch (nextError) {
      setRemoveOpen(false);
      setError(nextError instanceof Error ? nextError.message : "The sensor could not be removed.");
    } finally {
      setRemoving(false);
    }
  };

  const startCalibration = async () => {
    const pending = {
      sensorId,
      fridgeName: sensor?.fridge_name ?? "Your fridge",
      endsAt: Date.now() + CALIBRATION_DURATION_MS,
    };
    await savePendingGasCalibration(pending);
    void scheduleCalibrationNotification(pending).catch(() => undefined);
    setCalibrationEndsAt(pending.endsAt);
    setCalibrationNow(Date.now());
    setCalibrationMessage(undefined);
    setCalibrationConfirmOpen(false);
  };

  const calibrationSeconds = calibrationEndsAt
    ? Math.max(0, Math.ceil((calibrationEndsAt - calibrationNow) / 1000))
    : 0;

  const reading = sensor?.latest_reading;
  const freshness = reading
    ? freshnessAppearance[reading.freshness_status]
    : { ...freshnessAppearance.unknown, label: "Waiting for readings" };
  const gasInsight = gasTrendInsight(gasHistory, gasCalibration);
  const status = fridgeStatus(reading, sensor?.connection_status);
  const odour = odourStatus(gasInsight, Boolean(gasCalibration), sensor?.connection_status);
  const trendReadings = loadedHours === hours ? (sensor?.readings ?? []) : [];
  const historyWindowStart = historyWindowEnd - hours * 60 * 60_000;

  if (loading && !sensor)
    return (
      <View style={styles.root}>
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      </View>
    );

  return (
    <>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + PAGE_TOP_GAP, paddingBottom: insets.bottom + spacing[10] },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load("manual")}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [styles.circleButton, pressed && styles.pressed]}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerTitle}>
            <PageHeader title={sensor?.fridge_name ?? "Fridge Sensor"} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sensor options"
            style={({ pressed }) => [styles.circleButton, pressed && styles.pressed]}
            onPress={() => setOptionsOpen(true)}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        {error ? (
          <Pressable style={styles.error} onPress={() => void load("manual")}>
            <Text style={styles.errorText}>{error} Tap to retry.</Text>
          </Pressable>
        ) : null}

        <Text style={styles.statusEyebrow}>FRIDGE STATUS</Text>
        <View
          style={[styles.statusCard, { borderColor: status.color, backgroundColor: status.tint }]}
        >
          <View style={styles.statusHeading}>
            <View style={styles.iconTile}>
              <Ionicons name={status.icon} size={26} color={status.color} />
            </View>
            <Text style={[styles.statusTitle, { color: status.color }]}>{status.title}</Text>
          </View>
          <Text style={styles.statusDescription}>{status.description}</Text>
        </View>

        {odour ? (
          <View
            style={[
              styles.odourStatusCard,
              { borderColor: odour.color, backgroundColor: odour.tint },
            ]}
          >
            <Ionicons name={odour.icon} size={22} color={odour.color} />
            <View style={styles.flex}>
              <Text style={[styles.odourStatusTitle, { color: odour.color }]}>{odour.title}</Text>
              <Text style={styles.odourStatusText}>{odour.text}</Text>
            </View>
          </View>
        ) : null}

        {calibrationEndsAt ? (
          <View style={styles.calibrationProgress}>
            <View style={styles.calibrationProgressIcon}>
              <Ionicons name="timer-outline" size={22} color={colors.primaryStrong} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.calibrationProgressTitle}>Calibrating fridge air</Text>
              <Text style={styles.calibrationProgressText}>
                Leave the fridge closed and keep test food away from the sensor.
              </Text>
            </View>
            <Text style={styles.calibrationTimer}>
              {Math.floor(calibrationSeconds / 60)}:
              {String(calibrationSeconds % 60).padStart(2, "0")}
            </Text>
          </View>
        ) : calibrationMessage ? (
          <Text style={styles.calibrationMessage}>{calibrationMessage}</Text>
        ) : null}

        <View
          style={[styles.hero, { borderColor: freshness.color, backgroundColor: freshness.tint }]}
        >
          <View style={styles.heroTop}>
            <View style={styles.iconTile}>
              <MaterialCommunityIcons name="fridge-outline" size={26} color={freshness.color} />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.heroLabel, { color: freshness.color }]}>{freshness.label}</Text>
              <Text style={styles.heroDevice}>
                {sensor?.sensor_name} ·{" "}
                <Text style={sensor?.connection_status === "online" ? styles.liveText : undefined}>
                  {sensor?.connection_status === "online"
                    ? "Live"
                    : sensor?.connection_status === "waiting"
                      ? "Waiting for readings"
                      : "Offline"}
                </Text>
              </Text>
            </View>
          </View>
          <Text style={styles.heroSummary}>{readingSummary(reading)}</Text>
          <View style={styles.heroFooter}>
            <Text style={styles.heroTime}>{relativeTime(sensor?.last_seen_at)}</Text>
            {reading?.freshness_status !== "unknown" && reading?.confidence != null ? (
              <Text style={styles.confidence}>
                {Math.round(reading.confidence * 100)}% model confidence
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>SENSOR TRENDS</Text>
          <View style={styles.rangeControl}>
            {ranges.map((range) => (
              <Pressable
                key={range.value}
                style={[styles.rangeButton, hours === range.value && styles.rangeActive]}
                onPress={() => setHours(range.value)}
              >
                <Text style={[styles.rangeText, hours === range.value && styles.rangeTextActive]}>
                  {range.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Text style={styles.retentionNote}>Sensor readings are kept for 21 days.</Text>
        {trendReadings.length > 0 &&
        Date.parse(trendReadings[0].captured_at) > historyWindowStart + 15 * 60_000 ? (
          <Text style={styles.rangeCoverage}>
            Readings shown start{" "}
            {new Date(trendReadings[0].captured_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            . No earlier data was returned for this period.
          </Text>
        ) : null}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Gas sensor changes</Text>
          <Text style={styles.chartCopy}>
            Each line matches a gas reading below. Tap for exact numbers. Compare a line with its
            own past readings; the lines use different scales.
          </Text>
          <SensorTrendChart
            key={`gas-${hours}`}
            emptyText="No readings in this period yet."
            series={odourSeries(trendReadings)}
            timestamps={trendReadings.map((item) => item.captured_at)}
            windowStart={historyWindowStart}
            windowEnd={historyWindowEnd}
          />
        </View>
        <Text style={styles.sectionTitle}>GAS READINGS RIGHT NOW</Text>
        <Text style={styles.metricIntro}>
          Each number is a raw sensor response. Steady readings are easier to interpret; if several
          keep rising, check your stored food. A high number alone does not mean food is spoiled.
        </Text>
        <View style={styles.gasGrid}>
          {metricDefinitions.map((metric) => {
            const values = trendReadings.map((item) => item[metric.key]);
            const current = reading?.[metric.key];
            const low = Math.min(current ?? 0, ...values);
            const high = Math.max(current ?? 0, ...values);
            const padding = Math.max(50, (high - low) * 0.2);
            const min = Math.max(0, low - padding);
            const max = Math.min(4095, high + padding);
            const guide = gasScaleGuide(
              gasChannelReference(gasHistory, metric.key, gasCalibration),
              min,
              max,
            );
            return (
              <ReadingScale
                key={metric.key}
                label={`${metric.name} · ${metric.short}`}
                value={current === undefined ? "—" : String(Math.round(current))}
                rawValue={current}
                min={min}
                max={max}
                leftLabel="Lower response"
                rightLabel="Stronger response"
                bands={guide.bands}
                reference={guide.reference}
                note={gasChange(values)}
                detail={metric.description}
              />
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, styles.spacedSectionTitle]}>TEMPERATURE</Text>
        <View style={styles.chartCard}>
          <SensorTrendChart
            key={`temperature-${hours}`}
            emptyText="No readings in this period yet."
            series={[
              {
                label: "°C",
                color: colors.marketStrong,
                values: trendReadings.map((item) => item.temperature_c),
                unit: "°C",
              },
            ]}
            timestamps={trendReadings.map((item) => item.captured_at)}
            windowStart={historyWindowStart}
            windowEnd={historyWindowEnd}
          />
        </View>
        <View style={styles.conditionGrid}>
          <ReadingScale
            label="Temperature"
            value={reading ? `${reading.temperature_c.toFixed(1)}°C` : "—"}
            rawValue={reading?.temperature_c}
            min={-2}
            max={12}
            leftLabel="Freezing"
            rightLabel="Too warm"
            unit="°C"
            bands={[
              { start: -2, end: 0, color: colors.warningSoft },
              { start: 0, end: 4, color: colors.successSoft },
              { start: 4, end: 12, color: colors.dangerSoft },
            ]}
            reference="FoodSafety.gov: keep the fridge at 4°C or below. Below 0°C may freeze food."
            note={temperatureNote(reading)}
          />
        </View>

        <Text style={[styles.sectionTitle, styles.spacedSectionTitle]}>AIR MOISTURE</Text>
        <View style={styles.chartCard}>
          <SensorTrendChart
            key={`humidity-${hours}`}
            emptyText="No readings in this period yet."
            series={[
              {
                label: "% RH",
                color: colors.todayStrong,
                values: trendReadings.map((item) => item.humidity_percent),
                unit: "%",
              },
            ]}
            timestamps={trendReadings.map((item) => item.captured_at)}
            windowStart={historyWindowStart}
            windowEnd={historyWindowEnd}
          />
        </View>
        <View style={styles.conditionGrid}>
          <ReadingScale
            label="Air moisture"
            value={reading ? `${Math.round(reading.humidity_percent)}%` : "—"}
            rawValue={reading?.humidity_percent}
            min={0}
            max={100}
            leftLabel="Too dry"
            rightLabel="Too damp"
            unit="%"
            bands={[
              { start: 0, end: 50, color: colors.warningSoft },
              { start: 50, end: 99, color: colors.primarySoft },
              { start: 99, end: 100, color: colors.warningSoft },
            ]}
            reference="UMN Extension: typical fridge air is around 50–60%; produce may need more. 100% is saturated."
            note={humidityNote(reading)}
          />
        </View>
        <Text style={styles.humidityHelp}>
          {reading
            ? `${Math.round(reading.humidity_percent)}% means the fridge air holds about that share of the moisture it could hold at this temperature. `
            : "Humidity measures moisture in the fridge air. "}
          It does not measure moisture inside food.
        </Text>
      </ScrollView>

      <Modal
        visible={optionsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOptionsOpen(false)}
      >
        <View style={styles.optionsOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOptionsOpen(false)} />
          <View style={[styles.optionsMenu, { top: insets.top + 64 }]}>
            <Pressable
              style={styles.optionRow}
              onPress={() => {
                setOptionsOpen(false);
                setCalibrationConfirmOpen(true);
              }}
            >
              <Ionicons name="speedometer-outline" size={20} color={colors.primaryStrong} />
              <Text style={styles.optionText}>
                {gasCalibration ? "Calibrate again" : "Calibrate"}
              </Text>
            </Pressable>
            <View style={styles.optionDivider} />
            <Pressable
              style={styles.optionRow}
              onPress={() => {
                setOptionsOpen(false);
                setRemoveOpen(true);
              }}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Text style={[styles.optionText, styles.optionDanger]}>Remove</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={calibrationConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCalibrationConfirmOpen(false)}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setCalibrationConfirmOpen(false)}
          />
          <View style={styles.confirmCard}>
            <View style={styles.calibrationConfirmIcon}>
              <Ionicons name="speedometer-outline" size={27} color={colors.primaryStrong} />
            </View>
            <Text style={styles.confirmTitle}>Calibrate the empty fridge?</Text>
            <Text style={styles.confirmCopy}>
              Remove the test food, close the fridge, and leave it undisturbed for three minutes.
              EcoChef will use those readings as this sensor’s normal baseline.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                style={styles.cancelButton}
                onPress={() => setCalibrationConfirmOpen(false)}
              >
                <Text style={styles.cancelButtonText}>Not now</Text>
              </Pressable>
              <Pressable
                style={styles.calibrationStartButton}
                onPress={() => void startCalibration()}
              >
                <Text style={styles.calibrationStartText}>Start 3-minute timer</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={calibrationCompleteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCalibrationCompleteOpen(false)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.calibrationSuccessIcon}>
              <Ionicons name="checkmark-circle" size={29} color={colors.success} />
            </View>
            <Text style={styles.confirmTitle}>Baseline established successfully</Text>
            <Text style={styles.confirmCopy}>
              The sensor can now compare new fridge-air readings with its normal baseline and detect
              unusual odour changes.
            </Text>
            <Pressable
              style={styles.calibrationDoneButton}
              onPress={() => setCalibrationCompleteOpen(false)}
            >
              <Text style={styles.calibrationDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={removeOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          if (!removing) setRemoveOpen(false);
        }}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            accessibilityLabel="Cancel sensor removal"
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!removing) setRemoveOpen(false);
            }}
          />
          <View accessibilityRole="alert" style={styles.confirmCard}>
            <View style={styles.confirmIcon}>
              <Ionicons name="trash-outline" size={26} color={colors.danger} />
            </View>
            <Text style={styles.confirmTitle}>Remove fridge sensor?</Text>
            <Text style={styles.confirmCopy}>
              This will permanently remove {sensor?.fridge_name ?? "this sensor"} and its stored
              readings. Its ESP32 sensor key will stop working.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                disabled={removing}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
                onPress={() => setRemoveOpen(false)}
              >
                <Text style={styles.cancelButtonText}>Keep sensor</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove fridge sensor permanently"
                disabled={removing}
                style={({ pressed }) => [
                  styles.removeButton,
                  removing && styles.removeButtonDisabled,
                  pressed && styles.removeButtonPressed,
                ]}
                onPress={() => void remove()}
              >
                {removing ? (
                  <ActivityIndicator size="small" color={colors.surface} />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={17} color={colors.surface} />
                    <Text style={styles.removeButtonText}>Remove</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

type FridgeStatusAppearance = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  tint: string;
};

function fridgeStatus(
  reading?: FridgeSensorReading,
  connection?: SensorConnectionStatus,
): FridgeStatusAppearance {
  if (!reading)
    return {
      title: "Waiting for the first reading",
      description: "Your fridge status will appear once the sensor sends data.",
      icon: "time-outline",
      color: colors.textMuted,
      tint: colors.surfaceMuted,
    };

  if (connection !== "online")
    return {
      title: "Sensor offline",
      description: "These readings may be out of date. Check the sensor connection.",
      icon: "cloud-offline-outline",
      color: colors.warningStrong,
      tint: colors.warningSoft,
    };
  if (reading.temperature_c > 4)
    return {
      title: "Fridge is too warm",
      description: "The air is above 4°C. Check the fridge setting or door.",
      icon: "thermometer-outline",
      color: colors.warningStrong,
      tint: colors.warningSoft,
    };
  return {
    title: "Fridge temperature looks good",
    description: `The fridge air is ${reading.temperature_c.toFixed(1)}°C, within the recommended range.`,
    icon: "checkmark-circle-outline",
    color: colors.success,
    tint: colors.successSoft,
  };
}

function odourStatus(
  gas: GasTrendInsight,
  calibrated: boolean,
  connection?: SensorConnectionStatus,
) {
  if (!calibrated) return undefined;
  if (connection !== "online")
    return {
      title: "Odour monitoring paused",
      text: "The sensor is offline, so EcoChef cannot compare new readings with the baseline.",
      icon: "cloud-offline-outline" as const,
      color: colors.warningStrong,
      tint: colors.warningSoft,
    };
  if (gas.kind === "multiple_changes")
    return {
      title: "Odour anomaly detected",
      text: `${gas.channels.join(", ")} changed together. Check food, spills, and recent cleaning.`,
      icon: "warning-outline" as const,
      color: colors.danger,
      tint: colors.dangerSoft,
    };
  if (gas.kind === "single_change")
    return {
      title: "One gas reading changed",
      text: `${gas.channels[0]} changed, while the other sensors remain near the baseline.`,
      icon: "trending-up-outline" as const,
      color: colors.warningStrong,
      tint: colors.warningSoft,
    };
  return {
    title: gas.kind === "steady" ? "Gas readings are steady" : "Checking odour changes",
    text:
      gas.kind === "steady"
        ? "No lasting multi-sensor rise is present compared with the calibrated baseline."
        : "EcoChef is collecting three new readings to compare with the baseline.",
    icon: "pulse-outline" as const,
    color: colors.primaryStrong,
    tint: colors.primarySoft,
  };
}

function ReadingScale({
  label,
  value,
  rawValue,
  min,
  max,
  leftLabel,
  rightLabel,
  unit = "",
  bands,
  reference,
  note,
  detail,
}: {
  label: string;
  value: string;
  rawValue?: number;
  min: number;
  max: number;
  leftLabel: string;
  rightLabel: string;
  unit?: string;
  bands: { start: number; end: number; color: string }[];
  reference: string;
  note: string;
  detail?: string;
}) {
  const position =
    rawValue === undefined || !Number.isFinite(rawValue)
      ? undefined
      : Math.max(0, Math.min(100, ((rawValue - min) / Math.max(max - min, 1)) * 100));
  return (
    <View style={styles.conditionCard}>
      <View style={styles.scaleHeader}>
        <Text style={styles.conditionLabel}>{label}</Text>
        <Text style={styles.conditionValue}>{value}</Text>
      </View>
      <View style={styles.scaleTrack}>
        <View style={styles.scaleBands}>
          {bands
            .filter((band) => band.end > band.start)
            .map((band) => (
              <View
                key={`${band.start}-${band.end}`}
                style={{ flex: band.end - band.start, backgroundColor: band.color }}
              />
            ))}
        </View>
        {position !== undefined ? (
          <View style={[styles.scaleMarker, { left: `${position}%` }]} />
        ) : null}
      </View>
      <View style={styles.scaleEnds}>
        <Text style={styles.scaleEndText}>{`${leftLabel} · ${Math.round(min)}${unit}`}</Text>
        <Text style={styles.scaleEndText}>{`${rightLabel} · ${Math.round(max)}${unit}`}</Text>
      </View>
      <Text style={styles.scaleReference}>{reference}</Text>
      <Text style={styles.conditionNote}>{note}</Text>
      {detail ? <Text style={styles.scaleDetail}>{detail}</Text> : null}
    </View>
  );
}

function gasScaleGuide(reference: GasChannelReference | undefined, min: number, max: number) {
  if (!reference)
    return {
      bands: [{ start: min, end: max, color: colors.primarySoft }],
      reference: "Raw sensor scale: 0–4095. More readings will establish a recent reference.",
    };
  const riseAt = Math.round(reference.riseAt);
  const boundary = Math.max(min, Math.min(max, reference.riseAt));
  return {
    bands: [
      { start: min, end: boundary, color: colors.primarySoft },
      { start: boundary, end: max, color: colors.warningSoft },
    ],
    reference: `Earlier level: ${Math.round(reference.baseline)} raw. Rise guide: ${riseAt} raw${boundary < max ? " (amber)" : ""}. Not a spoilage limit.`,
  };
}

function gasChange(values: number[]) {
  if (values.length < 2) return "More readings will show whether this is changing.";
  const difference = Math.round(values[values.length - 1] - values[0]);
  if (difference === 0) return "No change during the selected period.";
  return `${difference > 0 ? "Up" : "Down"} ${Math.abs(difference)} during the selected period.`;
}

function temperatureNote(reading?: FridgeSensorReading) {
  if (!reading) return "Waiting for a reading.";
  if (reading.temperature_c > 4)
    return "Above the recommended fridge temperature. Check the setting or door.";
  if (reading.temperature_c < 0) return "Below freezing; some foods may freeze.";
  return "Within the recommended fridge temperature range.";
}

function humidityNote(reading?: FridgeSensorReading) {
  if (!reading) return "Waiting for a reading.";
  if (reading.humidity_percent < 50)
    return "Drier than a typical fridge. Keep leafy produce covered or in the crisper.";
  if (reading.humidity_percent >= 95)
    return "Very moist air can suit some produce. Wipe away any visible condensation.";
  if (reading.humidity_percent >= 80)
    return "Moist air can help leafy produce. Wipe away any visible condensation.";
  return "Moderate air moisture. Check uncovered produce regularly.";
}

function odourSeries(readings: FridgeSensorReading[]) {
  return [
    { label: "MQ-3", color: colors.todayStrong, values: readings.map((item) => item.mq3) },
    { label: "MQ-135", color: colors.primaryStrong, values: readings.map((item) => item.mq135) },
    { label: "MQ-136", color: colors.marketStrong, values: readings.map((item) => item.mq136) },
    { label: "MQ-137", color: palette.c8a5bc4, values: readings.map((item) => item.mq137) },
  ];
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  content: { paddingHorizontal: spacing[4] },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3], marginBottom: spacing[4] },
  headerTitle: { flex: 1 },
  circleButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 21,
    backgroundColor: colors.surface,
  },
  statusCard: {
    marginBottom: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderRadius: spacing[4],
  },
  statusEyebrow: {
    marginBottom: spacing[2],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
    letterSpacing: 0.7,
  },
  statusHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[2],
  },
  statusTitle: {
    flex: 1,
    fontSize: typography.mobile.rawSize.s17,
    fontWeight: typography.weight.extrabold,
  },
  statusDescription: {
    marginTop: spacing[1],
    color: colors.text,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 17,
  },
  statusSecondary: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statusSecondaryIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  statusSecondaryText: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 17,
  },
  statusSecondaryTitle: {
    marginBottom: spacing[1],
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  statusSecondaryLabel: {
    marginBottom: spacing[1],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
    letterSpacing: 0.7,
  },
  odourStatusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    marginBottom: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderRadius: spacing[4],
  },
  odourStatusTitle: {
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  odourStatusText: {
    marginTop: spacing[1],
    color: colors.text,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 16,
  },
  calibrationProgress: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    marginBottom: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: spacing[4],
    backgroundColor: colors.primarySoft,
  },
  calibrationProgressIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: colors.surface,
  },
  calibrationProgressTitle: {
    color: colors.primaryStrong,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  calibrationProgressText: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 16,
  },
  calibrationTimer: {
    color: colors.primaryStrong,
    fontSize: typography.mobile.rawSize.s17,
    fontWeight: typography.weight.bold,
  },
  calibrationMessage: {
    marginTop: spacing[2],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 15,
  },
  hero: { padding: spacing[4], borderWidth: 1, borderRadius: 20 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  iconTile: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  heroLabel: { fontSize: typography.mobile.rawSize.s17, fontWeight: typography.weight.extrabold },
  heroDevice: { marginTop: 2, color: colors.textMuted, fontSize: typography.mobile.rawSize.s11 },
  liveText: { color: colors.success, fontWeight: typography.weight.bold },
  heroSummary: {
    marginTop: spacing[4],
    color: colors.text,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 20,
  },
  heroFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing[3],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  heroTime: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s10 },
  confidence: {
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
  },
  sectionTitle: {
    marginTop: spacing[6],
    marginBottom: spacing[3],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
    letterSpacing: 0.7,
  },
  spacedSectionTitle: { marginTop: spacing[10] },
  conditionGrid: { gap: spacing[3] },
  gasGrid: { gap: spacing[3], marginBottom: spacing[4] },
  humidityHelp: {
    marginTop: spacing[2],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 16,
  },
  conditionCard: {
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  scaleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  conditionValue: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s19,
    fontWeight: typography.weight.extrabold,
  },
  conditionLabel: {
    flex: 1,
    color: colors.text,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
  },
  scaleTrack: {
    height: 12,
    marginTop: spacing[4],
    borderRadius: 6,
    backgroundColor: colors.surfaceMuted,
  },
  scaleBands: { flex: 1, flexDirection: "row", overflow: "hidden", borderRadius: 6 },
  scaleMarker: {
    position: "absolute",
    top: -4,
    width: 12,
    height: 18,
    marginLeft: -6,
    borderRadius: 6,
    backgroundColor: colors.primaryStrong,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  scaleEnds: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing[2] },
  scaleEndText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s10 },
  scaleReference: {
    marginTop: spacing[2],
    color: colors.text,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
    lineHeight: 15,
  },
  conditionNote: {
    marginTop: spacing[2],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 15,
  },
  scaleDetail: {
    marginTop: spacing[1],
    color: colors.textSubtle,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 15,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing[6],
    marginBottom: spacing[3],
  },
  rangeControl: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 11,
    backgroundColor: colors.surfaceMuted,
  },
  rangeButton: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: spacing[2],
  },
  rangeActive: { backgroundColor: colors.surface },
  rangeText: {
    color: colors.textSubtle,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
  },
  rangeTextActive: { color: colors.primaryStrong },
  retentionNote: {
    marginBottom: spacing[3],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
  },
  rangeCoverage: {
    marginTop: -spacing[2],
    marginBottom: spacing[3],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 15,
  },
  chartCard: {
    marginBottom: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  chartTitle: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.extrabold,
  },
  chartCopy: {
    marginTop: spacing[1],
    marginBottom: spacing[3],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 15,
  },
  metricIntro: {
    marginBottom: spacing[3],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 17,
  },
  error: {
    marginBottom: spacing[4],
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: spacing[3],
    backgroundColor: colors.dangerSoft,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.mobile.size.caption,
    fontWeight: typography.weight.semibold,
  },
  confirmOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[5],
    backgroundColor: colors.overlay,
  },
  optionsOverlay: { flex: 1, backgroundColor: colors.overlay },
  optionsMenu: {
    position: "absolute",
    right: spacing[4],
    width: 210,
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 10,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  optionText: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
  },
  optionDanger: { color: colors.danger },
  optionDivider: { height: 1, marginHorizontal: spacing[3], backgroundColor: colors.border },
  confirmCard: {
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    padding: spacing[5],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[6],
    backgroundColor: colors.surface,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  confirmIcon: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 29,
    backgroundColor: colors.dangerSoft,
  },
  calibrationConfirmIcon: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 29,
    backgroundColor: colors.primarySoft,
  },
  calibrationSuccessIcon: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 29,
    backgroundColor: colors.successSoft,
  },
  confirmTitle: {
    marginTop: spacing[4],
    color: colors.text,
    fontSize: typography.mobile.rawSize.s19,
    fontWeight: typography.weight.extrabold,
    textAlign: "center",
  },
  confirmCopy: {
    marginTop: spacing[2],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s12,
    lineHeight: 19,
    textAlign: "center",
  },
  confirmActions: { width: "100%", flexDirection: "row", gap: spacing[3], marginTop: spacing[5] },
  cancelButton: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[3],
    backgroundColor: colors.surface,
  },
  cancelButtonText: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
  },
  calibrationStartButton: {
    flex: 1.4,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[3],
    backgroundColor: colors.primaryStrong,
  },
  calibrationStartText: {
    color: colors.surface,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
  },
  calibrationDoneButton: {
    width: "100%",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing[5],
    borderRadius: spacing[3],
    backgroundColor: colors.primaryStrong,
  },
  calibrationDoneText: {
    color: colors.surface,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  removeButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: spacing[3],
    backgroundColor: colors.danger,
  },
  removeButtonPressed: { opacity: 0.82 },
  removeButtonDisabled: { opacity: 0.6 },
  removeButtonText: {
    color: colors.surface,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  loader: { marginTop: spacing[16] },
  pressed: { opacity: 0.72 },
  flex: { flex: 1 },
});
