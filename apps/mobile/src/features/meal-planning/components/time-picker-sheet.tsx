import { Text, TextInput } from "../../../shared/components/themed-text";
import { palette, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, View } from "react-native";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const GREEN = palette.c12ad55;
const display = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
};

export const displayMealTime = (value?: string) => (value ? display(value.slice(0, 5)) : "--:--");

export function TimePickerSheet({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const sheetMotion = useBottomSheetSlide(visible);
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [period, setPeriod] = useState<"AM" | "PM">("PM");
  useEffect(() => {
    if (!visible) return;
    const now = new Date();
    const [rawHour, rawMinute] = value?.slice(0, 5).split(":").map(Number) ?? [
      now.getHours(),
      now.getMinutes(),
    ];
    setHour(rawHour % 12 || 12);
    setMinute(Number.isFinite(rawMinute) && rawMinute >= 0 ? rawMinute : 0);
    setPeriod(rawHour >= 12 ? "PM" : "AM");
  }, [visible, value]);
  const apply = () => {
    const hour24 = (hour % 12) + (period === "PM" ? 12 : 0);
    onSelect(`${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    onClose();
  };
  const reset = () => {
    onSelect("");
    onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14) }, sheetMotion]}
        >
          <View style={styles.head}>
            <View>
              <Text style={styles.title}>Customize time</Text>
              <Text style={styles.copy}>Set the exact hour and minute.</Text>
            </View>
            <Pressable style={styles.close} onPress={onClose}>
              <Ionicons name="close" size={18} color={palette.c5f6c7d} />
            </Pressable>
          </View>
          <View style={styles.picker}>
            <View style={styles.column}>
              <Text style={styles.columnLabel}>HOUR</Text>
              <Pressable
                accessibilityLabel="Increase hour"
                style={styles.step}
                onPress={() => setHour((current) => (current === 12 ? 1 : current + 1))}
              >
                <Ionicons name="add" size={23} color={GREEN} />
              </Pressable>
              <TextInput
                accessibilityLabel="Hour"
                value={String(hour)}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                style={[styles.valueBox, styles.value]}
                onChangeText={(text) => {
                  if (!/^\d{1,2}$/.test(text)) return;
                  const next = Number(text);
                  if (next >= 1 && next <= 12) setHour(next);
                }}
              />
              <Pressable
                accessibilityLabel="Decrease hour"
                style={styles.step}
                onPress={() => setHour((current) => (current === 1 ? 12 : current - 1))}
              >
                <Ionicons name="remove" size={23} color={GREEN} />
              </Pressable>
            </View>
            <Text style={styles.colon}>:</Text>
            <View style={styles.column}>
              <Text style={styles.columnLabel}>MINUTE</Text>
              <Pressable
                accessibilityLabel="Increase minute"
                style={styles.step}
                onPress={() => setMinute((current) => (current + 1) % 60)}
              >
                <Ionicons name="add" size={23} color={GREEN} />
              </Pressable>
              <TextInput
                accessibilityLabel="Minute"
                value={String(minute).padStart(2, "0")}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                style={[styles.valueBox, styles.value]}
                onChangeText={(text) => {
                  if (!/^\d{1,2}$/.test(text)) return;
                  const next = Number(text);
                  if (next >= 0 && next <= 59) setMinute(next);
                }}
              />
              <Pressable
                accessibilityLabel="Decrease minute"
                style={styles.step}
                onPress={() => setMinute((current) => (current + 59) % 60)}
              >
                <Ionicons name="remove" size={23} color={GREEN} />
              </Pressable>
            </View>
            <View style={styles.periods}>
              {(["AM", "PM"] as const).map((item) => (
                <Pressable
                  key={item}
                  style={[styles.period, period === item && styles.periodActive]}
                  onPress={() => setPeriod(item)}
                >
                  <Text style={[styles.periodText, period === item && styles.periodTextActive]}>
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.preview}>
            <Ionicons name="time-outline" size={19} color={GREEN} />
            <Text style={styles.previewText}>
              {hour}:{String(minute).padStart(2, "0")} {period}
            </Text>
          </View>
          <View style={timeActionStyles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset selected time"
              style={({ pressed }) => [
                timeActionStyles.button,
                timeActionStyles.reset,
                pressed && timeActionStyles.pressed,
              ]}
              onPress={reset}
            >
              <Ionicons name="refresh-outline" size={17} color={palette.c657184} />
              <Text style={timeActionStyles.resetText}>Reset time</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Apply selected time"
              style={({ pressed }) => [
                timeActionStyles.button,
                timeActionStyles.apply,
                pressed && timeActionStyles.pressed,
              ]}
              onPress={apply}
            >
              <Ionicons name="checkmark" size={18} color={palette.cfff} />
              <Text style={styles.applyText}>Apply time</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: palette.crgba_21_29_25_44 },
  sheet: {
    padding: 19,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    backgroundColor: palette.cfff,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: {
    color: palette.c17283c,
    fontSize: typography.mobile.rawSize.s20,
    fontWeight: typography.weight.black,
  },
  copy: { marginTop: 4, color: palette.c8993a1, fontSize: typography.mobile.rawSize.s11 },
  close: {
    width: 35,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: palette.cf0f2f4,
  },
  toggleRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: palette.ce1e5e3,
    borderRadius: 14,
    backgroundColor: palette.cf8faf8,
  },
  toggleCopy: { flex: 1 },
  toggleTitle: {
    color: palette.c34483f,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.black,
  },
  toggleHint: {
    marginTop: 3,
    color: palette.c86918b,
    fontSize: typography.mobile.rawSize.s9,
    lineHeight: 13,
  },
  controls: { opacity: 1 },
  controlsDisabled: { opacity: 0.32 },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 13,
  },
  column: { width: 92, alignItems: "center" },
  columnLabel: {
    marginBottom: 4,
    color: palette.c7b8796,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.black,
    letterSpacing: 0.7,
  },
  step: { width: 50, height: 34, alignItems: "center", justifyContent: "center" },
  valueBox: {
    width: 82,
    height: 67,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.cb8dfc7,
    borderRadius: 16,
    backgroundColor: palette.ceff9f2,
  },
  value: {
    color: palette.c173d2a,
    fontSize: typography.mobile.rawSize.s31,
    fontWeight: typography.weight.black,
    padding: 0,
    textAlign: "center",
  },
  colon: {
    marginTop: 24,
    color: palette.c506071,
    fontSize: typography.mobile.rawSize.s29,
    fontWeight: typography.weight.black,
  },
  periods: { gap: 8, marginTop: 23 },
  period: {
    width: 55,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.cdfe3e6,
    borderRadius: 12,
    backgroundColor: palette.cf8f9fa,
  },
  periodActive: { borderColor: GREEN, backgroundColor: GREEN },
  periodText: {
    color: palette.c657184,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  periodTextActive: { color: palette.cfff },
  preview: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    borderRadius: 13,
    backgroundColor: palette.cf4f8f5,
  },
  previewText: {
    color: palette.c264639,
    fontSize: typography.mobile.rawSize.s16,
    fontWeight: typography.weight.black,
  },
  apply: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 15,
    borderRadius: 14,
    backgroundColor: GREEN,
  },
  applyText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
});
const timeActionStyles = StyleSheet.create({
  actions: { flexDirection: "row", gap: 10, marginTop: 15 },
  button: {
    flex: 1,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
  },
  reset: { borderWidth: 1, borderColor: palette.cdce2df, backgroundColor: palette.cfff },
  apply: { backgroundColor: GREEN },
  pressed: { opacity: 0.65, transform: [{ scale: 0.985 }] },
  resetText: {
    color: palette.c657184,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
  },
});
