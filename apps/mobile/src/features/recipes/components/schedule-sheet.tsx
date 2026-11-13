import { apiBaseUrl } from "../../../lib/api-url";
import { createMobileApi } from "../../../lib/api";
import { useAuth } from "../../auth/auth-provider";
import type { CookingGroup, CookingGroupList } from "../../social/cooking-group";
import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { useEffect, useMemo, useState } from "react";
import { Animated, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppMessageModal } from "../../../shared/components/app-message-modal";
import type { RecipeDetail, RecipeSummary } from "../types";
import { recipeDefaultMealSlot } from "../recipe-tag-options";
import { displayMealTime, TimePickerSheet } from "../../meal-planning/components/time-picker-sheet";
import type { MealPlanEntry, MealSlot } from "../../meal-planning/types";
import {
  DatePickerSheet,
  displayPlanDate,
  todayIso,
} from "../../meal-planning/components/date-picker-sheet";

const meals: ReadonlyArray<{ label: string; value: MealSlot }> = [
  { label: "Drink", value: "drink" },
  { label: "Breakfast", value: "breakfast" },
  { label: "Brunch", value: "brunch" },
  { label: "Lunch", value: "lunch" },
  { label: "Teatime", value: "teatime" },
  { label: "Dinner", value: "dinner" },
  { label: "Dessert", value: "dessert" },
  { label: "Snack", value: "snacks" },
];
const repeatableMealSlots = new Set<MealSlot>(["brunch", "snacks", "dessert", "drink", "teatime"]);
const CLOSE_MEAL_MINUTES = 60;
const minutesFromTime = (value: string) => {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
};
export function ScheduleSheet({
  recipe,
  onClose,
  onSave,
  onSuccess,
  loadPlannedMeals,
}: {
  recipe?: RecipeSummary | RecipeDetail;
  onClose: () => void;
  onSave: (date: string, meal: MealSlot, time?: string, sharedGroupId?: string) => Promise<void>;
  onSuccess?: (message: string) => void;
  loadPlannedMeals?: (date: string) => Promise<MealPlanEntry[]>;
}) {
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const sheetMotion = useBottomSheetSlide(Boolean(recipe));
  const groupMotion = useBottomSheetSlide(groupPickerOpen);
  const [groups, setGroups] = useState<CookingGroup[]>([]);
  const [sharedGroupId, setSharedGroupId] = useState<string>();
  const [groupsError, setGroupsError] = useState(false);
  const memberPrivateRecipe = Boolean(recipe && !recipe.is_owner && !recipe.is_published);
  const allowedGroupIds = (recipe as RecipeDetail | undefined)?.shared_group_ids;
  useEffect(() => {
    setSharedGroupId(memberPrivateRecipe ? allowedGroupIds?.[0] : undefined);
    setGroups([]);
    setGroupsError(false);
    if (!recipe) return;
    let active = true;
    void api
      .getMyCookingGroups<CookingGroupList>()
      .then((result) => {
        if (active)
          setGroups(
            result.items.filter(
              (group) =>
                group.status === "active" &&
                (!memberPrivateRecipe || allowedGroupIds?.includes(group.id)),
            ),
          );
      })
      .catch(() => {
        if (active) setGroupsError(true);
      });
    return () => {
      active = false;
    };
  }, [recipe?.id, api, memberPrivateRecipe, allowedGroupIds?.join(",")]);
  const defaultMeal = recipeDefaultMealSlot(recipe?.dietary_tags ?? []);
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState(todayIso());
  const [dateOpen, setDateOpen] = useState(false);
  const [meal, setMeal] = useState<MealSlot>(defaultMeal);
  const [time, setTime] = useState("");
  const [timeOpen, setTimeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    title: string;
    message: string;
    tone: "success" | "error";
  }>();
  const [plannedMeals, setPlannedMeals] = useState<MealPlanEntry[]>([]);
  const [loadingPlanned, setLoadingPlanned] = useState(false);
  const [plannedLoadedDate, setPlannedLoadedDate] = useState<string>();
  const [plannedScrollOffset, setPlannedScrollOffset] = useState(0);
  const [planConflict, setPlanConflict] = useState<{
    item: MealPlanEntry;
    reason: "recipe" | "meal" | "time";
  }>();
  const [privateShareWarning, setPrivateShareWarning] = useState(false);
  const plannedViewportHeight = 140;
  const plannedVisibleHeight =
    Math.min(3, plannedMeals.length) * 42 + Math.max(0, Math.min(3, plannedMeals.length) - 1) * 7;
  const plannedContentHeight = Math.max(
    plannedViewportHeight,
    plannedMeals.length * 42 + Math.max(0, plannedMeals.length - 1) * 7,
  );
  const plannedThumbHeight = Math.max(
    28,
    (plannedViewportHeight * plannedViewportHeight) / plannedContentHeight,
  );
  const plannedThumbTop =
    (plannedScrollOffset / Math.max(1, plannedContentHeight - plannedViewportHeight)) *
    (plannedViewportHeight - plannedThumbHeight);
  useEffect(() => {
    setPlannedScrollOffset(0);
    setPlannedLoadedDate(undefined);
    if (!recipe || !loadPlannedMeals || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setPlannedMeals([]);
      return;
    }
    let active = true;
    setLoadingPlanned(true);
    const timer = setTimeout(() => {
      void loadPlannedMeals(date)
        .then((items) => {
          if (active) {
            setPlannedMeals(items);
            setPlannedLoadedDate(date);
          }
        })
        .catch(() => {
          if (active) setPlannedMeals([]);
        })
        .finally(() => {
          if (active) setLoadingPlanned(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [recipe, date, loadPlannedMeals]);
  useEffect(() => {
    if (!recipe) {
      setDateOpen(false);
      setTimeOpen(false);
      setGroupPickerOpen(false);
      setPlanConflict(undefined);
      setPrivateShareWarning(false);
      setLoadingPlanned(false);
      setPlannedMeals([]);
      setPlannedScrollOffset(0);
    }
  }, [recipe]);
  useEffect(() => {
    if (recipe) {
      setDate(todayIso());
      setDateOpen(false);
      setTime("");
      setTimeOpen(false);
      setPlanConflict(undefined);
      setMeal(defaultMeal);
    }
  }, [recipe?.id, defaultMeal]);
  async function completeSave() {
    setSaving(true);
    try {
      await onSave(date, meal, time || undefined, sharedGroupId);
      const label = meals.find((item) => item.value === meal)?.label ?? meal;
      const success = `${recipe?.title ?? "This recipe"} was added to ${label.toLowerCase()} on ${date}.`;
      onClose();
      onSuccess?.(success);
    } catch (error) {
      setMessage({
        title: "Could not add meal",
        message: error instanceof Error ? error.message : "Please try again.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  function confirmSave() {
    if (memberPrivateRecipe && !sharedGroupId) {
      setMessage({
        title: "Choose a cooking group",
        message: "This private recipe can only be scheduled in a group where it was shared.",
        tone: "error",
      });
      return;
    }
    if (sharedGroupId && recipe?.is_owner && !recipe.is_published) {
      setPrivateShareWarning(true);
      return;
    }
    void completeSave();
  }
  async function save() {
    if (saving) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setMessage({ title: "Check the date", message: "Select a valid date.", tone: "error" });
      return;
    }
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setMessage({ title: "Check the time", message: "Select a valid time.", tone: "error" });
      return;
    }
    let sameDay = plannedMeals;
    if (loadPlannedMeals && plannedLoadedDate !== date) {
      setSaving(true);
      try {
        sameDay = await loadPlannedMeals(date);
        setPlannedMeals(sameDay);
        setPlannedLoadedDate(date);
      } catch (error) {
        setMessage({
          title: "Could not check your plan",
          message:
            error instanceof Error ? error.message : "Refresh your connection and try again.",
          tone: "error",
        });
        return;
      } finally {
        setSaving(false);
      }
    }
    const sameDestination = sameDay.filter(
      (item) => item.can_edit !== false && (item.shared_group_id ?? undefined) === sharedGroupId,
    );
    const recipeConflict = sameDay.find((item) => item.recipe_id === recipe?.id);
    if (recipeConflict) {
      setPlanConflict({ item: recipeConflict, reason: "recipe" });
      return;
    }
    const repeatable = repeatableMealSlots.has(meal);
    const mealConflict = !repeatable
      ? sameDestination.find((item) => item.meal_slot === meal)
      : undefined;
    if (mealConflict) {
      setPlanConflict({ item: mealConflict, reason: "meal" });
      return;
    }
    if (time && !repeatable) {
      const selectedMinutes = minutesFromTime(time);
      const timeConflict = sameDestination
        .filter((item) => item.scheduled_time)
        .map((item) => ({
          item,
          difference: Math.abs(minutesFromTime(item.scheduled_time!) - selectedMinutes),
        }))
        .filter((candidate) => candidate.difference <= CLOSE_MEAL_MINUTES)
        .sort((a, b) => a.difference - b.difference)[0]?.item;
      if (timeConflict) {
        setPlanConflict({ item: timeConflict, reason: "time" });
        return;
      }
    }
    confirmSave();
  }
  const selectedGroup = groups.find((group) => group.id === sharedGroupId);
  return (
    <>
      <Modal visible={Boolean(recipe)} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <Animated.ScrollView
            keyboardShouldPersistTaps="handled"
            style={[{ maxHeight: "92%", flexGrow: 0 }, sheetMotion]}
            contentContainerStyle={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          >
            <View style={styles.head}>
              <Text style={styles.title}>Add to Schedule</Text>
              <Pressable style={styles.close} onPress={onClose}>
                <Ionicons name="close" size={18} color={palette.c596579} />
              </Pressable>
            </View>
            <Text style={styles.copy}>Choose when you want to cook this recipe.</Text>
            <Text style={styles.label}>1. SELECT DATE</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Select meal date"
              style={styles.inputRow}
              onPress={() => setDateOpen(true)}
            >
              <Ionicons name="calendar-outline" size={18} color={palette.c12ad55} />
              <Text style={dateStyles.value}>{displayPlanDate(date)}</Text>
              {date === todayIso() && <Text style={dateStyles.today}>Today</Text>}
              <Ionicons name="chevron-down" size={16} color={palette.c7a8795} />
            </Pressable>
            <View style={styles.planned}>
              <View style={plannedStyles.heading}>
                <Text style={styles.plannedTitle}>PLANNED MEALS</Text>
                {plannedMeals.length > 0 && (
                  <Text style={plannedStyles.count}>{plannedMeals.length}</Text>
                )}
              </View>
              {loadingPlanned ? (
                <Text style={styles.plannedCopy}>Checking this date…</Text>
              ) : plannedMeals.length === 0 ? (
                <Text style={styles.plannedCopy}>No meals planned yet.</Text>
              ) : (
                <View style={[plannedStyles.scrollFrame, { height: plannedVisibleHeight }]}>
                  <ScrollView
                    style={plannedStyles.list}
                    contentContainerStyle={[
                      plannedStyles.listContent,
                      plannedMeals.length > 3 && plannedStyles.listScrollable,
                    ]}
                    nestedScrollEnabled
                    scrollEnabled={plannedMeals.length > 3}
                    showsVerticalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScroll={(event) => setPlannedScrollOffset(event.nativeEvent.contentOffset.y)}
                  >
                    {plannedMeals.map((item) => (
                      <View key={item.id} style={plannedStyles.item}>
                        <View style={plannedStyles.icon}>
                          <Ionicons name="restaurant-outline" size={14} color={palette.c0e9e4f} />
                        </View>
                        <View style={plannedStyles.itemCopy}>
                          <Text style={plannedStyles.itemTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={plannedStyles.itemMeta} numberOfLines={1}>
                            {item.meal_slot.charAt(0).toUpperCase() + item.meal_slot.slice(1)} ·{" "}
                            {item.scheduled_time
                              ? displayMealTime(item.scheduled_time)
                              : "Any time"}{" "}
                            · {item.shared_group_name ?? "Only me"}
                          </Text>
                        </View>
                        {item.recipe_id === recipe?.id && (
                          <Text style={plannedStyles.same}>This recipe</Text>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                  {plannedMeals.length > 3 && (
                    <View pointerEvents="none" style={plannedStyles.scrollTrack}>
                      <View
                        style={[
                          plannedStyles.scrollThumb,
                          {
                            height: plannedThumbHeight,
                            transform: [{ translateY: plannedThumbTop }],
                          },
                        ]}
                      />
                    </View>
                  )}
                </View>
              )}
            </View>
            <Text style={styles.label}>2. CHOOSE MEAL</Text>
            <View style={styles.meals}>
              {meals.map((item) => (
                <Pressable
                  key={item.value}
                  onPress={() => setMeal(item.value)}
                  style={[styles.meal, meal === item.value && styles.mealActive]}
                >
                  <Text style={[styles.mealText, meal === item.value && styles.mealTextActive]}>
                    {item.label}
                  </Text>
                  {meal === item.value && (
                    <Ionicons name="checkmark" size={16} color={palette.c0e9e4f} />
                  )}
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>
              3. SELECT TIME <Text style={styles.optional}>(optional)</Text>
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Customize cooking time"
              style={styles.selectedTime}
              onPress={() => setTimeOpen(true)}
            >
              <Ionicons name="time-outline" size={18} color={palette.c12ad55} />
              <Text style={styles.selectedTimeText}>{displayMealTime(time)}</Text>
              <Text style={styles.customize}>Customize</Text>
              <Ionicons name="chevron-forward" size={17} color={palette.c7a8795} />
            </Pressable>
            <View style={groupStyles.section}>
              <Text style={styles.label}>4. COOKING GROUP</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose cooking group"
                accessibilityState={{ expanded: groupPickerOpen, disabled: saving }}
                disabled={saving}
                style={styles.inputRow}
                onPress={() => setGroupPickerOpen(true)}
              >
                <Ionicons name="people-outline" size={19} color={colors.primaryStrong} />
                <Text style={groupStyles.selected}>
                  {selectedGroup
                    ? `${selectedGroup.name} · ${selectedGroup.owner_name}`
                    : memberPrivateRecipe
                      ? "Choose shared cooking group"
                      : "None — only me"}
                </Text>
                <Ionicons name="chevron-down" size={17} color={colors.textMuted} />
              </Pressable>
              <Text style={styles.copy}>
                {sharedGroupId
                  ? "Joined members will see this recipe, date and time. Only you can edit it."
                  : "This meal will appear only in your own schedule."}
              </Text>
            </View>
            {groupsError && (
              <Text style={styles.copy}>
                Group sharing is unavailable. Reopen this form to try again; you can still save
                privately.
              </Text>
            )}
            <Pressable disabled={saving} style={styles.save} onPress={() => void save()}>
              <Ionicons name="calendar-outline" size={18} color={palette.cfff} />
              <Text style={styles.saveText}>{saving ? "Saving…" : "Save & Add to Meal Plan"}</Text>
            </Pressable>
          </Animated.ScrollView>
        </View>
      </Modal>
      <DatePickerSheet
        visible={dateOpen}
        value={date}
        onSelect={setDate}
        onClose={() => setDateOpen(false)}
      />
      <TimePickerSheet
        visible={timeOpen}
        value={time}
        onSelect={setTime}
        onClose={() => setTimeOpen(false)}
      />
      <Modal
        visible={groupPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setGroupPickerOpen(false)}
      >
        <View style={groupStyles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setGroupPickerOpen(false)} />
          <Animated.View
            style={[groupStyles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }, groupMotion]}
          >
            <View style={styles.head}>
              <Text style={styles.title}>Choose cooking group</Text>
              <Pressable
                accessibilityLabel="Close cooking group picker"
                style={styles.close}
                onPress={() => setGroupPickerOpen(false)}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.copy}>Choose who can see this scheduled meal.</Text>
            <ScrollView
              style={groupStyles.options}
              contentContainerStyle={groupStyles.optionsContent}
            >
              {!memberPrivateRecipe && (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: !sharedGroupId }}
                  style={[groupStyles.option, !sharedGroupId && groupStyles.optionSelected]}
                  onPress={() => {
                    setSharedGroupId(undefined);
                    setGroupPickerOpen(false);
                  }}
                >
                  <Ionicons name="person-outline" size={19} color={colors.primaryStrong} />
                  <View style={groupStyles.optionCopy}>
                    <Text style={groupStyles.optionTitle}>None — only me</Text>
                    <Text style={groupStyles.optionHint}>Keep this meal in your own schedule</Text>
                  </View>
                  <Ionicons
                    name={!sharedGroupId ? "radio-button-on" : "radio-button-off"}
                    size={21}
                    color={colors.primaryStrong}
                  />
                </Pressable>
              )}
              {groups.map((group) => (
                <Pressable
                  key={group.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: sharedGroupId === group.id }}
                  style={[
                    groupStyles.option,
                    sharedGroupId === group.id && groupStyles.optionSelected,
                  ]}
                  onPress={() => {
                    setSharedGroupId(group.id);
                    setGroupPickerOpen(false);
                  }}
                >
                  <Ionicons name="people-outline" size={19} color={colors.primaryStrong} />
                  <View style={groupStyles.optionCopy}>
                    <Text style={groupStyles.optionTitle}>{group.name}</Text>
                    <Text style={groupStyles.optionHint}>
                      {group.owner_name}’s group ·{" "}
                      {group.members.filter((member) => member.status === "active").length} members
                    </Text>
                  </View>
                  <Ionicons
                    name={sharedGroupId === group.id ? "radio-button-on" : "radio-button-off"}
                    size={21}
                    color={colors.primaryStrong}
                  />
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
      <Modal
        visible={planConflict !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setPlanConflict(undefined)}
      >
        <View style={confirmStyles.overlay}>
          <View style={confirmStyles.dialog}>
            <View style={confirmStyles.icon}>
              <Ionicons name="time-outline" size={24} color={palette.cb86a24} />
            </View>
            <Text style={confirmStyles.title}>
              {planConflict?.reason === "recipe"
                ? "Recipe already planned"
                : planConflict?.reason === "meal"
                  ? `${meals.find((item) => item.value === meal)?.label ?? meal} is already planned`
                  : "Meals are close together"}
            </Text>
            <Text style={confirmStyles.copy}>
              {planConflict?.reason === "recipe"
                ? `${planConflict.item.title} is already planned for ${planConflict.item.meal_slot} on this date${planConflict.item.scheduled_time ? ` at ${displayMealTime(planConflict.item.scheduled_time)}` : ""}.`
                : planConflict?.reason === "meal"
                  ? `${planConflict.item.title} is already in your ${meals.find((item) => item.value === meal)?.label.toLowerCase() ?? meal} slot for this date.`
                  : planConflict
                    ? `${planConflict.item.title} is already planned for ${displayMealTime(planConflict.item.scheduled_time!)}. Your new meal at ${displayMealTime(time)} is within one hour of it.`
                    : ""}
            </Text>
            <Text style={confirmStyles.question}>Would you still like to add this meal?</Text>
            <Pressable
              disabled={saving}
              style={confirmStyles.confirm}
              onPress={() => {
                setPlanConflict(undefined);
                confirmSave();
              }}
            >
              <Text style={confirmStyles.confirmText}>{saving ? "Adding…" : "Add anyway"}</Text>
            </Pressable>
            <Pressable
              style={confirmStyles.adjust}
              onPress={() => {
                const adjustTime = planConflict?.reason === "time";
                setPlanConflict(undefined);
                if (adjustTime) setTimeOpen(true);
              }}
            >
              <Text style={confirmStyles.adjustText}>
                {planConflict?.reason === "time"
                  ? "Change time"
                  : planConflict?.reason === "meal"
                    ? "Choose another meal"
                    : "Keep editing"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={privateShareWarning}
        transparent
        animationType="fade"
        onRequestClose={() => setPrivateShareWarning(false)}
      >
        <View style={confirmStyles.overlay}>
          <View style={confirmStyles.dialog}>
            <View style={confirmStyles.icon}>
              <Ionicons name="people-outline" size={24} color={palette.cb86a24} />
            </View>
            <Text style={confirmStyles.title}>Share private recipe?</Text>
            <Text style={confirmStyles.copy}>
              Adding {recipe?.title ?? "this recipe"} to{" "}
              {selectedGroup?.name ?? "this cooking group"} lets its members see the recipe in their
              Plan and open its details. It will stay off the public Recipes page.
            </Text>
            <Pressable
              disabled={saving}
              style={confirmStyles.confirm}
              onPress={() => {
                setPrivateShareWarning(false);
                void completeSave();
              }}
            >
              <Text style={confirmStyles.confirmText}>Share with group</Text>
            </Pressable>
            <Pressable style={confirmStyles.adjust} onPress={() => setPrivateShareWarning(false)}>
              <Text style={confirmStyles.adjustText}>Keep editing</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <AppMessageModal
        visible={message !== undefined}
        title={message?.title ?? "EcoChef"}
        message={message?.message ?? ""}
        tone={message?.tone}
        onClose={() => setMessage(undefined)}
      />
    </>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: palette.crgba_24_28_26_42 },
  sheet: {
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: palette.cfff,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: {
    color: palette.c14233a,
    fontSize: typography.mobile.rawSize.s20,
    fontWeight: typography.weight.extrabold,
  },
  close: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: palette.cf0f2f4,
  },
  copy: { marginTop: 10, color: palette.c7b8799, fontSize: typography.mobile.rawSize.s12 },
  label: {
    marginTop: 18,
    marginBottom: 8,
    color: palette.c68758a,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
    letterSpacing: 0.7,
  },
  optional: { fontWeight: typography.weight.regular },
  inputRow: {
    height: 45,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.ce0e4e8,
    borderRadius: 13,
    backgroundColor: palette.cfafbfc,
  },
  input: { flex: 1, color: palette.c334155, fontSize: typography.mobile.rawSize.s13 },
  placeholder: { color: palette.c98a2af },
  planned: {
    marginTop: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: palette.ccfebdd,
    borderRadius: 14,
    backgroundColor: palette.cf0faf4,
  },
  plannedTitle: {
    color: palette.c0e9e4f,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
  },
  plannedCopy: { marginTop: 8, color: palette.c8a95a5, fontSize: typography.mobile.rawSize.s11 },
  meals: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  meal: {
    width: "31%",
    height: 37,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: palette.ce1e5e9,
    borderRadius: 12,
    backgroundColor: palette.cfafbfc,
  },
  mealActive: { borderColor: palette.c12ad55, backgroundColor: palette.cecf8f0 },
  mealText: {
    color: palette.c465267,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
  },
  mealTextActive: { color: palette.c0e9e4f },
  timeToggle: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: palette.cdfe4e1,
    borderRadius: 13,
    backgroundColor: palette.cf8faf8,
  },
  timeToggleCopy: { flex: 1 },
  timeToggleTitle: {
    color: palette.c3c4e44,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  timeToggleHint: { marginTop: 3, color: palette.c87918c, fontSize: typography.mobile.rawSize.s9 },
  selectedTime: {
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: palette.cecf8f1,
  },
  selectedTimeText: {
    flex: 1,
    color: palette.c157a45,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.black,
  },
  customize: {
    color: palette.c54826a,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.extrabold,
  },
  save: {
    height: 49,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: palette.c12ad55,
  },
  saveText: { color: palette.cfff, fontWeight: typography.weight.extrabold },
});
const plannedStyles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", gap: 7 },
  count: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    color: palette.cfff,
    backgroundColor: palette.c0e9e4f,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.black,
    lineHeight: 18,
    textAlign: "center",
  },
  scrollFrame: { height: 140, marginTop: 9 },
  list: { height: 140 },
  listContent: { gap: 7 },
  listScrollable: { paddingRight: 9 },
  scrollTrack: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 4,
    height: 140,
    borderRadius: 2,
    backgroundColor: palette.cd7eadf,
  },
  scrollThumb: { width: 4, borderRadius: 2, backgroundColor: colors.textSubtle },
  item: {
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 7,
    borderRadius: 10,
    backgroundColor: palette.cfff,
  },
  icon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: palette.ce8f7ed,
  },
  itemCopy: { flex: 1 },
  itemTitle: {
    color: palette.c334b40,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
  },
  itemMeta: {
    marginTop: 2,
    color: palette.c84918b,
    fontSize: typography.mobile.rawSize.s8,
    textTransform: "capitalize",
  },
  same: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
    color: palette.c0b8c48,
    backgroundColor: palette.ce4f5ea,
    fontSize: typography.mobile.rawSize.s7,
    fontWeight: typography.weight.black,
  },
});
const dateStyles = StyleSheet.create({
  value: {
    flex: 1,
    color: palette.c334155,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.bold,
  },
  today: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
    color: palette.c0a8d47,
    backgroundColor: palette.ce4f6ea,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.black,
  },
});
const confirmStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: palette.crgba_22_29_25_48,
  },
  dialog: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    padding: 22,
    borderRadius: 22,
    backgroundColor: palette.cfff,
    shadowColor: palette.c14251b,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 8,
  },
  icon: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 25,
    backgroundColor: palette.cfff2e6,
  },
  title: {
    marginTop: 14,
    color: palette.c1d3026,
    fontSize: typography.mobile.rawSize.s18,
    fontWeight: typography.weight.black,
    textAlign: "center",
  },
  copy: {
    marginTop: 9,
    color: palette.c6e7d74,
    fontSize: typography.mobile.rawSize.s12,
    lineHeight: 18,
    textAlign: "center",
  },
  question: {
    marginTop: 8,
    color: palette.c43554b,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
    textAlign: "center",
  },
  confirm: {
    width: "100%",
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 19,
    borderRadius: 13,
    backgroundColor: palette.c12ad55,
  },
  confirmText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.black,
  },
  adjust: {
    width: "100%",
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 7,
    borderRadius: 13,
    backgroundColor: palette.ceef8f1,
  },
  adjustText: {
    color: palette.c0a8d47,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
});

const groupStyles = StyleSheet.create({
  section: { marginTop: 12 },
  selected: {
    flex: 1,
    color: colors.text,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.bold,
  },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  sheet: {
    maxHeight: "75%",
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface,
  },
  options: { marginTop: 12 },
  optionsContent: { gap: 9, paddingBottom: 8 },
  option: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft },
  optionCopy: { flex: 1 },
  optionTitle: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.bold,
  },
  optionHint: { marginTop: 3, color: colors.textMuted, fontSize: typography.mobile.rawSize.s10 },
});
