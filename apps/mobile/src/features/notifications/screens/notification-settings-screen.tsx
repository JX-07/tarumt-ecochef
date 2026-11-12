import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import type { NotificationPreferences } from "../types";



const rows: Array<{ key: keyof NotificationPreferences; icon: keyof typeof Ionicons.glyphMap; title: string; description: string }> = [
  { key: "sensor_alerts", icon: "hardware-chip-outline", title: "Sensor alerts", description: "Temperature and paired appliance warnings." },
  { key: "ingredient_expiry", icon: "warning-outline", title: "Ingredient freshness", description: "Reminders before ingredients go bad." },
  { key: "meal_reminders", icon: "restaurant-outline", title: "Scheduled meals", description: "A reminder when a planned meal is happening soon." },
  { key: "payment_updates", icon: "checkmark-circle-outline", title: "Successful payments", description: "Confirmation after an order is paid." },
  { key: "delivery_updates", icon: "bicycle-outline", title: "Delivery and pickup", description: "Driver arrival and ready-for-pickup updates." },
];

export function NotificationSettingsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [preferences, setPreferences] = useState<NotificationPreferences>();
  const [saving, setSaving] = useState<keyof NotificationPreferences>();
  const [error, setError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    try { setPreferences(await api.getNotificationPreferences<NotificationPreferences>()); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Preferences could not be loaded."); }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const toggle = async (key: keyof NotificationPreferences) => {
    if (!preferences || saving) return;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setSaving(key);
    setError(undefined);
    try { setPreferences(await api.updateNotificationPreferences<NotificationPreferences>(next)); }
    catch (nextError) {
      setPreferences(preferences);
      setError(nextError instanceof Error ? nextError.message : "That preference could not be saved.");
    } finally { setSaving(undefined); }
  };

  const sendTestNotification = async () => {
    if (Platform.OS === "web" || testing) return;
    setTesting(true);
    setTestStatus(undefined);
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("fridge-alerts", {
          name: "Fridge alerts",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 180, 250],
        });
      }
      const current = await Notifications.getPermissionsAsync();
      const permission = current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
      if (permission.status !== "granted") {
        setTestStatus("Notifications are disabled. Allow them in your phone settings, then try again.");
        return;
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "EcoChef sensor test",
          body: "Notifications are working on this phone.",
          sound: true,
          data: { action_path: "/notifications" },
        },
        trigger: null,
      });
      setTestStatus("Test sent. You should see and hear it now.");
    } catch (nextError) {
      setTestStatus(nextError instanceof Error ? nextError.message : "The test notification could not be sent.");
    } finally {
      setTesting(false);
    }
  };

  return <View style={styles.root}>
    <View style={[styles.header, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" style={({ pressed }) => [styles.back, pressed && styles.pressed]} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable>
      <Text style={styles.title}>Notification settings</Text>
      <View style={styles.headerSpacer} />
    </View>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing[8] }]} showsVerticalScrollIndicator={false}>
      <View style={styles.intro}><View style={styles.introIcon}><Ionicons name="notifications-outline" size={24} color={colors.primaryStrong} /></View><View style={styles.flex}><Text style={styles.introTitle}>Only the updates you want</Text><Text style={styles.introText}>EcoChef uses your saved ingredients, meal plan and orders to create these alerts.</Text></View></View>
      {error ? <Pressable style={styles.error} onPress={() => void load()}><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}
      {!preferences ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : <View style={styles.card}>{rows.map((row, index) => <View key={row.key} style={[styles.row, index > 0 && styles.rowBorder]}>
        <View style={styles.rowIcon}><Ionicons name={row.icon} size={20} color={colors.primaryStrong} /></View>
        <View style={styles.flex}><Text style={styles.rowTitle}>{row.title}</Text><Text style={styles.rowText}>{row.description}</Text></View>
        <Switch accessibilityLabel={row.title} value={preferences[row.key]} disabled={Boolean(saving)} onValueChange={() => void toggle(row.key)} trackColor={{ false: colors.border, true: colors.primaryBorder }} thumbColor={preferences[row.key] ? colors.primary : colors.surface} ios_backgroundColor={colors.border} />
      </View>)}</View>}
      {Platform.OS !== "web" ? <View style={styles.testCard}>
        <View style={styles.testHeading}><View style={styles.rowIcon}><Ionicons name="phone-portrait-outline" size={20} color={colors.primaryStrong} /></View><View style={styles.flex}><Text style={styles.rowTitle}>Test this phone</Text><Text style={styles.rowText}>Checks notification permission, sound, vibration and on-screen display.</Text></View></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Send test notification" disabled={testing} style={({ pressed }) => [styles.testButton, (pressed || testing) && styles.pressed]} onPress={() => void sendTestNotification()}>{testing ? <ActivityIndicator color={colors.surface} /> : <><Ionicons name="notifications" size={18} color={colors.surface} /><Text style={styles.testButtonText}>Send test notification</Text></>}</Pressable>
        {testStatus ? <Text style={styles.testStatus}>{testStatus}</Text> : null}
      </View> : null}
      <Text style={styles.note}>Sensor alerts are accepted only from the signed-in user’s paired sensor sync. Repeated readings are grouped to avoid notification overload.</Text>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingHorizontal: spacing[4], paddingBottom: spacing[4] },
  back: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 21, backgroundColor: colors.surface },
  headerSpacer: { width: 42 },
  title: { flex: 1, color: colors.text, fontSize: typography.mobile.rawSize.s21, fontWeight: typography.weight.bold, textAlign: "center" },
  content: { paddingHorizontal: spacing[4] },
  intro: { flexDirection: "row", alignItems: "center", gap: spacing[3], padding: spacing[4], borderRadius: spacing[4], backgroundColor: colors.primarySoft },
  introIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.surface },
  introTitle: { color: colors.text, fontSize: typography.mobile.rawSize.s15, fontWeight: typography.weight.bold },
  introText: { marginTop: spacing[1], color: colors.textMuted, fontSize: typography.mobile.rawSize.s12, lineHeight: 18 },
  card: { marginTop: spacing[4], paddingHorizontal: spacing[4], borderWidth: 1, borderColor: colors.border, borderRadius: spacing[4], backgroundColor: colors.surface },
  row: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[3] },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.primarySoft },
  rowTitle: { color: colors.text, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.bold },
  rowText: { marginTop: spacing[1], color: colors.textMuted, fontSize: typography.mobile.rawSize.s11, lineHeight: 16 },
  testCard: { marginTop: spacing[4], padding: spacing[4], borderWidth: 1, borderColor: colors.primaryBorder, borderRadius: spacing[4], backgroundColor: colors.primarySoft },
  testHeading: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  testButton: { minHeight: 48, marginTop: spacing[4], flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[2], borderRadius: spacing[3], backgroundColor: colors.primary },
  testButtonText: { color: colors.surface, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.bold },
  testStatus: { marginTop: spacing[3], color: colors.textMuted, fontSize: typography.mobile.rawSize.s11, lineHeight: 17, textAlign: "center" },
  note: { marginTop: spacing[4], paddingHorizontal: spacing[2], color: colors.textSubtle, fontSize: typography.mobile.rawSize.s11, lineHeight: 17, textAlign: "center" },
  error: { marginTop: spacing[4], padding: spacing[3], borderWidth: 1, borderColor: colors.danger, borderRadius: spacing[3], backgroundColor: colors.dangerSoft },
  errorText: { color: colors.danger, fontSize: typography.mobile.size.caption, fontWeight: typography.weight.semibold },
  loader: { marginTop: spacing[12] },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
});
