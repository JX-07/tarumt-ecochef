import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplacePromotion } from "@ecochef/contracts";
import { Pressable, StyleSheet, View } from "react-native";

export function PromotionCard({
  promotion,
  onPress,
}: {
  promotion: MarketplacePromotion;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View promotion ${promotion.title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Ionicons name="pricetag-outline" size={spacing[4]} color={colors.marketStrong} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {promotion.title}
        </Text>
        <Text style={styles.description} numberOfLines={1}>
          {promotion.free_delivery
            ? "Free delivery"
            : promotion.discount_percent
              ? `${Number(promotion.discount_percent)}% off`
              : promotion.discount_amount
                ? `RM ${Number(promotion.discount_amount).toFixed(2)} off`
                : promotion.description}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={spacing[4]} color={colors.marketStrong} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: {
    minWidth: spacing[16] * 3 + spacing[5],
    maxWidth: spacing[16] * 4 + spacing[6],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.marketBorder,
    borderRadius: spacing[3],
    backgroundColor: colors.marketSoft,
  },
  copy: { flex: 1 },
  title: {
    color: colors.text,
    fontSize: typography.mobile.size.caption,
    fontWeight: typography.weight.bold,
  },
  description: {
    marginTop: spacing[1],
    color: colors.marketStrong,
    fontSize: typography.mobile.size.caption,
    fontWeight: typography.weight.semibold,
  },
  pressed: { opacity: 0.68 },
});
