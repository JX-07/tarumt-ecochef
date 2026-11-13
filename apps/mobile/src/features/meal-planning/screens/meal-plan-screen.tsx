import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";

import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { AppMessageModal } from "../../../shared/components/app-message-modal";
import { PAGE_TOP_GAP, PageHeader } from "../../../shared/components/page-header";
import type { MealPlanCalendar, MealPlanEntry, MealSlot, PlannedShoppingList } from "../types";
import { ShoppingListSheet, type ShoppingCompletionItem } from "../components/shopping-list-sheet";
import { displayMealTime, TimePickerSheet } from "../components/time-picker-sheet";
import { DatePickerSheet } from "../components/date-picker-sheet";
import { getCookedMeals, wasMealCooked } from "../cooking-history";
import { ingredientEmojiFor } from "../../../shared/ingredient-icons";
import { registerShoppingReturn } from "../shopping-return";

const GREEN = palette.c12ad55;
const slots: {
  value: MealSlot;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: "drink", label: "Drink", icon: "water-outline" },
  { value: "breakfast", label: "Breakfast", icon: "sunny-outline" },
  { value: "brunch", label: "Brunch", icon: "cafe-outline" },
  { value: "lunch", label: "Lunch", icon: "restaurant-outline" },
  { value: "teatime", label: "Teatime", icon: "leaf-outline" },
  { value: "dinner", label: "Dinner", icon: "moon-outline" },
  { value: "dessert", label: "Dessert", icon: "ice-cream-outline" },
  { value: "snacks", label: "Snack", icon: "nutrition-outline" },
];
const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parseDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const addDays = (date: Date, days: number) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};
const weekStart = (date: Date) =>
  addDays(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    -((date.getDay() + 6) % 7),
  );
const friendly = (value: string) =>
  parseDate(value).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

