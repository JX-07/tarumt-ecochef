import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, typography } from "@ecochef/design-tokens";
import { Pressable, StyleSheet, View } from "react-native";

export function CartButton({
  count,
  onPress,
  disabled = false,
}: {
  count: number;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      accessibilityLabel={
        disabled
          ? "Shop closed today; cart unavailable"
          : `Open cart, ${count} item${count === 1 ? "" : "s"}`
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name="cart-outline" size={22} color={colors.text} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 21,
    backgroundColor: colors.surface,
    elevation: 2,
  },
  badge: {
    position: "absolute",
    right: -3,
    top: -4,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.market,
  },
  badgeText: {
    color: colors.surface,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.black,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
