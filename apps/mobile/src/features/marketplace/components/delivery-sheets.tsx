import { Text } from "../../../shared/components/themed-text";
import type { MarketplaceSlotAvailability } from "@ecochef/contracts";
import { Ionicons } from "@expo/vector-icons";
import { colors, typography } from "@ecochef/design-tokens";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function DeliveryChoiceSheet({
  visible,
  addressSummary,
  arrivalSummary,
  onAddress,
  onTime,
  onClose,
}: {
  visible: boolean;
  addressSummary?: string;
  arrivalSummary?: string;
  onAddress: () => void;
  onTime: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const sheetMotion = useBottomSheetSlide(visible);
  const choose = (action: () => void) => {
    onClose();
    requestAnimationFrame(action);
  };
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) + 30 }, sheetMotion]}
        >
          <View style={styles.grabber} />
          <Text style={styles.title}>Delivery options</Text>
          <Text style={styles.copy}>Choose where and when your order should arrive.</Text>
          <Option
            icon="location-outline"
            title="Delivery address"
            subtitle={addressSummary ?? "Choose or add a delivery location"}
            onPress={() => choose(onAddress)}
          />
          <Option
            icon="time-outline"
            title="Delivery arrival time"
            subtitle={arrivalSummary ?? "Deliver now"}
            tone="blue"
            onPress={() => choose(onTime)}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

function Option({
  icon,
  title,
  subtitle,
  tone = "green",
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  tone?: "green" | "blue";
  onPress: () => void;
}) {
  const blue = tone === "blue";
  return (
    <Pressable
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={[styles.optionIcon, blue && styles.optionIconBlue]}>
        <Ionicons name={icon} size={22} color={blue ? colors.adminStrong : colors.primaryStrong} />
      </View>
      <View style={styles.optionCopy}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={blue ? colors.admin : colors.textSubtle} />
    </Pressable>
  );
}

// Malaysia store time stays consistent even when the customer's phone is abroad.
const malaysiaDate = (date: Date) => new Date(date.getTime() + 8 * 60 * 60 * 1000);
const dateKey = (date: Date) => malaysiaDate(date).toISOString().slice(0, 10);
const displayTime = (date: Date) =>
  date.toLocaleTimeString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
const displayWindow = (date: Date) =>
  `${displayTime(date)} – ${displayTime(new Date(date.getTime() + 30 * 60 * 1000))}`;
const weekdayLabel = (date: Date) =>
  ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"][malaysiaDate(date).getUTCDay()];
