import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, typography } from "@ecochef/design-tokens";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

export function QuantityStepper({ quantity, maximum, busy, onChange }: { quantity: number; maximum: number; busy?: boolean; onChange: (quantity: number) => void }) {
  if (busy) return <ActivityIndicator size="small" color={colors.primary} />;
  if (quantity <= 0) return <Pressable accessibilityLabel="Add item to cart" disabled={maximum <= 0} onPress={() => onChange(1)} style={[styles.add, maximum <= 0 && styles.disabled]}><Ionicons name="add" size={17} color={colors.surface} /></Pressable>;
  return <View style={styles.row}>
    <Pressable accessibilityLabel="Decrease quantity" onPress={() => onChange(quantity - 1)} style={styles.minus}><Ionicons name="remove" size={15} color={colors.primaryStrong} /></Pressable>
    <Text style={styles.quantity}>{quantity}</Text>
    <Pressable accessibilityLabel="Increase quantity" disabled={quantity >= maximum} onPress={() => onChange(quantity + 1)} style={[styles.add, quantity >= maximum && styles.disabled]}><Ionicons name="add" size={15} color={colors.surface} /></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 7 },
  add: { width: 25, height: 25, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.primary },
  minus: { width: 25, height: 25, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.primarySoft },
  quantity: { minWidth: 13, color: colors.text, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.black, textAlign: "center" },
  disabled: { opacity: .32 },
});
