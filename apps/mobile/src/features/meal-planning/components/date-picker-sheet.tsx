import { Text } from "../../../shared/components/themed-text";
import { palette, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, View } from "react-native";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const GREEN = palette.c12ad55;
const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const dateToIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const todayIso = () => dateToIso(new Date());
const parse = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};
export const displayPlanDate = (value: string) =>
  parse(value).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function DatePickerSheet({
  visible,
  value,
  onSelect,
  onClose,
  title = "Select date",
  description = "Choose a day for this meal.",
}: {
  visible: boolean;
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  title?: string;
  description?: string;
}) {
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(() => new Date());
  useEffect(() => {
    if (visible) {
      const selected = parse(value);
      setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    }
  }, [visible, value]);
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const count = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - offset + 1;
      return day >= 1 && day <= count
        ? new Date(month.getFullYear(), month.getMonth(), day)
        : null;
    });
  }, [month]);
  const sheetMotion = useBottomSheetSlide(visible);
  const choose = (date: Date) => {
    onSelect(dateToIso(date));
    onClose();
  };
  const move = (amount: number) =>
    setMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + amount, 1),
    );
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14) }, sheetMotion]}
        >
          <View style={styles.head}>
            <View>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.copy}>{description}</Text>
            </View>
            <Pressable style={styles.close} onPress={onClose}>
              <Ionicons name="close" size={18} color={palette.c5f6c7d} />
            </Pressable>
          </View>
          <View style={styles.monthHead}>
            <Pressable style={styles.arrow} onPress={() => move(-1)}>
              <Ionicons name="chevron-back" size={20} color={palette.c647184} />
            </Pressable>
            <Text style={styles.month}>
              {month.toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </Text>
            <Pressable style={styles.arrow} onPress={() => move(1)}>
              <Ionicons name="chevron-forward" size={20} color={palette.c647184} />
            </Pressable>
          </View>
          <View style={styles.weekdays}>
            {weekdays.map((day) => (
              <Text key={day} style={styles.weekday}>
                {day}
              </Text>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((date, index) => {
              if (!date)
                return <View key={`blank-${index}`} style={styles.day} />;
              const iso = dateToIso(date),
                selected = iso === value,
                isToday = iso === todayIso();
              return (
                <Pressable
                  key={iso}
                  accessibilityLabel={displayPlanDate(iso)}
                  accessibilityState={{ selected }}
                  style={[
                    styles.day,
                    selected && styles.daySelected,
                    isToday && !selected && styles.dayToday,
                  ]}
                  onPress={() => choose(date)}
                >
                  <Text
                    style={[styles.dayText, selected && styles.dayTextSelected]}
                  >
                    {date.getDate()}
                  </Text>
                  {isToday && (
                    <View
                      style={[
                        styles.todayDot,
                        selected && styles.todayDotSelected,
                      ]}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={styles.todayButton}
            onPress={() => choose(new Date())}
          >
            <Ionicons name="today-outline" size={17} color={GREEN} />
            <Text style={styles.todayText}>Go to today</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: palette.crgba_21_29_25_44,
  },
  sheet: {
    minHeight: 470,
    paddingTop: 19,
    paddingHorizontal: 19,
    paddingBottom: 19,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    backgroundColor: palette.cfff,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: palette.c17283c, fontSize: typography.mobile.rawSize.s20, fontWeight: typography.weight.black },
  copy: { marginTop: 4, color: palette.c8993a1, fontSize: typography.mobile.rawSize.s11 },
  close: {
    width: 35,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: palette.cf0f2f4,
  },
  monthHead: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
  },
  arrow: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: palette.cf4f6f5,
  },
  month: { color: palette.c2a3c4f, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.black },
  weekdays: { flexDirection: "row", marginTop: 5 },
  weekday: {
    width: "14.2857%",
    color: palette.c929ca8,
    fontSize: typography.mobile.rawSize.s8,
    fontWeight: typography.weight.black,
    textAlign: "center",
  },
  grid: { height: 270, flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  day: {
    width: "14.2857%",
    height: 45,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  daySelected: { backgroundColor: GREEN },
  dayToday: {
    borderWidth: 1,
    borderColor: palette.c90d5aa,
    backgroundColor: palette.ceff9f2,
  },
  dayText: { color: palette.c445266, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold },
  dayTextSelected: { color: palette.cfff },
  todayDot: {
    position: "absolute",
    bottom: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: GREEN,
  },
  todayDotSelected: { backgroundColor: palette.cfff },
  todayButton: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 12,
    borderWidth: 1,
    borderColor: palette.cbde3cb,
    borderRadius: 13,
    backgroundColor: palette.cf3faf5,
  },
  todayText: { color: GREEN, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.black },
});
