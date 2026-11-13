import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import type { EcoChefNotification, NotificationCategory, NotificationList } from "../types";

const appearance: Record<
  NotificationCategory,
  { icon: keyof typeof Ionicons.glyphMap; tint: string; color: string }
> = {
  sensor_alert: { icon: "hardware-chip-outline", tint: colors.dangerSoft, color: colors.danger },
  ingredient_expiry: {
    icon: "warning-outline",
    tint: colors.marketSoft,
    color: colors.marketStrong,
  },
  meal_reminder: { icon: "restaurant-outline", tint: colors.todaySoft, color: colors.todayStrong },
  payment: { icon: "checkmark-circle-outline", tint: colors.successSoft, color: colors.success },
  moderation: {
    icon: "shield-checkmark-outline",
    tint: colors.adminSoft,
    color: colors.adminStrong,
  },
  order: { icon: "bag-check-outline", tint: colors.primarySoft, color: colors.primaryStrong },
  promotion: { icon: "pricetag-outline", tint: colors.marketSoft, color: colors.marketStrong },
  delivery: { icon: "bicycle-outline", tint: colors.primarySoft, color: colors.primaryStrong },
};

const relativeTime = (value: string) => {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7
    ? `${days}d`
    : new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export function NotificationsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [data, setData] = useState<NotificationList>({ items: [], unread_count: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (refresh = false) => {
      refresh ? setRefreshing(true) : setLoading(true);
      setError(undefined);
      try {
        setData(await api.getNotifications<NotificationList>());
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : "Notifications could not be loaded.",
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
      const refreshTimer = setInterval(() => {
        void api
          .getNotifications<NotificationList>()
          .then(setData)
          .catch(() => undefined);
      }, 60_000);
      return () => clearInterval(refreshTimer);
    }, [api, load]),
  );

  const openNotification = async (item: EcoChefNotification) => {
    if (!item.read_at) {
      setData((current) => ({
        items: current.items.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, read_at: new Date().toISOString() }
            : candidate,
        ),
        unread_count: Math.max(0, current.unread_count - 1),
      }));
      try {
        await api.markNotificationRead(item.id);
      } catch {
        void load();
      }
    }
    if (item.action_path) router.push(item.action_path as never);
  };

  const markAllRead = async () => {
    const readAt = new Date().toISOString();
    setData((current) => ({
      items: current.items.map((item) => ({ ...item, read_at: item.read_at ?? readAt })),
      unread_count: 0,
    }));
    try {
      await api.markAllNotificationsRead();
    } catch {
      void load();
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>
            {data.unread_count ? `${data.unread_count} unread` : "You’re all caught up"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          onPress={() => router.push("/notifications/settings" as never)}
        >
          <Ionicons name="options-outline" size={21} color={colors.primaryStrong} />
        </Pressable>
      </View>

      {data.unread_count > 0 && (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}
          onPress={() => void markAllRead()}
        >
          <Ionicons name="checkmark-done-outline" size={17} color={colors.primaryStrong} />
          <Text style={styles.markAllText}>Mark all as read</Text>
        </Pressable>
      )}

      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      ) : (
        <FlatList
          data={data.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + spacing[8] },
            data.items.length === 0 && styles.emptyList,
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
            error ? (
              <Pressable style={styles.error} onPress={() => void load()}>
                <Text style={styles.errorText}>{error} Tap to retry.</Text>
              </Pressable>
            ) : undefined
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="notifications-outline" size={32} color={colors.primaryStrong} />
              </View>
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptyText}>
                Sensor alerts, fresh-food reminders, meals, payments and deliveries will appear
                here.
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => {
            const look = appearance[item.category];
            const unread = !item.read_at;
            return (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.item,
                  unread && styles.unreadItem,
                  pressed && styles.pressed,
                ]}
                onPress={() => void openNotification(item)}
              >
                <View style={[styles.icon, { backgroundColor: look.tint }]}>
                  <Ionicons name={look.icon} size={21} color={look.color} />
                </View>
                <View style={styles.itemCopy}>
                  <View style={styles.itemTitleRow}>
                    <Text
                      style={[styles.itemTitle, unread && styles.unreadTitle]}
                      numberOfLines={2}
                    >
                      {item.title}
                    </Text>
                    <Text style={styles.time}>{relativeTime(item.created_at)}</Text>
                  </View>
                  <Text style={styles.message} numberOfLines={3}>
                    {item.message}
                  </Text>
                </View>
                {unread ? <View accessibilityLabel="Unread" style={styles.unreadDot} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
    backgroundColor: colors.consumerCanvas,
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 21,
    backgroundColor: colors.surface,
  },
  headerCopy: { flex: 1 },
  title: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s25,
    lineHeight: 31,
    fontWeight: typography.weight.bold,
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: typography.mobile.size.caption,
  },
  markAll: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  markAllText: {
    color: colors.primaryStrong,
    fontSize: typography.mobile.size.caption,
    fontWeight: typography.weight.bold,
  },
  list: { paddingHorizontal: spacing[4] },
  emptyList: { flexGrow: 1 },
  item: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  unreadItem: { borderColor: colors.primaryBorder, backgroundColor: colors.surface },
  icon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  itemCopy: { flex: 1 },
  itemTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  itemTitle: {
    flex: 1,
    color: colors.text,
    fontSize: typography.mobile.rawSize.s14,
    lineHeight: 19,
    fontWeight: typography.weight.semibold,
  },
  unreadTitle: { fontWeight: typography.weight.extrabold },
  message: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s12,
    lineHeight: 18,
  },
  time: {
    color: colors.textSubtle,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.semibold,
  },
  unreadDot: {
    width: 8,
    height: 8,
    marginTop: spacing[1],
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  separator: { height: spacing[3] },
  loader: { marginTop: spacing[16] },
  error: {
    marginBottom: spacing[3],
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
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing[8] },
  emptyIcon: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 34,
    backgroundColor: colors.primarySoft,
  },
  emptyTitle: {
    marginTop: spacing[4],
    color: colors.text,
    fontSize: typography.mobile.size.bodyTextHeavy,
    fontWeight: typography.weight.bold,
  },
  emptyText: {
    marginTop: spacing[2],
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 20,
    textAlign: "center",
  },
  pressed: { opacity: 0.7 },
});
