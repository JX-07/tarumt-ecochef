import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { colors, palette, spacing, typography } from "@ecochef/design-tokens";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
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
  freshnessAppearance,
  metricDefinitions,
  readingSummary,
  relativeTime,
} from "../sensor-insights";
import type { FridgeSensorDetail, FridgeSensorReading } from "../types";

const ranges = [
  { label: "6h", value: 6 },
  { label: "24h", value: 24 },
  { label: "7d", value: 168 },
];

export function FridgeSensorDetailScreen() {
  const { sensorId } = useLocalSearchParams<{ sensorId: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [sensor, setSensor] = useState<FridgeSensorDetail>();
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (!sensorId) return;
      refresh ? setRefreshing(true) : setLoading(true);
      setError(undefined);
      try {
        setSensor(await api.getFridgeSensor<FridgeSensorDetail>(sensorId, hours));
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : "Sensor details could not be loaded.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, hours, sensorId],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        void api
          .getFridgeSensor<FridgeSensorDetail>(sensorId, hours)
          .then(setSensor)
          .catch(() => undefined);
      }, 30_000);
      return () => clearInterval(timer);
    }, [api, hours, load, sensorId]),
  );

  const remove = async () => {
    setRemoving(true);
    setError(undefined);
    try {
      await api.removeFridgeSensor(sensorId);
      setRemoveOpen(false);
      router.replace("/fridge-sensors" as never);
    } catch (nextError) {
      setRemoveOpen(false);
      setError(nextError instanceof Error ? nextError.message : "The sensor could not be removed.");
    } finally {
      setRemoving(false);
    }
  };

  const reading = sensor?.latest_reading;
  const freshness = freshnessAppearance[reading?.freshness_status ?? "unknown"];

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
            onRefresh={() => void load(true)}
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
            onPress={() => setRemoveOpen(true)}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        {error ? (
          <Pressable style={styles.error} onPress={() => void load()}>
            <Text style={styles.errorText}>{error} Tap to retry.</Text>
          </Pressable>
        ) : null}

        <View
          style={[styles.hero, { borderColor: freshness.color, backgroundColor: freshness.tint }]}
        >
          <View style={styles.heroTop}>
            <View style={[styles.heroIcon, { backgroundColor: colors.surface }]}>
              <MaterialCommunityIcons name="fridge-outline" size={26} color={freshness.color} />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.heroLabel, { color: freshness.color }]}>{freshness.label}</Text>
              <Text style={styles.heroDevice}>
                {sensor?.sensor_name} ·{" "}
                {sensor?.connection_status === "online"
                  ? "Live"
                  : sensor?.connection_status === "waiting"
                    ? "Waiting for readings"
                    : "Offline"}
              </Text>
            </View>
          </View>
          <Text style={styles.heroSummary}>{readingSummary(reading)}</Text>
          <View style={styles.heroFooter}>
            <Text style={styles.heroTime}>{relativeTime(sensor?.last_seen_at)}</Text>
            {reading?.confidence !== undefined ? (
              <Text style={styles.confidence}>
                {Math.round(reading.confidence * 100)}% model confidence
              </Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionTitle}>CURRENT CONDITIONS</Text>
        <View style={styles.conditionGrid}>
          <ConditionCard
            icon="thermometer-outline"
            value={reading ? `${reading.temperature_c.toFixed(1)}°C` : "—"}
            label="Temperature"
            note={temperatureNote(reading)}
          />
          <ConditionCard
            icon="water-outline"
            value={reading ? `${Math.round(reading.humidity_percent)}%` : "—"}
            label="Humidity"
            note="Humidity changes both food conditions and MQ response."
          />
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
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Relative odour activity</Text>
          <Text style={styles.chartCopy}>
            Each channel is drawn on its own relative scale so shape and direction are easier to
            compare.
          </Text>
          <SensorTrendChart
            emptyText="Trend lines will appear after at least two readings."
            series={odourSeries(sensor?.readings ?? [])}
          />
        </View>
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Temperature</Text>
          <SensorTrendChart
            emptyText="No temperature history yet."
            series={[
              {
                label: "°C",
                color: colors.marketStrong,
                values: sensor?.readings.map((item) => item.temperature_c) ?? [],
              },
            ]}
          />
        </View>
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Humidity</Text>
          <SensorTrendChart
            emptyText="No humidity history yet."
            series={[
              {
                label: "% RH",
                color: colors.todayStrong,
                values: sensor?.readings.map((item) => item.humidity_percent) ?? [],
              },
            ]}
          />
        </View>

        <Text style={styles.sectionTitle}>WHAT EACH SENSOR MEANS</Text>
        <View style={styles.explanationCard}>
          {metricDefinitions.map((metric, index) => (
            <View key={metric.key} style={[styles.explanationRow, index > 0 && styles.rowBorder]}>
              <View style={styles.metricNumber}>
                <Text style={styles.metricNumberText}>
                  {reading ? Math.round(reading[metric.key]) : "—"}
                </Text>
              </View>
              <View style={styles.flex}>
                <View style={styles.metricHeading}>
                  <Text style={styles.metricName}>{metric.name}</Text>
                  <Text style={styles.metricShort}>{metric.short}</Text>
                </View>
                <Text style={styles.metricDescription}>{metric.description}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.modelNote}>
          <Ionicons name="information-circle-outline" size={21} color={colors.primaryStrong} />
          <View style={styles.flex}>
            <Text style={styles.modelTitle}>Screening estimate, not a safety test</Text>
            <Text style={styles.modelText}>
              Freshness labels are supplied by the compatible e-nose gateway trained through
              “train.cmd run enose”. The current training artifact uses MQ-3, MQ-135 and MQ-136
              alongside other legacy channels; MQ-137 is displayed as a supporting live metric until
              matching training data is collected. MQ sensors do not detect pathogens or prove food
              is safe.
            </Text>
          </View>
        </View>
      </ScrollView>

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

function ConditionCard({
  icon,
  value,
  label,
  note,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  note: string;
}) {
  return (
    <View style={styles.conditionCard}>
      <View style={styles.conditionIcon}>
        <Ionicons name={icon} size={20} color={colors.primaryStrong} />
      </View>
      <Text style={styles.conditionValue}>{value}</Text>
      <Text style={styles.conditionLabel}>{label}</Text>
      <Text style={styles.conditionNote}>{note}</Text>
    </View>
  );
}

function temperatureNote(reading?: FridgeSensorReading) {
  if (!reading) return "Waiting for a reading.";
  if (reading.temperature_c > 8)
    return "Warmer than a typical chilled-food target; check the fridge setup.";
  if (reading.temperature_c < 0) return "Below freezing; some foods may freeze.";
  return "Within a commonly chilled range; follow the food’s own storage guidance.";
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
  hero: { padding: spacing[4], borderWidth: 1, borderRadius: 20 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  heroIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  heroLabel: { fontSize: typography.mobile.rawSize.s17, fontWeight: typography.weight.extrabold },
  heroDevice: { marginTop: 2, color: colors.textMuted, fontSize: typography.mobile.rawSize.s11 },
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
  conditionGrid: { flexDirection: "row", gap: spacing[3] },
  conditionCard: {
    flex: 1,
    minHeight: 174,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  conditionIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
  },
  conditionValue: {
    marginTop: spacing[3],
    color: colors.text,
    fontSize: typography.mobile.rawSize.s23,
    fontWeight: typography.weight.extrabold,
  },
  conditionLabel: {
    marginTop: 2,
    color: colors.text,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.bold,
  },
  conditionNote: {
    marginTop: spacing[2],
    color: colors.textMuted,
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
  explanationCard: {
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  explanationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    paddingVertical: spacing[4],
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  metricNumber: {
    minWidth: 52,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[2],
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  metricNumberText: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
  },
  metricHeading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing[2] },
  metricName: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  metricShort: {
    color: colors.primaryStrong,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
  },
  metricDescription: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 17,
  },
  modelNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    marginTop: spacing[5],
    padding: spacing[4],
    borderRadius: spacing[4],
    backgroundColor: colors.primarySoft,
  },
  modelTitle: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  modelText: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 16,
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
