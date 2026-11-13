import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP, PageHeader } from "../../../shared/components/page-header";
import { freshnessAppearance, relativeTime } from "../sensor-insights";
import type { FridgeSensorList, FridgeSensorSummary, PairFridgeSensorResponse } from "../types";

export function FridgeSensorsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [sensors, setSensors] = useState<FridgeSensorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [pairing, setPairing] = useState(false);
  const sheetMotion = useBottomSheetSlide(pairing);
  const [saving, setSaving] = useState(false);
  const [fridgeName, setFridgeName] = useState("");
  const [sensorName, setSensorName] = useState("EcoChef E-Nose");
  const [deviceCode, setDeviceCode] = useState("");
  const [paired, setPaired] = useState<PairFridgeSensorResponse>();

  const load = useCallback(
    async (refresh = false) => {
      refresh ? setRefreshing(true) : setLoading(true);
      setError(undefined);
      try {
        const result = await api.getFridgeSensors<FridgeSensorList>();
        setSensors(Array.isArray(result?.items) ? result.items : []);
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : "Fridge Sensors could not be loaded.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openPairing = () => {
    router.push("/fridge-sensors/connect" as never);
  };

  const pair = async () => {
    if (!fridgeName.trim() || !sensorName.trim() || !deviceCode.trim()) {
      setError("Enter a fridge name, sensor name and device code.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const result = await api.pairFridgeSensor<PairFridgeSensorResponse>({
        fridge_name: fridgeName,
        sensor_name: sensorName,
        device_code: deviceCode,
      });
      setPaired(result);
      await load(true);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "The Fridge Sensor could not be linked.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.pageHeader, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.circleButton, pressed && styles.pressed]}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitle}>
          <PageHeader title="Gas Sensors" />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Connect another gas sensor set"
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          onPress={openPairing}
        >
          <Ionicons name="add" size={23} color={colors.surface} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      ) : (
        <FlatList
          data={sensors}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + spacing[10] },
            sensors.length === 0 && styles.grow,
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
          ListHeaderComponent={
            <>
              <View style={styles.intro}>
                <View style={styles.introIcon}>
                  <MaterialCommunityIcons
                    name="fridge-outline"
                    size={27}
                    color={colors.primaryStrong}
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.introTitle}>Your gas sensor sets</Text>
                  <Text style={styles.introText}>
                    Connect, test and manage each complete gas, temperature and humidity sensor set
                    here.
                  </Text>
                </View>
              </View>
              {error && !pairing ? (
                <Pressable style={styles.error} onPress={() => void load()}>
                  <Text style={styles.errorText}>{error} Tap to retry.</Text>
                </Pressable>
              ) : null}
              {sensors.length ? <Text style={styles.sectionTitle}>YOUR FRIDGES</Text> : null}
            </>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyGraphic}>
                <MaterialCommunityIcons
                  name="fridge-outline"
                  size={36}
                  color={colors.primaryStrong}
                />
              </View>
              <Text style={styles.emptyTitle}>Connect your first sensor set</Text>
              <Text style={styles.emptyText}>
                Use the code from your ESP32 controller. EcoChef will guide configuration and verify
                every expected channel.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]}
                onPress={openPairing}
              >
                <Ionicons name="link-outline" size={18} color={colors.surface} />
                <Text style={styles.primaryText}>Connect and test</Text>
              </Pressable>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => <SensorRow sensor={item} />}
        />
      )}

      <Modal
        visible={pairing}
        transparent
        animationType="fade"
        onRequestClose={() => setPairing(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.backdrop} onPress={() => setPairing(false)} />
          <Animated.View
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing[5] }, sheetMotion]}
          >
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>
                  {paired ? "Sensor linked" : "Link Fridge Sensor"}
                </Text>
                <Text style={styles.sheetSubtitle}>
                  {paired
                    ? "Save these details in the ESP32 configuration."
                    : "Each device code can belong to only one EcoChef account."}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={styles.sheetClose}
                onPress={() => setPairing(false)}
              >
                <Ionicons name="close" size={21} color={colors.text} />
              </Pressable>
            </View>
            {paired ? (
              <View style={styles.credentialCard}>
                <Text style={styles.credentialLabel}>INGESTION URL</Text>
                <Text selectable style={styles.credentialValue}>
                  {apiBaseUrl}/fridge-sensors/readings
                </Text>
                <Pressable
                  style={styles.copyButton}
                  onPress={() =>
                    void Clipboard.setStringAsync(`${apiBaseUrl}/fridge-sensors/readings`)
                  }
                >
                  <Ionicons name="copy-outline" size={16} color={colors.primaryStrong} />
                  <Text style={styles.copyText}>Copy URL</Text>
                </Pressable>
                <View style={styles.credentialDivider} />
                <Text style={styles.credentialLabel}>PRIVATE SENSOR KEY</Text>
                <Text selectable style={styles.credentialValue}>
                  {paired.ingest_key}
                </Text>
                <Pressable
                  style={styles.copyButton}
                  onPress={() => void Clipboard.setStringAsync(paired.ingest_key)}
                >
                  <Ionicons name="copy-outline" size={16} color={colors.primaryStrong} />
                  <Text style={styles.copyText}>Copy key</Text>
                </Pressable>
                <Text style={styles.securityNote}>
                  This key is shown once. Treat it like a password and send it as the X-Sensor-Key
                  header.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]}
                  onPress={() => {
                    setPairing(false);
                    router.push(`/fridge-sensors/${paired.id}` as never);
                  }}
                >
                  <Text style={styles.primaryText}>Open {paired.fridge_name}</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Field
                  label="Fridge name"
                  value={fridgeName}
                  placeholder="Kitchen mini fridge"
                  onChangeText={setFridgeName}
                />
                <Field
                  label="Sensor name"
                  value={sensorName}
                  placeholder="EcoChef E-Nose"
                  onChangeText={setSensorName}
                />
                <Field
                  label="Device code"
                  value={deviceCode}
                  placeholder="ENOSE-A1B2C3"
                  autoCapitalize="characters"
                  onChangeText={setDeviceCode}
                />
                {error ? (
                  <View style={styles.error}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}
                <Pressable
                  disabled={saving}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    saving && styles.disabled,
                    pressed && styles.primaryPressed,
                  ]}
                  onPress={() => void pair()}
                >
                  {saving ? (
                    <ActivityIndicator color={colors.surface} />
                  ) : (
                    <>
                      <Ionicons name="link-outline" size={18} color={colors.surface} />
                      <Text style={styles.primaryText}>Link sensor</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function SensorRow({ sensor }: { sensor: FridgeSensorSummary }) {
  const reading = sensor.latest_reading;
  const freshness = freshnessAppearance[reading?.freshness_status ?? "unknown"];
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.sensorCard, pressed && styles.pressed]}
      onPress={() => router.push(`/fridge-sensors/${sensor.id}` as never)}
    >
      <View style={styles.sensorTop}>
        <View style={styles.sensorIcon}>
          <MaterialCommunityIcons name="fridge-outline" size={23} color={colors.primaryStrong} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.sensorName}>{sensor.fridge_name}</Text>
          <Text style={styles.sensorDevice}>
            {sensor.sensor_name} · {sensor.device_code}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </View>
      <View style={styles.sensorReadingRow}>
        <View style={[styles.freshnessPill, { backgroundColor: freshness.tint }]}>
          <View style={[styles.freshnessDot, { backgroundColor: freshness.color }]} />
          <Text style={[styles.freshnessText, { color: freshness.color }]}>{freshness.label}</Text>
        </View>
        <Text style={styles.updated}>{relativeTime(sensor.last_seen_at)}</Text>
      </View>
      <View style={styles.sensorMetrics}>
        <Text style={styles.metric}>
          {reading ? `${reading.temperature_c.toFixed(1)}°C` : "—°C"}
          <Text style={styles.metricLabel}> temperature</Text>
        </Text>
        <Text style={styles.metric}>
          {reading ? `${Math.round(reading.humidity_percent)}%` : "—%"}
          <Text style={styles.metricLabel}> humidity</Text>
        </Text>
      </View>
    </Pressable>
  );
}