export function MealPlanScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ date?: string; shopping?: string }>();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [selected, setSelected] = useState(() => iso(new Date()));
  const [calendar, setCalendar] = useState<MealPlanCalendar>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<MealPlanEntry>();
  const editSheetMotion = useBottomSheetSlide(Boolean(editing));
  const [editDate, setEditDate] = useState("");
  const [editSlot, setEditSlot] = useState<MealSlot>("dinner");
  const [editTime, setEditTime] = useState("");
  const [editTimeOpen, setEditTimeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    title: string;
    message: string;
    tone: "success" | "error" | "info";
  }>();
  const [shoppingOpen, setShoppingOpen] = useState(false);
  const [weekCalendarOpen, setWeekCalendarOpen] = useState(false);
  const [editCalendarOpen, setEditCalendarOpen] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [cooked, setCooked] = useState<Set<string>>(new Set());
  const [dayShopping, setDayShopping] = useState<PlannedShoppingList>();
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setCalendar(await api.getMyMealPlan<MealPlanCalendar>(iso(start)));
    } catch (next) {
      setError(next instanceof Error ? next.message : "Your meal plan could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [api, start]);
  const loadShopping = useCallback(
    (from: string, to: string) => api.getMyShoppingList<PlannedShoppingList>(from, to),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(
    () =>
      navigation.addListener("focus", () => {
        void load();
        void getCookedMeals().then(setCooked);
      }),
    [navigation, load],
  );
  useEffect(() => {
    if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
      const date = parseDate(params.date);
      setSelected(params.date);
      setStart(weekStart(date));
    }
  }, [params.date]);
  useEffect(() => {
    if (params.shopping === "1") {
      setShoppingOpen(true);
      router.setParams({ shopping: "" });
    }
  }, [params.shopping]);
  useEffect(
    () =>
      registerShoppingReturn((returnDate) => {
        if (returnDate && /^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
          const date = parseDate(returnDate);
          setSelected(returnDate);
          setStart(weekStart(date));
        }
        setShoppingOpen(true);
      }),
    [],
  );
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(start, index)),
    [start],
  );
  const items = calendar?.items.filter((item) => item.scheduled_date === selected) ?? [];
  const visibleTimelineSlots = slots.filter(
    (slot) =>
      ["breakfast", "lunch", "dinner"].includes(slot.value) ||
      items.some((item) => item.meal_slot === slot.value),
  );
  const timelineSlots = items.some((item) => item.scheduled_time)
    ? [...visibleTimelineSlots].sort((left, right) => {
        const firstTime = (slot: MealSlot) =>
          items
            .filter((item) => item.meal_slot === slot && item.scheduled_time)
            .map((item) => item.scheduled_time!)
            .sort()[0];
        const leftTime = firstTime(left.value);
        const rightTime = firstTime(right.value);
        if (leftTime && rightTime) return leftTime.localeCompare(rightTime);
        if (leftTime) return -1;
        if (rightTime) return 1;
        return slots.indexOf(left) - slots.indexOf(right);
      })
    : visibleTimelineSlots;
  const totalCookTime = items.reduce((sum, item) => sum + item.total_time, 0);
  useEffect(() => {
    let active = true;
    setDayShopping(undefined);
    void api
      .getMyShoppingList<PlannedShoppingList>(selected, selected)
      .then((result) => {
        if (active) setDayShopping(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, selected, calendar]);
  function changeWeek(offset: number) {
    const next = addDays(start, offset * 7);
    setStart(next);
    setSelected(iso(next));
  }
  function chooseDate(value: string) {
    const date = parseDate(value);
    setSelected(value);
    setStart(weekStart(date));
    setWeekCalendarOpen(false);
  }
  function openEdit(item: MealPlanEntry) {
    setEditing(item);
    setEditDate(item.scheduled_date);
    setEditSlot(item.meal_slot);
    setEditTime(item.scheduled_time?.slice(0, 5) ?? "");
  }
  async function saveEdit() {
    if (!editing || saving) return;
    setSaving(true);
    try {
      await api.updateMealPlanEntry(editing.id, {
        scheduled_date: editDate,
        meal_slot: editSlot,
        scheduled_time: editTime || null,
      });
      setEditing(undefined);
      await load();
      setMessage({
        title: "Meal updated",
        message: "Your calendar has been updated.",
        tone: "success",
      });
    } catch (next) {
      setMessage({
        title: "Meal not updated",
        message: next instanceof Error ? next.message : "Please try again.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!editing || saving) return;
    setRemoveConfirm(false);
    setSaving(true);
    try {
      await api.removeMealPlanEntry(editing.id);
      setEditing(undefined);
      await load();
      setMessage({
        title: "Meal removed",
        message: "The recipe was removed from your plan.",
        tone: "success",
      });
    } catch (next) {
      setMessage({
        title: "Meal not removed",
        message: next instanceof Error ? next.message : "Please try again.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <View style={[styles.root, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
      <View style={styles.header}>
        <PageHeader
          title="Meal Plan"
          action={
            <Pressable
              accessibilityLabel="Open shopping list"
              style={styles.listButton}
              onPress={() => setShoppingOpen(true)}
            >
              <Ionicons name="basket-outline" size={15} color={palette.cfff} />
              <Text style={styles.listButtonText}>List</Text>
            </Pressable>
          }
        />
      </View>
      {/* @ts-ignore monthButton is attached below to keep the compact screen stylesheet stable. */}
      <View style={styles.calendarLayer}>
        <View style={styles.weekHead}>
          <Pressable style={styles.arrow} onPress={() => changeWeek(-1)}>
            <Ionicons name="chevron-back" size={23} color={palette.c6f7d8d} />
          </Pressable>
          <Pressable style={styles.monthButton} onPress={() => setWeekCalendarOpen(true)}>
            <Text style={styles.month}>
              {start.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}{" "}
              –{" "}
              {addDays(start, 6).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
            <Ionicons name="calendar-outline" size={14} color={GREEN} />
          </Pressable>
          <Pressable style={styles.arrow} onPress={() => changeWeek(1)}>
            <Ionicons name="chevron-forward" size={23} color={palette.c6f7d8d} />
          </Pressable>
        </View>
        <View style={styles.days}>
          {days.map((day) => {
            const value = iso(day),
              active = value === selected,
              count = calendar?.items.filter((item) => item.scheduled_date === value).length ?? 0;
            return (
              <Pressable
                key={value}
                style={[styles.day, active && styles.dayActive]}
                onPress={() => setSelected(value)}
              >
                <Text style={[styles.dayName, active && styles.dayTextActive]}>
                  {day.toLocaleDateString(undefined, { weekday: "narrow" })}
                </Text>
                <Text style={[styles.dayNumber, active && styles.dayTextActive]}>
                  {day.getDate()}
                </Text>
                {count > 0 && (
                  <View style={[styles.dot, active && styles.dotActive]}>
                    <Text style={styles.dotText}>{count}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + 105, 120) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={GREEN} />
            <Text style={styles.stateCopy}>Loading your plan…</Text>
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Ionicons name="cloud-offline-outline" size={38} color={palette.c9aa4b2} />
            <Text style={styles.stateTitle}>Couldn’t load your plan</Text>
            <Text style={styles.stateCopy}>{error}</Text>
            <Pressable style={styles.retry} onPress={() => void load()}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.nutrition}>
              <Text style={styles.panelLabel}>TODAY’S PLAN</Text>
              <View style={styles.summaryRow}>
                <PlanMetric
                  icon="restaurant-outline"
                  value={items.length}
                  label="Meals planned"
                  color={palette.c168a4a}
                  tint={palette.ce9f8ef}
                />
                <PlanMetric
                  icon="time-outline"
                  value={totalCookTime}
                  suffix=" min"
                  label="Cooking time"
                  color={palette.c417fcb}
                  tint={palette.ceaf3fe}
                />
                <PlanMetric
                  icon="cart-outline"
                  value={dayShopping?.missing_count ?? 0}
                  label="Missing items"
                  color={palette.cd66b35}
                  tint={palette.cfff1e7}
                />
              </View>
              <Pressable style={styles.shoppingSummary} onPress={() => setShoppingOpen(true)}>
                <Ionicons name="basket-outline" size={15} color={GREEN} />
                <Text style={styles.shoppingSummaryText}>
                  {dayShopping
                    ? `${dayShopping.available_count} ingredient${dayShopping.available_count === 1 ? "" : "s"} already in your kitchen`
                    : "Checking your kitchen inventory…"}
                </Text>
                <Ionicons name="chevron-forward" size={15} color={palette.c8b97a3} />
              </Pressable>
            </View>
            <View style={styles.timelineHead}>
              <Text style={styles.panelLabel}>TODAY’S TIMELINE</Text>
              <Text style={styles.orderHint}>Earliest to latest</Text>
            </View>
            {timelineSlots.map((slot, index, visibleSlots) => {
              const slotItems = items.filter((item) => item.meal_slot === slot.value);
              return (
                <View key={slot.value} style={styles.timelineRow}>
                  <View style={styles.timeColumn}>
                    <Text style={styles.timelineTime}>
                      {slotItems[0]?.scheduled_time
                        ? displayMealTime(slotItems[0].scheduled_time)
                        : "--:--"}
                    </Text>
                    <View style={styles.timelineDot} />
                    {index < visibleSlots.length - 1 && <View style={styles.timelineLine} />}
                  </View>
                  <View style={styles.timelineBody}>
                    <Text style={styles.slotTitle}>{slot.label}</Text>
                    {slotItems.length ? (
                      slotItems.map((item) => (
                        <Pressable
                          key={item.id}
                          style={styles.card}
                          onPress={() =>
                            router.push({
                              pathname: "/recipes/[recipeId]",
                              params: { recipeId: item.recipe_id },
                            })
                          }
                        >
                          {item.image_url ? (
                            <Image source={{ uri: item.image_url }} style={styles.image} />
                          ) : (
                            <View style={styles.imageFallback}>
                              <Text style={styles.food}>🍽️</Text>
                            </View>
                          )}
                          <View style={styles.cardBody}>
                            {item.shared_group_id ? (
                              <Text style={[styles.metaText, { color: colors.primaryStrong }]}>
                                Group Schedule · Added by {item.added_by_name ?? "group member"}
                              </Text>
                            ) : null}
                            {item.shared_group_id && item.shared_group_name ? (
                              <Text style={styles.metaText}>From {item.shared_group_name}</Text>
                            ) : null}
                            <Text style={styles.cardTitle} numberOfLines={2}>
                              {item.title}
                            </Text>
                            <Text style={styles.metaText}>{item.total_time} min</Text>
                          </View>
                          <Pressable
                            style={styles.cookAction}
                            onPress={(event) => {
                              event.stopPropagation();
                              router.push({
                                pathname: "/recipes/[recipeId]/cook",
                                params: {
                                  recipeId: item.recipe_id,
                                  plannedDate: item.scheduled_date,
                                },
                              });
                            }}
                          >
                            <Text style={styles.cookActionText}>
                              {wasMealCooked(cooked, item.recipe_id, item.scheduled_date)
                                ? "Cook again"
                                : "Cook now"}
                            </Text>
                          </Pressable>
                          <Pressable
                            disabled={item.can_edit === false}
                            accessibilityElementsHidden={item.can_edit === false}
                            accessibilityLabel={`Edit ${item.title}`}
                            style={[styles.more, item.can_edit === false && { display: "none" }]}
                            onPress={(event) => {
                              event.stopPropagation();
                              openEdit(item);
                            }}
                          >
                            <Ionicons name="pencil-outline" size={17} color={palette.ca4acb5} />
                          </Pressable>
                        </Pressable>
                      ))
                    ) : (
                      <Pressable
                        style={styles.quickAdd}
                        onPress={() => router.push("/(tabs)/recipes")}
                      >
                        <Ionicons name="add" size={17} color={palette.c95a0af} />
                        <Text style={styles.quickAddText}>Quick Add · {slot.label}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
      <Modal
        visible={Boolean(editing)}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(undefined)}
      >
        <View style={styles.overlay}>
          <Animated.View
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }, editSheetMotion]}
          >
            <View style={styles.sheetHead}>
              <View>
                <Text style={styles.sheetTitle}>Edit planned meal</Text>
                <Text style={styles.sheetCopy} numberOfLines={1}>
                  {editing?.title}
                </Text>
              </View>
              <Pressable style={styles.close} onPress={() => setEditing(undefined)}>
                <Ionicons name="close" size={19} color={palette.c5b6778} />
              </Pressable>
            </View>
            <Text style={styles.label}>DATE</Text>
            <Pressable style={editTimeStyles.input} onPress={() => setEditCalendarOpen(true)}>
              <Text style={editTimeStyles.text}>{friendly(editDate)}</Text>
              <Ionicons name="calendar-outline" size={18} color={GREEN} />
            </Pressable>
            <Text style={styles.label}>MEAL</Text>
            <View style={styles.slotChoices}>
              {slots.map((slot) => (
                <Pressable
                  key={slot.value}
                  style={[styles.choice, editSlot === slot.value && styles.choiceActive]}
                  onPress={() => setEditSlot(slot.value)}
                >
                  <Text
                    style={[styles.choiceText, editSlot === slot.value && styles.choiceTextActive]}
                  >
                    {slot.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>TIME (OPTIONAL)</Text>
            <Pressable style={editTimeStyles.input} onPress={() => setEditTimeOpen(true)}>
              <Text style={[editTimeStyles.text, !editTime && editTimeStyles.placeholder]}>
                {displayMealTime(editTime)}
              </Text>
              <Ionicons name="chevron-down" size={18} color={palette.c596779} />
            </Pressable>
            <View style={styles.sheetActions}>
              <Pressable
                disabled={saving}
                style={styles.delete}
                onPress={() => setRemoveConfirm(true)}
              >
                <Ionicons name="trash-outline" size={17} color={palette.cc64c55} />
                <Text style={styles.deleteText}>Remove</Text>
              </Pressable>
              <Pressable disabled={saving} style={styles.save} onPress={() => void saveEdit()}>
                <Text style={styles.saveText}>{saving ? "Saving…" : "Save changes"}</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
      <Modal
        visible={removeConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setRemoveConfirm(false)}
      >
        <View style={confirmStyles.overlay}>
          <View style={confirmStyles.card}>
            <View style={confirmStyles.icon}>
              <Ionicons name="trash-outline" size={25} color={palette.cc64c55} />
            </View>
            <Text style={confirmStyles.title}>Remove this meal?</Text>
            <Text style={confirmStyles.copy}>
              {editing?.title} will be removed from your meal plan.
            </Text>
            <Pressable style={confirmStyles.remove} onPress={() => void remove()}>
              <Text style={confirmStyles.removeText}>Remove meal</Text>
            </Pressable>
            <Pressable style={confirmStyles.cancel} onPress={() => setRemoveConfirm(false)}>
              <Text style={confirmStyles.cancelText}>Keep meal</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <TimePickerSheet
        visible={editTimeOpen}
        value={editTime}
        onSelect={setEditTime}
        onClose={() => setEditTimeOpen(false)}
      />
      <DatePickerSheet
        visible={weekCalendarOpen}
        value={selected}
        onSelect={chooseDate}
        onClose={() => setWeekCalendarOpen(false)}
      />
      <DatePickerSheet
        visible={editCalendarOpen}
        value={editDate || selected}
        onSelect={(value) => {
          setEditDate(value);
          setEditCalendarOpen(false);
        }}
        onClose={() => setEditCalendarOpen(false)}
      />
      <AppMessageModal
        visible={Boolean(message)}
        title={message?.title ?? "EcoChef"}
        message={message?.message ?? ""}
        tone={message?.tone}
        onClose={() => setMessage(undefined)}
      />
      <ShoppingListSheet
        visible={shoppingOpen}
        selectedDate={selected}
        load={loadShopping}
        onComplete={async (completed: ShoppingCompletionItem[]) => {
          await api.addInventoryItems(
            completed.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              expiry_date: item.expiry_date,
              category: "Shopping list",
              source: "shopping",
              icon: ingredientEmojiFor(item.name),
            })),
          );
        }}
        onClose={() => setShoppingOpen(false)}
        onMessage={(copy, tone = "info") => {
          setMessage({ title: "Shopping List", message: copy, tone });
        }}
      />
    </View>
  );
}

function PlanMetric({
  icon,
  value,
  suffix = "",
  label,
  color,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  suffix?: string;
  label: string;
  color: string;
  tint: string;
}) {
  return (
    <View style={[styles.planMetric, { backgroundColor: tint }]}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.planMetricValue, { color }]}>
        {value}
        {suffix}
      </Text>
      <Text style={styles.planMetricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  calendarLayer: {
    zIndex: 2,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: palette.ce3e5e1,
    backgroundColor: palette.cf8f6f1,
    shadowColor: palette.c24372d,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 7,
    elevation: 5,
  },
  listButton: {
    height: 35,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 11,
    backgroundColor: GREEN,
  },
  listButtonText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.black,
  },
  weekHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    marginTop: 12,
  },
  arrow: {
    width: 46,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  month: {
    color: palette.c28384a,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
  },
  monthButton: {
    minWidth: 190,
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: palette.cf0f5f1,
  },
  days: { flexDirection: "row", gap: 5, paddingHorizontal: 12, marginTop: 8 },
  day: {
    flex: 1,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.ce8e9e6,
    borderRadius: 13,
    backgroundColor: palette.cfff,
  },
  dayActive: { borderColor: GREEN, backgroundColor: GREEN },
  dayName: {
    color: palette.c8a94a3,
    fontSize: typography.mobile.rawSize.s8,
    fontWeight: typography.weight.extrabold,
  },
  dayNumber: {
    marginTop: 3,
    color: palette.c26374b,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.black,
  },
  dayTextActive: { color: palette.cfff },
  dot: {
    position: "absolute",
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: GREEN,
  },
  dotActive: { backgroundColor: palette.cfff },
  dotText: { display: "none" },
  content: { padding: 13, paddingBottom: 120 },
  panelLabel: {
    color: palette.c637184,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.black,
    letterSpacing: 0.5,
  },
  nutrition: {
    padding: 13,
    borderWidth: 1,
    borderColor: palette.ce5e6e3,
    borderRadius: 17,
    backgroundColor: palette.cfff,
  },
  summaryRow: { flexDirection: "row", gap: 7, marginTop: 10 },
  planMetric: {
    flex: 1,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    padding: 7,
    borderRadius: 12,
  },
  planMetricValue: {
    marginTop: 4,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.black,
  },
  planMetricLabel: {
    marginTop: 2,
    color: palette.c7e8996,
    fontSize: typography.mobile.rawSize.s8,
    textAlign: "center",
  },
  shoppingSummary: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: palette.cf4f8f5,
  },
  shoppingSummaryText: {
    flex: 1,
    color: palette.c647266,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.bold,
  },
  timelineHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 8,
  },
  orderHint: { color: palette.ca5adb5, fontSize: typography.mobile.rawSize.s8 },
  timelineRow: { flexDirection: "row", minHeight: 87 },
  timeColumn: { width: 52, alignItems: "center", paddingTop: 24 },
  timelineTime: {
    color: palette.c909aa7,
    fontSize: typography.mobile.rawSize.s8,
    fontWeight: typography.weight.bold,
  },
  timelineDot: {
    position: "absolute",
    right: 0,
    top: 28,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: GREEN,
  },
  timelineLine: {
    position: "absolute",
    right: 3,
    top: 35,
    bottom: -12,
    width: 1,
    backgroundColor: palette.ccfe9d8,
  },
  timelineBody: { flex: 1, paddingLeft: 12 },
  slotTitle: {
    marginBottom: 7,
    color: palette.c344357,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  card: {
    minHeight: 63,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 9,
    padding: 8,
    borderWidth: 1,
    borderColor: palette.ce4e6e3,
    borderRadius: 14,
    backgroundColor: palette.cfff,
  },
  image: { width: 44, height: 44, borderRadius: 22 },
  imageFallback: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: palette.ceaf3ec,
  },
  food: { fontSize: typography.mobile.rawSize.s21 },
  cardBody: { flex: 1, paddingHorizontal: 10 },
  cardTitle: {
    color: palette.c1d3044,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 7 },
  metaText: { marginTop: 3, color: palette.c8a95a2, fontSize: typography.mobile.rawSize.s9 },
  more: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: palette.cf2f4f5,
  },
  cookAction: {
    minWidth: 64,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: palette.ce8f7ed,
  },
  cookActionText: {
    color: palette.c118447,
    fontSize: typography.mobile.rawSize.s8,
    fontWeight: typography.weight.black,
  },
  quickAdd: {
    height: 53,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: palette.cd9dee2,
    borderRadius: 14,
    backgroundColor: palette.cfff,
  },
  quickAddText: {
    color: palette.c919caa,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.bold,
  },
  state: { alignItems: "center", paddingVertical: 50 },
  stateTitle: {
    marginTop: 12,
    color: palette.c27384a,
    fontSize: typography.mobile.rawSize.s17,
    fontWeight: typography.weight.extrabold,
  },
  stateCopy: {
    marginTop: 7,
    color: palette.c7d8998,
    fontSize: typography.mobile.rawSize.s12,
    textAlign: "center",
  },
  retry: {
    marginTop: 15,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: GREEN,
  },
  retryText: { color: palette.cfff, fontWeight: typography.weight.extrabold },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: palette.crgba_20_28_24_42,
  },
  sheet: {
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: palette.cfff,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: palette.c17283c,
    fontSize: typography.mobile.rawSize.s20,
    fontWeight: typography.weight.extrabold,
  },
  sheetCopy: {
    maxWidth: 270,
    marginTop: 4,
    color: palette.c7c8795,
    fontSize: typography.mobile.rawSize.s12,
  },
  close: {
    width: 35,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: palette.cf0f2f4,
  },
  label: {
    marginTop: 19,
    marginBottom: 7,
    color: palette.c69768a,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
    letterSpacing: 0.6,
  },
  input: {
    height: 46,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: palette.cdfe3e6,
    borderRadius: 13,
    color: palette.c324256,
    backgroundColor: palette.cfafbfc,
  },
  slotChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  choice: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: palette.ce0e4e7,
    borderRadius: 12,
    backgroundColor: palette.cfafbfc,
  },
  choiceActive: { borderColor: GREEN, backgroundColor: palette.ceaf8ef },
  choiceText: {
    color: palette.c657184,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.bold,
  },
  choiceTextActive: { color: palette.c098e45 },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 24 },
  delete: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: palette.cfff0f1,
  },
  deleteText: { color: palette.cc64c55, fontWeight: typography.weight.extrabold },
  save: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: GREEN,
  },
  saveText: { color: palette.cfff, fontWeight: typography.weight.extrabold },
});
const editTimeStyles = StyleSheet.create({
  input: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: palette.cdfe3e6,
    borderRadius: 13,
    backgroundColor: palette.cfafbfc,
  },
  text: { flex: 1, color: palette.c324256, fontSize: typography.mobile.rawSize.s13 },
  placeholder: { color: palette.c98a2af },
});
const confirmStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 25,
    backgroundColor: palette.crgba_20_30_25_48,
  },
  card: {
    width: "100%",
    maxWidth: 350,
    alignItems: "center",
    padding: 23,
    borderRadius: 23,
    backgroundColor: palette.cfff,
  },
  icon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: palette.cfff0f1,
  },
  title: {
    marginTop: 14,
    color: palette.c263a31,
    fontSize: typography.mobile.rawSize.s19,
    fontWeight: typography.weight.black,
  },
  copy: {
    marginTop: 7,
    color: palette.c718078,
    fontSize: typography.mobile.rawSize.s12,
    textAlign: "center",
  },
  remove: {
    width: "100%",
    alignItems: "center",
    marginTop: 20,
    padding: 13,
    borderRadius: 13,
    backgroundColor: palette.cc64c55,
  },
  removeText: { color: palette.cfff, fontWeight: typography.weight.black },
  cancel: {
    width: "100%",
    alignItems: "center",
    marginTop: 7,
    padding: 12,
    borderRadius: 13,
    backgroundColor: palette.cf1f4f2,
  },
  cancelText: { color: palette.c53645b, fontWeight: typography.weight.extrabold },
});
