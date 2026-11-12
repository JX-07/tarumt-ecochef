import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../auth/auth-provider";
import { PAGE_TOP_GAP, PageHeader } from "../../../shared/components/page-header";
import { createMobileApi } from "../../../lib/api";
import { ingredientEmojiFor } from "../../../shared/ingredient-icons";
import type { MealPlanCalendar } from "../../meal-planning/types";
import { recipeImageUrl } from "../../recipes/recipe-image";
import type { NotificationList } from "../../notifications/types";
import { type CookingGroupList } from "../../social/cooking-group";
import { freshnessAppearance, relativeTime } from "../../fridge-sensors/sensor-insights";
import type { FridgeSensorList } from "../../fridge-sensors/types";

const GREEN = colors.primary;
const INK = colors.text;
const MUTED = colors.textMuted;

type InventoryItem = { id: string; name: string; quantity: string; expiry_date: string; icon?: string };
type InventoryList = { items: InventoryItem[]; total: number; expiring_soon: number };
type SocialUser = { id: string; name: string };
type SocialState = { requests: SocialUser[]; pending: SocialUser[]; friends: SocialUser[] };

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

const isoToday = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const daysUntil = (value: string) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(value);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);
};

export function HomeScreen() {
  const { user } = useAuth();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const insets = useSafeAreaInsets();
  const firstName = user?.displayName?.trim().split(/\s+/)[0] || "Chef";
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [inventory, setInventory] = useState<InventoryList>({ items: [], total: 0, expiring_soon: 0 });
  const [todayPlan, setTodayPlan] = useState<MealPlanCalendar>();
  const [weekPlan, setWeekPlan] = useState<MealPlanCalendar>();
  const [social, setSocial] = useState<SocialState>({ requests: [], pending: [], friends: [] });
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [fridgeSensors, setFridgeSensors] = useState<FridgeSensorList>({ items: [] });
  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : !hasLoaded.current && setLoading(true);
    setError(undefined);
    try {
      const today = isoToday();
      const [nextInventory, nextWeekPlan] = await Promise.all([
        api.getMyInventory<InventoryList>(),
        api.getMyMealPlan<MealPlanCalendar>(today, 7),
      ]);
      setInventory(nextInventory);
      setTodayPlan({...nextWeekPlan,start_date:today,end_date:today,items:nextWeekPlan.items.filter(item=>item.scheduled_date===today)});
      setWeekPlan(nextWeekPlan);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Home data could not be loaded.");
    } finally {
      hasLoaded.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);
  useFocusEffect(useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    void load();
    let active = true;
    void api.getMySocial<SocialState>().then(result=>{if(active)setSocial(result);}).catch(()=>undefined);
    void api.getNotifications<NotificationList>().then(result=>{if(active)setUnreadNotifications(result.unread_count);}).catch(()=>undefined);
    void api.getFridgeSensors<FridgeSensorList>().then(result=>{if(active)setFridgeSensors(result);}).catch(()=>undefined);
    void api.getMyCookingGroups<CookingGroupList>().then(result=>setGroupMemberIds([...new Set(result.items.filter(group=>group.status==="active").flatMap(group=>group.members.filter(member=>member.status==="active").map(member=>member.id)))])).catch(()=>setGroupMemberIds([]));
    const notificationTimer = setInterval(() => {
      void api.getNotifications<NotificationList>()
        .then((next) => setUnreadNotifications(next.unread_count))
        .catch(() => undefined);
    }, 60_000);
    return () => {active=false;clearInterval(notificationTimer);};
  }, [api, load]));
  const currentInventory = inventory.items
    .filter((item) => daysUntil(item.expiry_date) >= 0)
    .sort((left, right) => left.expiry_date.localeCompare(right.expiry_date));
  const expiringSoon = currentInventory.filter((item) => daysUntil(item.expiry_date) <= 3);
  const expiryDays = expiringSoon.map((item) => daysUntil(item.expiry_date));
  const earliestExpiryDay = expiryDays.length ? Math.min(...expiryDays) : 0;
  const latestExpiryDay = expiryDays.length ? Math.max(...expiryDays) : 0;
  const expiryTitle = expiringSoon.length === 1
    ? `${expiringSoon[0].name} ${earliestExpiryDay === 0 ? "expires today" : earliestExpiryDay === 1 ? "expires tomorrow" : `expires in ${earliestExpiryDay} days`}`
    : earliestExpiryDay === latestExpiryDay
      ? `${expiringSoon.length} ingredients ${earliestExpiryDay === 0 ? "expire today" : earliestExpiryDay === 1 ? "expire tomorrow" : `expire in ${earliestExpiryDay} days`}`
      : earliestExpiryDay === 0
        ? `${expiringSoon.length} ingredients expire between today and ${latestExpiryDay} days`
        : `${expiringSoon.length} ingredients expire in ${earliestExpiryDay}–${latestExpiryDay} days`;
  const dinner = todayPlan?.items.find((item) => item.meal_slot === "dinner");
  const dinnerImageUrl = recipeImageUrl(dinner?.image_url, apiBaseUrl);
  const [dinnerImageFailed, setDinnerImageFailed] = useState(false);
  useEffect(() => { setDinnerImageFailed(false); }, [dinnerImageUrl, dinner?.recipe_id]);
  const groupFriends = social.friends.filter((friend) => groupMemberIds.includes(friend.id));
  const openProfile = () => router.push("/account" as never);
  const openGroupManager = () => router.push({ pathname: "/account", params: { section: "friends", mode: "group" } } as never);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + PAGE_TOP_GAP, paddingBottom: Math.max(insets.bottom + 105, 120) }]}
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={GREEN} colors={[GREEN]} />}
    >
      <View style={styles.header}>
        <PageHeader title={`Hello, ${firstName}!`} action={
        <Pressable
          style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
          onPress={openProfile}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
        >
          <Ionicons name="person" size={23} color={palette.c9aa3ae} />
        </Pressable>
        } />
      </View>

      {error && <Pressable style={styles.errorCard} onPress={() => void load()}><Ionicons name="cloud-offline-outline" size={18} color={palette.cb42331} /><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable>}
      {loading ? <ActivityIndicator style={styles.loading} color={GREEN} /> : <><View style={[styles.impactCard, styles.shadow]}>
        <View>
          <Text style={styles.impactEyebrow}>This week’s kitchen</Text>
          <View style={styles.impactValueRow}>
            <Text style={styles.impactValue}>{weekPlan?.items.length ?? 0}</Text>
            <Text style={styles.impactUnit}>meals planned</Text>
          </View>
          <View style={styles.improvementPill}>
            <Ionicons name="leaf-outline" size={11} color={palette.cffffff} />
            <Text style={styles.improvementText}>{inventory.expiring_soon} ingredient{inventory.expiring_soon === 1 ? "" : "s"} expiring soon</Text>
          </View>
        </View>
        <View style={styles.healthScore}>
          <Text style={styles.healthNumber}>{inventory.total}</Text>
          <Text style={styles.healthLabel}>ITEMS</Text>
        </View>
      </View>

      {expiringSoon.length > 0 && <Pressable style={({ pressed }) => [styles.expiryCard, pressed && styles.pressed]} onPress={() => router.push("/ingredients" as never)}>
        <View style={styles.expiryIcon}><Ionicons name="warning-outline" size={18} color={colors.warning} /></View>
        <View style={styles.flex}>
          <Text style={styles.expiryTitle}>{expiryTitle}</Text>
          <Text style={styles.helper}>Review your Ingredient List before these items expire.</Text>
        </View>
        <Text style={styles.cookLink}>View</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.warningStrong} />
      </Pressable>}

      <Pressable
        style={({ pressed }) => [styles.notificationCard, pressed && styles.pressed]}
        onPress={() => router.push("/notifications" as never)}
        accessibilityRole="button"
        accessibilityLabel={unreadNotifications ? `${unreadNotifications} unread notifications` : "Open notifications"}
      >
        <View style={styles.notificationIcon}>
          <Ionicons name={unreadNotifications ? "notifications" : "notifications-outline"} size={20} color={colors.warning} />
          {unreadNotifications > 0 ? <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{Math.min(unreadNotifications, 99)}</Text></View> : null}
        </View>
        <View style={styles.flex}>
          <Text style={styles.notificationTitle}>Notifications</Text>
          <Text style={styles.notificationCopy}>{unreadNotifications ? `${unreadNotifications} new kitchen update${unreadNotifications === 1 ? "" : "s"}` : "No new kitchen updates"}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
      </Pressable>

      <SectionHeader title="GAS SENSOR" action={fridgeSensors.items.length ? "Manage" : undefined} onAction={() => router.push("/fridge-sensors" as never)} />
      {fridgeSensors.items.length === 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Connect the gas sensor set"
          style={({ pressed }) => [styles.sensorEmptyCard, pressed && styles.pressed]}
          onPress={() => router.push("/fridge-sensors" as never)}
        >
          <View style={styles.sensorEmptyIcon}><MaterialCommunityIcons name="fridge-outline" size={27} color={colors.primaryStrong} /></View>
          <View style={styles.flex}><Text style={styles.sensorEmptyTitle}>Connect your gas sensor set</Text><Text style={styles.sensorEmptyText}>Tap here to connect and test every gas, temperature and humidity sensor.</Text></View>
          <Ionicons name="chevron-forward" size={17} color={colors.primaryStrong} />
        </Pressable>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sensorCards}>
          {fridgeSensors.items.map((sensor) => {
            const reading = sensor.latest_reading;
            const freshness = freshnessAppearance[reading?.freshness_status ?? "unknown"];
            return <Pressable
              key={sensor.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${sensor.fridge_name} Fridge Sensor`}
              style={({ pressed }) => [styles.sensorCard, pressed && styles.pressed]}
              onPress={() => router.push(`/fridge-sensors/${sensor.id}` as never)}
            >
              <View style={styles.sensorCardTop}>
                <View style={styles.sensorFridgeIcon}><MaterialCommunityIcons name="fridge-outline" size={22} color={colors.primaryStrong} /></View>
                <View style={styles.flex}><Text style={styles.sensorCardName}>{sensor.fridge_name}</Text><Text style={styles.sensorCardDevice}>{sensor.sensor_name}</Text></View>
                <View style={[styles.sensorStatus, { backgroundColor: freshness.tint }]}><View style={[styles.sensorStatusDot, { backgroundColor: freshness.color }]} /><Text style={[styles.sensorStatusText, { color: freshness.color }]}>{freshness.label}</Text></View>
              </View>
              <View style={styles.sensorMetricRow}>
                <View><Text style={styles.sensorMetricValue}>{reading ? `${reading.temperature_c.toFixed(1)}°` : "—"}</Text><Text style={styles.sensorMetricLabel}>Temperature</Text></View>
                <View style={styles.sensorMetricDivider} />
                <View><Text style={styles.sensorMetricValue}>{reading ? `${Math.round(reading.humidity_percent)}%` : "—"}</Text><Text style={styles.sensorMetricLabel}>Humidity</Text></View>
                <View style={styles.sensorMetricDivider} />
                <View><Text style={styles.sensorMetricValue}>{sensor.connection_status === "online" ? "Live" : sensor.connection_status === "waiting" ? "New" : "Offline"}</Text><Text style={styles.sensorMetricLabel}>{relativeTime(sensor.last_seen_at)}</Text></View>
              </View>
            </Pressable>;
          })}
        </ScrollView>
      )}

      <SectionHeader title="INGREDIENT LIST" action="Manage" onAction={() => router.push("/ingredients" as never)} />
      {currentInventory.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ingredients}>
        {currentInventory.map((ingredient) => {
          const days = daysUntil(ingredient.expiry_date), warning = days <= 3;
          return <Pressable key={ingredient.id} style={({ pressed }) => [styles.ingredientCard, warning && styles.warningCard, pressed && styles.pressed]} onPress={() => router.push("/ingredients" as never)}>
            <Text style={styles.ingredientEmoji}>{ingredient.icon || ingredientEmojiFor(ingredient.name)}</Text>
            <Text style={styles.ingredientName} numberOfLines={1}>{ingredient.name}</Text>
            <View style={[styles.lifeBadge, warning && styles.warningBadge]}>
              <Text style={[styles.lifeText, warning && styles.warningText]}>{days === 0 ? "Expires today" : `${days}d left`}</Text>
            </View>
          </Pressable>;
        })}
      </ScrollView> : <EmptyCard text="Your Ingredient List is empty." action="Add ingredients" onPress={() => router.push("/ingredients" as never)} />}

      <SectionHeader title="MEAL PLANNING" action="Manage" onAction={() => router.push("/(tabs)/plan")} />
      {dinner ? <View style={[styles.dinnerCard, styles.shadow]}>
        <View style={styles.dinnerVisual}>
          {dinnerImageUrl && !dinnerImageFailed ? <Image source={{ uri: dinnerImageUrl }} style={styles.dinnerImage} resizeMode="cover" onError={() => setDinnerImageFailed(true)} accessibilityLabel={`${dinner.title} recipe photo`} /> : <><View style={styles.foodGlow} /><Text style={styles.dinnerFallback}>🍽️</Text></>}
          <View style={styles.dinnerCaption}>
            <View>
              <Text style={styles.dinnerTitle}>{dinner.title}</Text>
              {dinner.shared_group_id ? <Text style={styles.dinnerCopy}>Group Schedule · Added by {dinner.added_by_name ?? "group member"}</Text> : null}
              <Text style={styles.dinnerCopy}>{dinner.scheduled_time ? `Planned for ${new Date(`2000-01-01T${dinner.scheduled_time}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Planned for dinner"}</Text>
            </View>
            <View style={styles.timePill}><Text style={styles.timeText}>{dinner.total_time} min</Text></View>
          </View>
        </View>
        <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]} onPress={() => router.push(`/recipes/${dinner.recipe_id}`)}>
          <Text style={styles.primaryButtonText}>Start Cooking</Text>
        </Pressable>
      </View> : <Pressable accessibilityRole="button" accessibilityLabel="Open meal planning" style={({ pressed }) => [styles.emptyCard, pressed && styles.pressed]} onPress={() => router.push("/(tabs)/plan")}><Text style={styles.emptyText}>No dinner is planned for today.</Text><Text style={styles.sectionAction}>Plan dinner</Text></Pressable>}

      <SectionHeader title="GROUP" />
      <View style={[styles.groupCard, styles.shadow]}>
        <View style={styles.groupTop}>
          <View>
            <Text style={styles.groupTitle}>Your cooking friends</Text>
            <Text style={styles.helper}>{groupFriends.length} friend{groupFriends.length === 1 ? "" : "s"} in your group</Text>
          </View>
          <View style={styles.avatars}>
            {groupFriends.slice(0, 3).map((member, index) => (
              <View key={member.id} style={[styles.memberAvatar, { backgroundColor: [palette.cbdf3da, palette.cffd8b7, palette.ccbeaff][index], marginLeft: index ? -7 : 0 }]}> 
                <Text style={styles.memberInitial}>{member.name.trim().charAt(0).toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </View>
        {groupFriends.length > 0 && <View style={styles.sharedList}>
          <View style={styles.sharedListHeading}>
            <MaterialCommunityIcons name="account-multiple-outline" size={17} color={palette.c59667a} />
            <Text style={styles.sharedListTitle}>FRIENDS</Text>
          </View>
          <View style={styles.chips}>
            {groupFriends.map((friend) => <View key={friend.id} style={styles.chip}><Text style={styles.chipText}>{friend.name}</Text></View>)}
          </View>
        </View>}
        <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]} onPress={openGroupManager}>
          <Text style={styles.primaryButtonText}>{groupFriends.length ? "Manage group" : "Add a cooking friend"}</Text>
        </Pressable>
      </View>
      </>}
    </ScrollView>
  );
}

function EmptyCard({ text, action, onPress }: { text: string; action: string; onPress: () => void }) {
  return <View style={styles.emptyCard}><Text style={styles.emptyText}>{text}</Text><Pressable onPress={onPress}><Text style={styles.sectionAction}>{action}</Text></Pressable></View>;
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text>{action && <Pressable onPress={onAction} hitSlop={10}><Text style={styles.sectionAction}>{action}</Text></Pressable>}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  content: { paddingHorizontal: 18, paddingBottom: 112 },
  flex: { flex: 1 },
  header: { marginBottom: 16 },
  loading: { marginVertical: 72 },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, padding: 12, borderWidth: 1, borderColor: colors.danger, borderRadius: 14, backgroundColor: colors.dangerSoft },
  errorText: { flex: 1, color: colors.danger, fontSize: typography.mobile.rawSize.s11, lineHeight: 16, fontWeight: typography.weight.bold },
  avatar: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21, backgroundColor: palette.ceceeef },
  notificationCard: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 11, marginTop: 14, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface },
  notificationIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.warningSoft },
  notificationTitle: { color: INK, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold },
  notificationCopy: { marginTop: 2, color: MUTED, fontSize: typography.mobile.rawSize.s10 },
  notificationBadge: { position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 3, borderWidth: 2, borderColor: colors.surface, borderRadius: 9, backgroundColor: colors.warningStrong },
  notificationBadgeText: { color: colors.surface, fontSize: typography.mobile.rawSize.s8, fontWeight: typography.weight.extrabold },
  pressed: { opacity: 0.72 },
  shadow: { shadowColor: palette.c26372e, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 },
  impactCard: { minHeight: 126, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18, borderRadius: 22, backgroundColor: colors.primary, overflow: "hidden" },
  impactEyebrow: { color: palette.cd7f8e3, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.semibold },
  impactValueRow: { flexDirection: "row", alignItems: "flex-end", gap: 5, marginTop: 5 },
  impactValue: { color: palette.cffffff, fontSize: typography.mobile.rawSize.s34, lineHeight: 39, fontWeight: typography.weight.extrabold },
  impactUnit: { marginBottom: 5, color: palette.ce7faed, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.bold },
  improvementPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, marginTop: 7, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: palette.crgba_255_255_255_0_2 },
  improvementText: { color: palette.cffffff, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.bold },
  healthScore: { width: 63, height: 63, alignItems: "center", justifyContent: "center", borderRadius: 32, borderWidth: 1, borderColor: palette.crgba_255_255_255_0_35, backgroundColor: palette.crgba_255_255_255_0_15 },
  healthNumber: { color: palette.cffffff, fontSize: typography.mobile.rawSize.s22, fontWeight: typography.weight.extrabold },
  healthLabel: { color: palette.cddf7e6, fontSize: typography.mobile.rawSize.s8, fontWeight: typography.weight.bold },
  expiryCard: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 13, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: colors.warningBorder, borderRadius: 18, backgroundColor: colors.warningSoft },
  expiryIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: colors.surface },
  expiryTitle: { color: palette.c344154, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold },
  helper: { marginTop: 3, color: MUTED, fontSize: typography.mobile.rawSize.s11, lineHeight: 15 },
  cookLink: { color: colors.warningStrong, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.extrabold },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 10 },
  sectionTitle: { color: palette.c68758a, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold, letterSpacing: 0.7 },
  sectionAction: { color: colors.primaryStrong, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.extrabold },
  sensorEmptyCard: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderWidth: 1, borderColor: colors.primaryBorder, borderRadius: 19, backgroundColor: colors.surface },
  sensorEmptyIcon: { width: 50, height: 50, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.primarySoft },
  sensorEmptyTitle: { color: INK, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.extrabold },
  sensorEmptyText: { marginTop: 3, color: MUTED, fontSize: typography.mobile.rawSize.s11, lineHeight: 16 },
  sensorCards: { gap: 10, paddingRight: 18 },
  sensorCard: { width: 304, minHeight: 136, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface, elevation: 2 },
  sensorCardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  sensorFridgeIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.primarySoft },
  sensorCardName: { color: INK, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.extrabold },
  sensorCardDevice: { marginTop: 2, color: MUTED, fontSize: typography.mobile.rawSize.s10 },
  sensorStatus: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 10 },
  sensorStatusDot: { width: 6, height: 6, borderRadius: 3 },
  sensorStatusText: { fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold },
  sensorMetricRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  sensorMetricValue: { color: INK, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.extrabold },
  sensorMetricLabel: { maxWidth: 82, marginTop: 2, color: colors.textSubtle, fontSize: typography.mobile.rawSize.s9 },
  sensorMetricDivider: { width: 1, height: 28, backgroundColor: colors.border },
  ingredients: { gap: 10, paddingRight: 18 },
  ingredientCard: { width: 106, minHeight: 110, alignItems: "center", justifyContent: "center", padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 19, backgroundColor: colors.surface, elevation: 2 },
  warningCard: { borderColor: colors.warningBorder },
  ingredientEmoji: { fontSize: typography.mobile.rawSize.s28 },
  ingredientName: { marginTop: 5, color: palette.c3b4658, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.bold },
  lifeBadge: { marginTop: 7, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 9, backgroundColor: colors.primarySoft },
  warningBadge: { backgroundColor: colors.warningSoft },
  lifeText: { color: colors.primaryStrong, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold },
  warningText: { color: colors.warningStrong },
  dinnerCard: { overflow: "hidden", borderRadius: 22, backgroundColor: colors.surface },
  dinnerVisual: { height: 170, justifyContent: "flex-end", backgroundColor: palette.cb8d7b0, overflow: "hidden" },
  dinnerImage: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" },
  dinnerFallback: { position: "absolute", alignSelf: "center", top: 42, fontSize: typography.mobile.rawSize.s62 },
  foodGlow: { position: "absolute", alignSelf: "center", top: -34, width: 245, height: 210, borderRadius: 125, backgroundColor: palette.ce6c783, transform: [{ rotate: "-8deg" }] },
  foodEmoji: { position: "absolute", fontSize: typography.mobile.rawSize.s58 },
  dinnerCaption: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", padding: 15, backgroundColor: palette.crgba_15_28_30_0_64 },
  dinnerTitle: { color: palette.cffffff, fontSize: typography.mobile.rawSize.s17, fontWeight: typography.weight.extrabold },
  dinnerCopy: { marginTop: 2, color: palette.ce5e9e7, fontSize: typography.mobile.rawSize.s10 },
  timePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: palette.cffffff },
  timeText: { color: palette.c384255, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.extrabold },
  primaryButton: { height: 45, alignItems: "center", justifyContent: "center", margin: 13, borderRadius: 13, backgroundColor: GREEN },
  primaryPressed: { backgroundColor: palette.c118c45, transform: [{ scale: 0.99 }] },
  primaryButtonText: { color: palette.cffffff, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.extrabold },
  groupCard: { padding: 15, borderRadius: 22, backgroundColor: colors.surface },
  groupTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupTitle: { color: INK, fontSize: typography.mobile.rawSize.s17, fontWeight: typography.weight.extrabold },
  avatars: { flexDirection: "row", alignItems: "center" },
  memberAvatar: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: palette.cffffff, borderRadius: 15 },
  memberInitial: { color: palette.c31605a, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.extrabold },
  groupMetrics: { flexDirection: "row", gap: 9, marginTop: 14 },
  groupMetric: { flex: 1, padding: 12, borderRadius: 14 },
  greenEyebrow: { color: palette.c179052, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold },
  purpleEyebrow: { color: palette.c7253d6, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold },
  groupMetricValue: { marginTop: 5, color: palette.c253348, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold },
  sharedList: { marginTop: 12, padding: 11, borderWidth: 1, borderColor: palette.ce7e9e7, borderRadius: 14, backgroundColor: palette.cfafbfa },
  sharedListHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  sharedListTitle: { color: palette.c59667a, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.extrabold },
  synced: { marginLeft: "auto", color: GREEN, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  chip: { paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: palette.ce1e5e2, borderRadius: 12, backgroundColor: palette.cffffff },
  chipText: { color: palette.c566173, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.semibold },
  emptyCard: { minHeight: 82, alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface },
  emptyText: { color: MUTED, fontSize: typography.mobile.rawSize.s11, textAlign: "center" },
});