export function DeliveryTimeSheet({
  visible,
  value,
  deliveryFee,
  onSelect,
  onClearCart,
  onClose,
  loadAvailability,
  scheduledOnly = false,
}: {
  scheduledOnly?: boolean;
  loadAvailability: (day: string) => Promise<MarketplaceSlotAvailability>;
  visible: boolean;
  value?: string;
  deliveryFee: number;
  onSelect: (value?: string) => void;
  onClearCart: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const sheetMotion = useBottomSheetSlide(visible);
  const [tick, setTick] = useState(Date.now());
  const dates = useMemo(
    () =>
      Array.from({ length: 8 }, (_, offset) => {
        const date = new Date(`${dateKey(new Date())}T00:00:00+08:00`);
        date.setTime(date.getTime() + offset * 86400000);
        return date;
      }),
    [visible],
  );
  const [day, setDay] = useState(dateKey(dates[0]));
  const [draftValue, setDraftValue] = useState<string>();
  const switchDay = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= dates.length) return;
    const key = dateKey(dates[nextIndex]);
    setDay(key);
    if (!draftValue || dateKey(new Date(draftValue)) !== key) setDraftValue(undefined);
  };
  useEffect(() => {
    if (!visible) return;
    const now = Date.now();
    setTick(now);
    const selected = value ? new Date(value) : undefined;
    const selectedDay =
      selected &&
      !Number.isNaN(selected.getTime()) &&
      dates.some((item) => dateKey(item) === dateKey(selected))
        ? dateKey(selected)
        : dateKey(dates[0]);
    setDay(selectedDay);
    setDraftValue(value);
    const timer = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [visible, value, dates]);
  const selectedDate = dates.find((item) => dateKey(item) === day) ?? dates[0];
  const [availability, setAvailability] = useState<MarketplaceSlotAvailability>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    setLoadError(undefined);
    setAvailability(undefined);
    loadAvailability(day)
      .then((result) => {
        if (active) setAvailability(result);
      })
      .catch((reason) => {
        if (active)
          setLoadError(
            reason instanceof Error
              ? reason.message
              : "Availability could not be checked. Try again.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible, day, tick, loadAvailability]);
  const selectedSlot = availability?.slots.find(
    (slot) => draftValue && new Date(slot.start).getTime() === new Date(draftValue).getTime(),
  );
  const invalid =
    !!draftValue &&
    !loading &&
    !loadError &&
    (!selectedSlot?.available || new Date(draftValue).getTime() < tick + 30 * 60 * 1000);
  const confirm = () => {
    if (!draftValue || invalid || loading || loadError || !selectedSlot?.available) return;
    onSelect(draftValue);
    onClose();
  };
  const deliverNow = () => {
    onSelect(undefined);
    onClose();
  };
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[styles.timeSheet, { paddingBottom: Math.max(insets.bottom, 12) }, sheetMotion]}
        >
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <View style={styles.optionCopy}>
              <Text style={styles.title}>
                {scheduledOnly ? "Order later" : "Schedule delivery"}
              </Text>
              <Text style={styles.copy}>
                Choose a 30-minute window in Malaysia time. Availability is rechecked at payment.
              </Text>
            </View>
            <Pressable style={styles.close} onPress={onClose}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
          {invalid && (
            <View style={styles.warning}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.marketStrong} />
              <View style={styles.optionCopy}>
                <Text style={styles.warningTitle}>This time is no longer available</Text>
                <Text style={styles.warningCopy}>
                  {selectedSlot?.reason ?? "Choose another available window."}
                </Text>
              </View>
            </View>
          )}
          <Text style={[styles.pickerLabel, styles.deliveryDateLabel]}>DELIVERY DATE</Text>
          <ScrollView
            horizontal
            style={styles.dayScroller}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.days}
          >
            {dates.map((date, index) => {
              const key = dateKey(date),
                active = key === day;
              return (
                <Pressable
                  key={key}
                  style={({ pressed }) => [
                    styles.day,
                    active && styles.dayActive,
                    pressed && styles.dayPressed,
                  ]}
                  onPress={() => switchDay(index)}
                >
                  <Text style={[styles.dayTop, active && styles.dayTextActive]}>
                    {index === 0 ? "Today" : weekdayLabel(date)}
                  </Text>
                  <Text style={[styles.dayDate, active && styles.dayTextActive]}>
                    {date.toLocaleDateString("en-MY", {
                      timeZone: "Asia/Kuala_Lumpur",
                      day: "numeric",
                      month: "short",
                    })}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={[styles.pickerLabel, styles.arrivalLabel]}>ARRIVAL TIME</Text>
          <View style={styles.slotPager}>
            {loading ? (
              <View style={styles.noSlots}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.optionSubtitle}>Checking shop availability…</Text>
              </View>
            ) : loadError ? (
              <View style={styles.noSlots}>
                <Text style={styles.optionSubtitle}>{loadError}</Text>
                <Pressable onPress={() => setTick(Date.now())}>
                  <Text style={styles.clear}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.copy}>
                  {scheduledOnly
                    ? "Shop opening hours and capacity checked. The final 30 minutes before closing are excluded."
                    : availability?.cart_checked
                      ? "Based on the items currently in your basket."
                      : "Add items to your basket to check each shop's capacity."}
                </Text>
                <ArrivalTimeList
                  slots={availability?.slots ?? []}
                  draftValue={draftValue}
                  deliveryFee={deliveryFee}
                  onSelect={setDraftValue}
                />
              </>
            )}
          </View>
          <View style={styles.bottomActions}>
            {!scheduledOnly && (
              <Pressable
                style={[styles.deliverNow, !draftValue && styles.deliverNowActive]}
                onPress={deliverNow}
              >
                <Text style={styles.deliverNowText}>Deliver now</Text>
              </Pressable>
            )}
            <Pressable
              disabled={
                !draftValue || invalid || loading || !!loadError || !selectedSlot?.available
              }
              style={[
                styles.confirm,
                (!draftValue || invalid || loading || !!loadError || !selectedSlot?.available) &&
                  styles.confirmDisabled,
              ]}
              onPress={confirm}
            >
              <Text style={styles.confirmText}>
                {draftValue && !invalid
                  ? `Confirm ${displayWindow(new Date(draftValue))}`
                  : "Select an arrival time"}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function ArrivalTimeList({
  slots,
  draftValue,
  deliveryFee,
  onSelect,
}: {
  slots: MarketplaceSlotAvailability["slots"];
  draftValue?: string;
  deliveryFee: number;
  onSelect: (value: string) => void;
}) {
  return (
    <ScrollView style={styles.slots} contentContainerStyle={styles.slotContent}>
      {slots.length ? (
        slots.map((slot) => {
          const iso = new Date(slot.start).toISOString(),
            active = draftValue === iso;
          return (
            <Pressable
              key={iso}
              accessibilityRole="radio"
              accessibilityState={{ disabled: !slot.available, selected: active }}
              disabled={!slot.available}
              style={[styles.slot, active && styles.slotActive, !slot.available && styles.pressed]}
              onPress={() => onSelect(iso)}
            >
              <Ionicons
                name={active ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={active ? colors.primaryStrong : colors.textSubtle}
              />
              <View style={styles.optionCopy}>
                <Text style={[styles.slotTime, active && styles.slotTimeActive]}>
                  {displayWindow(new Date(iso))}
                </Text>
                {!slot.available ? <Text style={styles.optionSubtitle}>{slot.reason}</Text> : null}
              </View>
              <Text style={styles.slotPrice}>
                {slot.available
                  ? deliveryFee > 0
                    ? `RM ${deliveryFee.toFixed(2)}`
                    : "Free"
                  : "Unavailable"}
              </Text>
            </Pressable>
          );
        })
      ) : (
        <View style={styles.noSlots}>
          <Ionicons name="moon-outline" size={28} color={colors.textSubtle} />
          <Text style={styles.optionSubtitle}>
            No delivery windows remain today. Choose another day.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  sheet: {
    padding: 18,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    backgroundColor: colors.consumerCanvas,
  },
  timeSheet: {
    height: "72%",
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    backgroundColor: colors.consumerCanvas,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    marginBottom: 10,
    borderRadius: 2,
    backgroundColor: colors.primaryBorder,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s18,
    fontWeight: typography.weight.black,
  },
  copy: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 14,
  },
  close: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  option: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.65 },
  optionIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
  },
  optionIconBlue: { backgroundColor: colors.adminSoft },
  optionCopy: { flex: 1 },
  optionTitle: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.black,
  },
  optionSubtitle: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
  },
  warning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 8,
    padding: 9,
    borderWidth: 1,
    borderColor: colors.marketBorder,
    borderRadius: 13,
    backgroundColor: colors.marketSoft,
  },
  warningTitle: {
    color: colors.marketStrong,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.black,
  },
  warningCopy: { marginTop: 2, color: colors.textMuted, fontSize: typography.mobile.rawSize.s9 },
  clear: {
    color: colors.danger,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.black,
  },
  pickerLabel: {
    marginTop: 9,
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.black,
    letterSpacing: 0.7,
  },
  deliveryDateLabel: { marginBottom: 10 },
  arrivalLabel: { marginTop: 14 },
  dayScroller: { flexGrow: 0, height: 65, marginBottom: 12 },
  days: { height: 65, alignItems: "center", gap: 9, paddingHorizontal: 2 },
  day: {
    width: 82,
    height: 65,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
  },
  dayActive: {
    borderColor: colors.primaryStrong,
    backgroundColor: colors.primaryStrong,
    shadowColor: colors.primaryStrong,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  dayPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  dayTop: {
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.black,
  },
  dayDate: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  dayTextActive: { color: colors.surface },
  slotPager: { flex: 1, overflow: "hidden" },
  pagerPage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.consumerCanvas,
  },
  slots: { flex: 1, marginTop: 4 },
  slotContent: { paddingBottom: 10 },
  slot: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 6,
    paddingRight: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.textSubtle,
  },
  slotActive: { backgroundColor: colors.primarySoft },
  slotCopy: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  slotTime: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  slotTimeActive: { color: colors.primaryStrong },
  slotWindow: { marginTop: 2, color: colors.textSubtle, fontSize: typography.mobile.rawSize.s8 },
  peakTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.marketSoft,
  },
  peakTagText: {
    color: colors.marketStrong,
    fontSize: typography.mobile.rawSize.s8,
    fontWeight: typography.weight.black,
  },
  slotPrice: {
    color: colors.primaryStrong,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.black,
  },
  noSlots: { alignItems: "center", gap: 10, padding: 30 },
  bottomActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  confirm: {
    height: 50,
    flex: 3,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: colors.primary,
  },
  confirmDisabled: { backgroundColor: colors.primaryBorder },
  confirmText: {
    color: colors.surface,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  deliverNow: {
    height: 50,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    backgroundColor: colors.surface,
  },
  deliverNowActive: { backgroundColor: colors.surfaceMuted, borderColor: colors.textSubtle },
  deliverNowText: {
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.black,
    textAlign: "center",
  },
});
