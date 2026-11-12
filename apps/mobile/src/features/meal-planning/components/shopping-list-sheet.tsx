import { Text, TextInput } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, palette, typography } from "@ecochef/design-tokens";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";
import { ingredientEmojiFor } from "../../../shared/ingredient-icons";
import { estimateIngredientExpiry } from "../../../shared/ingredient-expiry";
import type { PlannedShoppingList, ShoppingListItem } from "../types";
import { DatePickerSheet, dateToIso } from "./date-picker-sheet";
type Range = "day" | "week" | "month";
type Group = ShoppingListItem & { recipes: string[]; recipeCounts: Record<string,number>; count: number; expiry_date?: string };
export type ShoppingCompletionItem = Omit<Group, "expiry_date"> & { expiry_date: string };
const EXPIRY_PREFERENCES_KEY = "shopping-expiry-day-preferences";
const GREEN = colors.primary,
  DAY_RANGE = 1825,
  DATE_CARD_LENGTH = 52,
  DAY_OFFSETS = Array.from({ length: DAY_RANGE * 2 + 1 }, (_, index) => index - DAY_RANGE),
  iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  parse = (v: string) => {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d);
  },
  add = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  },
  monday = (d: Date) => add(d, -((d.getDay() + 6) % 7));
const quantityParts=(value:string)=>{const match=value.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);return match?{amount:Number(match[1]),unit:match[2].trim()}:undefined;};
const sumQuantity=(left:string,right:string)=>{const a=quantityParts(left),b=quantityParts(right);if(!a||!b||a.unit.toLowerCase()!==b.unit.toLowerCase())return `${left} + ${right}`;const total=a.amount+b.amount;return `${Number.isInteger(total)?total:Number(total.toFixed(2))}${a.unit?` ${a.unit}`:""}`;};
export function ShoppingListSheet({
  visible,
  selectedDate,
  load,
  onComplete,
  onClose,
  onMessage,
}: {
  visible: boolean;
  selectedDate: string;
  load: (a: string, b: string) => Promise<PlannedShoppingList>;
  onComplete: (items: ShoppingCompletionItem[]) => Promise<void>;
  onClose: () => void;
  onMessage: (m: string, tone?: "success" | "error" | "info") => void;
}) {
  const insets = useSafeAreaInsets();
  const sheetMotion = useBottomSheetSlide(visible);
  const [range, setRange] = useState<Range>("day"),
    [chosen, setChosen] = useState(selectedDate),
    [dateStripStart, setDateStripStart] = useState(() => monday(parse(selectedDate))),
    [datePageWidth, setDatePageWidth] = useState(0),
    [dateStripVersion, setDateStripVersion] = useState(0),
    [data, setData] = useState<PlannedShoppingList>(),
    [loading, setLoading] = useState(false),
    [completing, setCompleting] = useState(false),
    [expiryHelpOpen, setExpiryHelpOpen] = useState(false),
    [completionReviewOpen, setCompletionReviewOpen] = useState(false),
    [expiryCalendarItem, setExpiryCalendarItem] = useState<string>(),
    [expiryDays, setExpiryDays] = useState<Record<string, string>>({}),
    [purchaseAmounts, setPurchaseAmounts] = useState<Record<string, string>>({}),
    [error, setError] = useState<string>(),
    [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (visible) {
      setChosen(selectedDate);
      setDateStripStart(monday(parse(selectedDate)));
    }
  }, [visible, selectedDate]);
  const date = parse(chosen),
    weekStart = monday(date),
    start =
      range === "day"
        ? date
        : range === "week"
          ? weekStart
          : new Date(date.getFullYear(), date.getMonth(), 1),
    end =
      range === "day"
        ? date
        : range === "week"
          ? add(weekStart, 6)
          : new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const goToToday = () => {
    const today = new Date();
    setChosen(iso(today));
    setDateStripStart(monday(today));
    setDateStripVersion((version) => version + 1);
  };
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(undefined);
    setChecked(new Set());
    void load(iso(start), iso(end))
      .then(setData)
      .catch((next) => {
        setData(undefined);
        setError(
          next instanceof Error
            ? next.message
            : "The shopping list could not be loaded.",
        );
      })
      .finally(() => setLoading(false));
  }, [visible, range, chosen, load]);
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const item of data?.items ?? []) {
      const k = item.name.toLowerCase(),
        old = map.get(k);
      if (old) {
        old.count++;
        // A week can contain both a usable batch now and a later meal after
        // that batch expires. Keep the ingredient on the shopping list.
        old.in_kitchen = old.in_kitchen && item.in_kitchen;
        old.quantity=sumQuantity(old.quantity,item.quantity);
        old.recipeCounts[item.recipe_title]=(old.recipeCounts[item.recipe_title]??0)+1;
        if (!old.recipes.includes(item.recipe_title))
          old.recipes.push(item.recipe_title);
      } else map.set(k, { ...item, count: 1, recipes: [item.recipe_title],recipeCounts:{[item.recipe_title]:1} });
    }
    return [...map.values()].sort(
      (left, right) => Number(left.in_kitchen) - Number(right.in_kitchen),
    );
  }, [data]);
  const rangeLabel =
    range === "day"
      ? date.toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : range === "week"
        ? `Week of ${weekStart.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
        : date.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          });
  const todayValue = iso(new Date());
  const selectedGroups = () => groups.filter((item) => checked.has(item.name.toLowerCase()) && !item.in_kitchen);
  const expiryDateForDays = (value: string) => {
    const days = Number(value);
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    if (Number.isFinite(days)) date.setDate(date.getDate() + days);
    return date;
  };
  const openCompletionReview = async () => {
    const selected = selectedGroups();
    if (!selected.length) {
      onMessage("Select missing items first.", "info");
      return;
    }
    let remembered: Record<string, number> = {};
    try {
      remembered = JSON.parse((await AsyncStorage.getItem(EXPIRY_PREFERENCES_KEY)) ?? "{}");
    } catch {
      remembered = {};
    }
    setExpiryDays(Object.fromEntries(selected.map((item) => {
      const key = item.name.toLowerCase();
      return [key, String(remembered[key] ?? estimateIngredientExpiry(item.name).days)];
    })));
    setPurchaseAmounts(Object.fromEntries(selected.map((item) => {
      const parts = quantityParts(item.quantity);
      return [item.name.toLowerCase(), parts ? String(parts.amount) : item.quantity];
    })));
    setCompletionReviewOpen(true);
  };
  const completeSelected = async () => {
    const selected = selectedGroups();
    const reviewed = selected.map((item) => {
      const key = item.name.toLowerCase();
      const days = Number(expiryDays[key]);
      const original = quantityParts(item.quantity);
      const amount = purchaseAmounts[key]?.trim();
      const numericAmount = Number(amount);
      const quantity = original ? `${amount}${original.unit ? ` ${original.unit}` : ""}` : amount;
      if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0 || quantity.length > 20 || !Number.isInteger(days) || days < 0 || days > 3650) return undefined;
      const expiry = new Date();
      expiry.setHours(12, 0, 0, 0);
      expiry.setDate(expiry.getDate() + days);
      return { ...item, quantity, expiry_date: expiry.toISOString() };
    });
    if (reviewed.some((item) => !item)) {
      onMessage("Enter a valid quantity and expiration date for every item.", "error");
      return;
    }
    setCompleting(true);
    try {
      await onComplete(reviewed as ShoppingCompletionItem[]);
      let remembered: Record<string, number> = {};
      try {
        remembered = JSON.parse((await AsyncStorage.getItem(EXPIRY_PREFERENCES_KEY)) ?? "{}");
      } catch {
        remembered = {};
      }
      await AsyncStorage.setItem(EXPIRY_PREFERENCES_KEY, JSON.stringify({ ...remembered, ...Object.fromEntries(selected.map((item) => [item.name.toLowerCase(), Number(expiryDays[item.name.toLowerCase()])])) }));
      const selectedNames = new Set(selected.map((item) => item.name.toLowerCase()));
      setData((current) => current ? { ...current, items: current.items.map((item) => selectedNames.has(item.name.toLowerCase()) ? { ...item, in_kitchen: true } : item) } : current);
      setChecked(new Set());
      setCompletionReviewOpen(false);
      onMessage(`${selected.length} item${selected.length === 1 ? "" : "s"} added to your Ingredient List.`, "success");
    } catch (next) {
      onMessage(next instanceof Error ? next.message : "The selected ingredients could not be added.", "error");
    } finally {
      setCompleting(false);
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <Pressable
          accessibilityLabel="Close shopping list"
          style={s.backdrop}
          onPress={onClose}
        />
        <Animated.View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) }, sheetMotion]}>
          <View style={s.head}>
            <View>
              <Text style={s.title}>Shopping List</Text>
            </View>
            <View style={s.headActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="How expiry dates are estimated"
                hitSlop={8}
                onPress={() => setExpiryHelpOpen(true)}
              >
                <Ionicons name="help-circle-outline" size={28} color={colors.adminStrong} />
              </Pressable>
              <Pressable onPress={onClose}>
                <Ionicons name="close-circle" size={30} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>
          <View style={s.tabs}>
            {(["day", "week", "month"] as Range[]).map((x) => (
              <Pressable
                key={x}
                style={[s.tab, range === x && s.active]}
                onPress={() => {
                  if (x === "day" && range !== "day") goToToday();
                  setRange(x);
                }}
              >
                <Text style={[s.tabText, range === x && s.activeText]}>{x[0].toUpperCase() + x.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
          {range === "day" && (
            <View style={s.dateSection} onLayout={(event)=>setDatePageWidth(event.nativeEvent.layout.width-20)}>
              <View style={s.dateHeading}>
                <View style={s.dateLabelRow}><Ionicons name="calendar-outline" size={13} color={colors.primaryStrong}/><Text style={s.label}>SELECT A PLANNED DATE</Text></View>
                <View style={s.dateHeadingActions}><View style={s.swipeHint}><Ionicons name="swap-horizontal" size={12} color={colors.textSubtle}/><Text style={s.swipeText}>Swipe dates</Text></View><Pressable style={s.todayButton} onPress={goToToday}><Ionicons name="locate-outline" size={12} color={colors.surface}/><Text style={s.todayText}>Today</Text></Pressable></View>
              </View>
              {datePageWidth>0&&<FlatList
                key={`${iso(dateStripStart)}-${datePageWidth}-${dateStripVersion}`}
                horizontal
                data={DAY_OFFSETS}
                initialScrollIndex={DAY_RANGE}
                getItemLayout={(_,index)=>({length:DATE_CARD_LENGTH,offset:DATE_CARD_LENGTH*index,index})}
                keyExtractor={offset=>String(offset)}
                renderItem={({item:dayOffset})=>{const d=add(dateStripStart,dayOffset);const value=iso(d);const selected=value===chosen;const isToday=value===todayValue;return <Pressable style={[s.day,isToday&&s.todayDay,selected&&s.selected,isToday&&selected&&s.todaySelected]} onPress={()=>setChosen(value)}>
                    <Text style={[s.dayName,isToday&&s.todayDayText,selected&&s.selectedText]}>{d.toLocaleDateString(undefined,{weekday:"narrow"})}</Text>
                    <Text style={[s.dayNumber,isToday&&s.todayDayText,selected&&s.selectedText]}>{d.getDate()}</Text>
                    <Text style={[s.monthName,isToday&&s.todayDayText,selected&&s.selectedText]}>{d.toLocaleDateString(undefined,{month:"short"})}</Text>
                  </Pressable>;}}
                showsHorizontalScrollIndicator={false}
                decelerationRate="normal"
                initialNumToRender={9}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews
                style={s.dateScroller}
              />}
            </View>
          )}
          <View style={s.rangeRow}>
            <Text style={s.rangeText}>{rangeLabel}</Text>
            <Text style={s.rangeHint}>Planned range</Text>
          </View>
          {!loading && !error && (
            <View style={s.summaryCards}>
              <View style={[s.summaryCard, s.toShopCard]}>
                <View style={s.summaryHeading}>
                  <Ionicons name="cart-outline" size={16} color={colors.danger} />
                  <Text style={[s.summaryCount, s.toShopText]}>{groups.filter((item) => !item.in_kitchen).length}</Text>
                </View>
                <Text style={[s.summaryLabel, s.toShopText]}>To shop</Text>
              </View>
              <View style={[s.summaryCard, s.haveCard]}>
                <View style={s.summaryHeading}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
                  <Text style={[s.summaryCount, s.haveText]}>{groups.filter((item) => item.in_kitchen).length}</Text>
                </View>
                <Text style={[s.summaryLabel, s.haveText]}>Already have</Text>
              </View>
            </View>
          )}
          {loading ? (
            <ActivityIndicator style={s.loading} color={GREEN} />
          ) : error ? (
            <View style={s.state}>
              <Ionicons
                name="cloud-offline-outline"
                size={28}
                color={colors.textSubtle}
              />
              <Text style={s.error}>{error}</Text>
            </View>
          ) : (
            <ScrollView
              style={s.list}
              contentContainerStyle={s.listContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {!groups.length && (
                <View style={s.state}>
                  <Text style={s.emptyTitle}>No planned ingredients</Text>
                  <Text style={s.emptyCopy}>
                    Add a recipe to this date range first.
                  </Text>
                </View>
              )}
              {groups.map((item) => {
                const key = item.name.toLowerCase(),
                  done = checked.has(key);
                return (
                  <View key={key} style={s.item}>
                    <View style={s.ingredientIcon}>
                      <Text style={s.emoji}>{ingredientEmojiFor(item.name)}</Text>
                    </View>
                    <View style={s.body}>
                      <Text style={s.name}>{item.name}</Text>
                      <Text style={s.detail}>
                        {item.quantity}
                      </Text>
                      <Text style={s.used}>
                        Used by — {Object.entries(item.recipeCounts).map(([recipe,count])=>`${recipe}${count>1?` ×${count}`:""}`).join(", ")}
                      </Text>
                    </View>
                    {item.in_kitchen ? (
                      <Text style={s.green}>✓ In kitchen</Text>
                    ) : (
                      <Pressable
                        style={[s.check,done?s.purchasedCheck:s.missingCheck]}
                        onPress={() =>
                          setChecked((v) => {
                            const n = new Set(v);
                            n.has(key) ? n.delete(key) : n.add(key);
                            return n;
                          })
                        }
                      >
                        <Ionicons
                          name={done ? "checkbox" : "square-outline"}
                          size={18}
                          color={done ? colors.success : colors.danger}
                        />
                        <Text style={[s.checkText,done?s.purchasedText:s.missingText]}>{done ? "Purchased" : "Missing"}</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
          <Pressable
            style={[s.complete,checked.size>0&&s.completeActive]}
            accessibilityState={{disabled:completing||checked.size===0}}
            disabled={completing||checked.size===0}
            onPress={() => void openCompletionReview()}
          >
            {completing?<ActivityIndicator size="small" color={colors.surface}/>:<><Ionicons name="checkmark" size={17} color={checked.size>0?colors.surface:colors.primaryStrong}/><Text style={[s.completeText,checked.size>0&&s.completeTextActive]}>Mark as Complete</Text></>}
          </Pressable>
          <View style={s.bottom}>
            <Pressable
              style={s.nav}
              onPress={() => {
                onClose();
                router.push({pathname:"/ingredients",params:{returnTo:"shopping",date:chosen}} as never);
              }}
            >
              <Ionicons name="basket-outline" size={16} color={colors.textMuted}/><Text style={s.navText}>Ingredient List</Text>
            </Pressable>
            <Pressable
              style={s.nav}
              onPress={() => {
                onClose();
                router.push({pathname:"/marketplace/shop-plan",params:{date:chosen,range,...(selectedGroups().length ? {ingredients:JSON.stringify(selectedGroups().map(item=>item.name))} : {})}} as never);
              }}
            >
              <Ionicons name="bag-handle-outline" size={16} color={colors.textMuted}/><Text style={s.navText}>Shop missing ingredients</Text>
            </Pressable>
          </View>
          {expiryHelpOpen && (
            <View style={s.helpLayer}>
              <Pressable style={s.helpBackdrop} onPress={() => setExpiryHelpOpen(false)} />
              <View style={s.helpCard}>
                <View style={s.helpHeader}>
                  <View style={s.helpTitleRow}>
                    <Ionicons name="information-circle" size={22} color={colors.adminStrong} />
                    <Text style={s.helpTitle}>How expiry dates are estimated</Text>
                  </View>
                  <Pressable hitSlop={8} onPress={() => setExpiryHelpOpen(false)}>
                    <Ionicons name="close-circle" size={26} color={colors.textMuted} />
                  </Pressable>
                </View>
                <Text style={s.helpCopy}>
                  When you mark an item as complete, EcoChef starts from today and adds the usual number of days that type of food stays fresh.
                </Text>
                <Text style={s.helpNote}>
                  These are helpful estimates, not safety guarantees. They assume normal storage. You can change any date later in Ingredient List.
                </Text>
                <Pressable style={s.helpDone} onPress={() => setExpiryHelpOpen(false)}>
                  <Text style={s.helpDoneText}>Got it</Text>
                </Pressable>
              </View>
            </View>
          )}
          {completionReviewOpen && (
            <View style={s.helpLayer}>
              <View style={s.helpBackdrop} />
              <View style={[s.helpCard, s.reviewCard]}>
                <View style={s.helpHeader}>
                  <View style={s.helpTitleRow}>
                    <Ionicons name="checkmark-circle-outline" size={22} color={colors.primaryStrong} />
                    <Text style={s.helpTitle}>Review purchased items</Text>
                  </View>
                  <Pressable disabled={completing} hitSlop={8} onPress={() => setCompletionReviewOpen(false)}>
                    <Ionicons name="close-circle" size={26} color={colors.textMuted} />
                  </Pressable>
                </View>
                <Text style={s.estimateLabel}>PURCHASE DETAILS</Text>
                <ScrollView style={s.reviewList} nestedScrollEnabled showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
                  {selectedGroups().map((item) => {
                    const key = item.name.toLowerCase();
                    const days = Number(expiryDays[key]);
                    const date = expiryDateForDays(expiryDays[key] ?? "");
                    const quantity = quantityParts(item.quantity);
                    return (
                      <View key={key} style={s.reviewItem}>
                        <View style={s.reviewItemTop}>
                          <View style={s.reviewNameRow}>
                            <View style={s.smallIngredientIcon}><Text>{ingredientEmojiFor(item.name)}</Text></View>
                            <View style={s.reviewNameBody}>
                              <Text style={s.reviewName}>{item.name}</Text>
                              <View style={s.reviewQuantityField}>
                                <TextInput
                                  accessibilityLabel={`${item.name} purchase quantity`}
                                  value={purchaseAmounts[key] ?? ""}
                                  maxLength={8}
                                  keyboardType="decimal-pad"
                                  selectTextOnFocus
                                  onChangeText={(value) => {
                                    if (/^\d*\.?\d*$/.test(value)) setPurchaseAmounts((current) => ({ ...current, [key]: value }));
                                  }}
                                  style={s.reviewQuantityInput}
                                />
                                {quantity?.unit ? <Text style={s.reviewQuantityUnit}>{quantity.unit}</Text> : null}
                              </View>
                            </View>
                          </View>
                          <View style={s.expiryFieldColumn}>
                            <Text style={s.expiryFieldLabel}>EXPIRATION DATE</Text>
                            <Pressable accessibilityLabel={`Select ${item.name} expiration date`} style={s.dateField} onPress={() => setExpiryCalendarItem(key)}>
                              <Ionicons name="calendar-outline" size={14} color={colors.adminStrong} />
                              <Text style={s.dateFieldText}>{date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</Text>
                            </Pressable>
                            <Text style={s.daysLeftText}>{Number.isInteger(days) && days >= 0 ? `${days} day${days === 1 ? "" : "s"} left` : ""}</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
                <View style={s.reviewActions}>
                  <Pressable disabled={completing} style={s.reviewCancel} onPress={() => setCompletionReviewOpen(false)}><Text style={s.reviewCancelText}>Go back</Text></Pressable>
                  <Pressable disabled={completing} style={s.reviewConfirm} onPress={() => void completeSelected()}>
                    {completing ? <ActivityIndicator size="small" color={colors.surface} /> : <><Ionicons name="checkmark" size={17} color={colors.surface} /><Text style={s.reviewConfirmText}>Add items</Text></>}
                  </Pressable>
                </View>
              </View>
            </View>
          )}
          <DatePickerSheet
            visible={Boolean(expiryCalendarItem)}
            value={dateToIso(expiryDateForDays(expiryCalendarItem ? expiryDays[expiryCalendarItem] ?? "0" : "0"))}
            title="Select expiration date"
            description="Choose when this purchased item is expected to expire."
            onClose={() => setExpiryCalendarItem(undefined)}
            onSelect={(value) => {
              if (!expiryCalendarItem) return;
              const selected = parse(value);
              selected.setHours(0, 0, 0, 0);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const days = Math.max(0, Math.round((selected.getTime() - today.getTime()) / 86_400_000));
              setExpiryDays((current) => ({ ...current, [expiryCalendarItem]: String(days) }));
              setExpiryCalendarItem(undefined);
            }}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: palette.crgba_23_60_57_45,
  },
  sheet: {
    height: "90%",
    padding: 16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.consumerCanvas,
  },
  head: { flexDirection: "row", justifyContent: "space-between" },
  headActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  green: { color: GREEN, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.black },
  title: { color: colors.text, fontSize: typography.mobile.rawSize.s20, fontWeight: typography.weight.black },
  tabs: {
    flexDirection: "row",
    marginTop: 12,
    padding: 3,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  tab: { flex: 1, alignItems: "center", padding: 9, borderRadius: 8 },
  active: { backgroundColor: colors.surface, shadowColor: colors.text, shadowOpacity: .08, shadowRadius: 3, elevation: 1 },
  tabText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.bold },
  activeText: { color: colors.primaryStrong, fontWeight: typography.weight.black },
  dateSection: { marginTop: 12, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surfaceMuted },
  dateHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 9 },
  dateHeadingActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  label: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.black, letterSpacing: .45 },
  swipeHint: { flexDirection: "row", alignItems: "center", gap: 3 },
  swipeText: { color: colors.textSubtle, fontSize: typography.mobile.rawSize.s8, fontWeight: typography.weight.bold },
  todayButton: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 5, borderWidth: 1, borderColor: colors.today, borderRadius: 9, backgroundColor: colors.today },
  todayText: { color: colors.surface, fontSize: typography.mobile.rawSize.s8, fontWeight: typography.weight.black },
  dateScroller: { width: "100%" },
  selected: { borderColor: colors.primary, backgroundColor: colors.primary },
  selectedText: { color: colors.surface },
  todayDay: { borderColor: colors.todayBorder, backgroundColor: colors.todaySoft },
  todaySelected: { borderColor: colors.today, backgroundColor: colors.today },
  todayDayText: { color: colors.todayStrong },
  rangeRow: {
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rangeText: { color: colors.text, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.black },
  rangeHint: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold },
  summaryCards: { flexDirection: "row", gap: 8, marginTop: 8 },
  summaryCard: { flex: 1, minHeight: 58, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderRadius: 12 },
  summaryHeading: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryCount: { fontSize: typography.mobile.rawSize.s17, fontWeight: typography.weight.black },
  summaryLabel: { marginTop: 2, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold },
  toShopCard: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  toShopText: { color: colors.danger },
  haveCard: { borderColor: colors.success, backgroundColor: colors.successSoft },
  haveText: { color: colors.success },
  day: {
    width: 48,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 62,
    marginHorizontal: 2,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  dayName: { color: colors.textSubtle, fontSize: typography.mobile.rawSize.s8, fontWeight: typography.weight.extrabold },
  dayNumber: { marginTop: 2, color: colors.text, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.black },
  monthName: { marginTop: 1, color: colors.textSubtle, fontSize: typography.mobile.rawSize.s7, fontWeight: typography.weight.bold },
  loading: { marginTop: 40 },
  state: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
    paddingHorizontal: 18,
  },
  error: {
    marginTop: 8,
    color: colors.danger,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 17,
    textAlign: "center",
  },
  emptyTitle: { color: colors.text, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.extrabold },
  emptyCopy: {
    marginTop: 5,
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    textAlign: "center",
  },
  list: { flex: 1, marginTop: 8 },
  listContent: { paddingBottom: 4 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 65,
    marginBottom: 6,
    padding: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  ingredientIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  emoji: { width: 24, color: colors.textMuted, fontSize: typography.mobile.rawSize.s20, lineHeight: 24, textAlign: "center" },
  body: { flex: 1, paddingHorizontal: 9 },
  name: { color: colors.text, fontWeight: typography.weight.extrabold },
  detail: { fontSize: typography.mobile.rawSize.s10, color: colors.textMuted },
  used: {
    marginTop: 3,
    padding: 3,
    fontSize: typography.mobile.rawSize.s8,
    color: colors.textSubtle,
    backgroundColor: colors.surfaceMuted,
  },
  check: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal:7, paddingVertical:5, borderRadius:9 },
  checkText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold },
  missingCheck: { backgroundColor: colors.dangerSoft },
  missingText: { color: colors.danger },
  purchasedCheck: { backgroundColor: colors.successSoft },
  purchasedText: { color: colors.success },
  complete: {
    flexDirection:"row",
    justifyContent:"center",
    gap:6,
    alignItems: "center",
    padding: 13,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  completeActive: { borderColor: colors.success, backgroundColor: colors.success },
  completeText: { color: colors.primaryStrong, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold },
  completeTextActive: { color: colors.surface },
  bottom: { flexDirection: "row", gap: 8, marginTop: 8 },
  nav: {
    flex: 1,
    flexDirection:"row",
    justifyContent:"center",
    gap:6,
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth:1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  navText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.bold },
  helpLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "center",
    padding: 18,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  helpBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: palette.crgba_23_60_57_45,
  },
  helpCard: { maxHeight: "82%", padding: 16, borderRadius: 18, backgroundColor: colors.surface },
  helpHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  helpTitleRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  helpTitle: { flex: 1, color: colors.text, fontSize: typography.mobile.rawSize.s16, fontWeight: typography.weight.black },
  helpCopy: { marginTop: 10, color: colors.text, fontSize: typography.mobile.rawSize.s12, lineHeight: 18 },
  helpNote: { marginTop: 9, padding: 9, borderRadius: 10, color: colors.textMuted, fontSize: typography.mobile.rawSize.s10, lineHeight: 15, backgroundColor: colors.adminSoft },
  helpDone: { alignItems: "center", marginTop: 12, padding: 12, borderRadius: 11, backgroundColor: colors.primary },
  helpDoneText: { color: colors.surface, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.black },
  reviewCard: { maxHeight: "88%" },
  estimateLabel: { marginTop: 12, color: colors.textMuted, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.black, letterSpacing: .5 },
  reviewList: { marginTop: 4 },
  reviewItem: { marginTop: 7, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surfaceMuted },
  reviewItemTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  reviewNameRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  smallIngredientIcon: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: colors.surface },
  reviewNameBody: { flex: 1 },
  reviewName: { color: colors.text, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold },
  reviewQuantityField: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  reviewQuantityInput: { width: 48, paddingHorizontal: 7, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface, color: colors.text, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.extrabold, textAlign: "center" },
  reviewQuantityUnit: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold },
  expiryFieldColumn: { alignItems: "flex-end" },
  expiryFieldLabel: { marginBottom: 4, color: colors.textSubtle, fontSize: typography.mobile.rawSize.s7, fontWeight: typography.weight.black, letterSpacing: .35 },
  dateField: { maxWidth: 135, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 8, borderWidth: 1, borderColor: colors.adminBorder, borderRadius: 9, backgroundColor: colors.surface },
  dateFieldText: { color: colors.text, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold },
  daysLeftText: { marginTop: 4, color: colors.adminStrong, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold },
  reviewActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  reviewCancel: { flex: 1, alignItems: "center", padding: 12, borderRadius: 11, backgroundColor: colors.surfaceMuted },
  reviewCancelText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold },
  reviewConfirm: { flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, padding: 12, borderRadius: 11, backgroundColor: colors.success },
  reviewConfirmText: { color: colors.surface, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.black },
});