function Field(props: {
  label: string;
  value: string;
  placeholder: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  onChangeText: (value: string) => void;
}) {
  const { label, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        style={styles.input}
        placeholderTextColor={colors.textSubtle}
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
  },
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
  addButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: colors.primary,
  },
  content: { paddingHorizontal: spacing[4] },
  grow: { flexGrow: 1 },
  intro: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: spacing[4],
    backgroundColor: colors.primarySoft,
  },
  introIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: colors.surface,
  },
  introTitle: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s15,
    fontWeight: typography.weight.extrabold,
  },
  introText: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 17,
  },
  sectionTitle: {
    marginTop: spacing[6],
    marginBottom: spacing[3],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
    letterSpacing: 0.7,
  },
  sensorCard: {
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  sensorTop: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  sensorIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
  },
  sensorName: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s15,
    fontWeight: typography.weight.extrabold,
  },
  sensorDevice: { marginTop: 2, color: colors.textMuted, fontSize: typography.mobile.rawSize.s10 },
  sensorReadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing[4],
  },
  freshnessPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: 10,
  },
  freshnessDot: { width: 7, height: 7, borderRadius: 4 },
  freshnessText: {
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
  },
  updated: { color: colors.textSubtle, fontSize: typography.mobile.rawSize.s10 },
  sensorMetrics: {
    flexDirection: "row",
    gap: spacing[5],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  metric: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  metricLabel: {
    color: colors.textSubtle,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.regular,
  },
  separator: { height: spacing[3] },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[10],
  },
  emptyGraphic: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 38,
    backgroundColor: colors.primarySoft,
  },
  emptyTitle: {
    marginTop: spacing[4],
    color: colors.text,
    fontSize: typography.mobile.size.bodyTextHeavy,
    fontWeight: typography.weight.extrabold,
  },
  emptyText: {
    marginTop: spacing[2],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 20,
    textAlign: "center",
  },
  primaryButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    marginTop: spacing[5],
    paddingHorizontal: spacing[5],
    borderRadius: 15,
    backgroundColor: colors.primary,
  },
  primaryText: {
    color: colors.surface,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  primaryPressed: { backgroundColor: colors.primaryStrong },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.55 },
  loader: { marginTop: spacing[16] },
  error: {
    marginTop: spacing[3],
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: spacing[3],
    backgroundColor: colors.dangerSoft,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.mobile.size.caption,
    lineHeight: 17,
    fontWeight: typography.weight.semibold,
  },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.overlay,
  },
  sheet: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    borderTopLeftRadius: spacing[6],
    borderTopRightRadius: spacing[6],
    backgroundColor: colors.surface,
  },
  handle: {
    width: 42,
    height: 4,
    alignSelf: "center",
    marginBottom: spacing[4],
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  sheetTitle: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s21,
    fontWeight: typography.weight.extrabold,
  },
  sheetSubtitle: {
    maxWidth: 290,
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 16,
  },
  sheetClose: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: colors.surfaceMuted,
  },
  field: { marginTop: spacing[3] },
  fieldLabel: {
    marginBottom: spacing[2],
    color: colors.text,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[3],
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    fontSize: typography.mobile.rawSize.s14,
  },
  credentialCard: {
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: spacing[4],
    backgroundColor: colors.primarySoft,
  },
  credentialLabel: {
    color: colors.primaryStrong,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.extrabold,
    letterSpacing: 0.7,
  },
  credentialValue: {
    marginTop: spacing[2],
    color: colors.text,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 17,
    fontWeight: typography.weight.semibold,
  },
  copyButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginTop: spacing[2],
    paddingVertical: spacing[1],
  },
  copyText: {
    color: colors.primaryStrong,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.bold,
  },
  credentialDivider: {
    height: 1,
    marginVertical: spacing[4],
    backgroundColor: colors.primaryBorder,
  },
  securityNote: {
    marginTop: spacing[3],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 16,
  },
  flex: { flex: 1 },
});
