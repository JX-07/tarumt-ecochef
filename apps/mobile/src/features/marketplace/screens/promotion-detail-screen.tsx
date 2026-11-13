import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplacePromotion, MarketplaceStoreDetail } from "@ecochef/contracts";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createMobileApi } from "../../../lib/api";
import { useAuth } from "../../auth/auth-provider";
import { useBottomSlidePageExit } from "../bottom-slide-page";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

const parameter = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
export function PromotionDetailScreen() {
  const params = useLocalSearchParams<{
    storeId?: string | string[];
    promotionId?: string | string[];
  }>();
  const storeId = parameter(params.storeId),
    promotionId = parameter(params.promotionId);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { close, animatedStyle } = useBottomSlidePageExit(
    storeId ? `/marketplace/${storeId}` : undefined,
  );
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [store, setStore] = useState<MarketplaceStoreDetail>();
  const [promotion, setPromotion] = useState<MarketplacePromotion>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!storeId || !promotionId) return;
    let active = true;
    void api
      .getMarketplaceStore<MarketplaceStoreDetail>(storeId)
      .then((result) => {
        if (!active) return;
        setStore(result);
        const match = result.promotions.find((item) => item.id === promotionId);
        if (match) setPromotion(match);
        else setError("This promotion is no longer available.");
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Promotion details could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [api, storeId, promotionId]);
  if (!promotion && !error)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  return (
    <Animated.View style={[styles.root, animatedStyle]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing[4], paddingBottom: insets.bottom + spacing[8] },
        ]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={close}
            style={styles.back}
          >
            <Ionicons name="chevron-down" size={spacing[6]} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Promotion details</Text>
          <View style={styles.headerSpace} />
        </View>
        {error || !promotion ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={styles.icon}>
                <Ionicons name="pricetag" size={spacing[8]} color={colors.marketStrong} />
              </View>
              <Text style={styles.shop}>
                {promotion.store_id ? store?.name : "EcoChef Marketplace"}
              </Text>
              <Text style={styles.title}>{promotion.title}</Text>
              <Text style={styles.offer}>{promotionLabel(promotion)}</Text>
              {promotion.code ? (
                <View style={styles.code}>
                  <Text style={styles.codeLabel}>CODE</Text>
                  <Text style={styles.codeValue}>{promotion.code}</Text>
                </View>
              ) : null}
            </View>
            <Detail
              icon="calendar-outline"
              title="Valid period"
              value={`${formatDate(promotion.start_date)} – ${formatDate(promotion.end_date)}`}
            />
            <Detail
              icon="receipt-outline"
              title="Terms & conditions"
              value={
                promotion.description?.trim() || "Promotion applies while the offer is active."
              }
            />
            {promotion.minimum_order_amount > 0 ? (
              <Detail
                icon="basket-outline"
                title="Minimum order"
                value={`RM ${Number(promotion.minimum_order_amount).toFixed(2)}`}
              />
            ) : null}
            {promotion.free_delivery ? (
              <Detail
                icon="bicycle-outline"
                title="Delivery"
                value="Free delivery is included with this promotion."
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </Animated.View>
  );
}
function Detail({
  icon,
  title,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
}) {
  return (
    <View style={styles.detail}>
      <View style={styles.detailIcon}>
        <Ionicons name={icon} size={spacing[5]} color={colors.primaryStrong} />
      </View>
      <View style={styles.detailCopy}>
        <Text style={styles.detailTitle}>{title}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}
function promotionLabel(promotion: MarketplacePromotion) {
  if (promotion.free_delivery) return "Free delivery";
  if (promotion.discount_percent) return `${Number(promotion.discount_percent)}% off`;
  if (promotion.discount_amount) return `RM ${Number(promotion.discount_amount).toFixed(2)} off`;
  return "Special shop offer";
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
const textSize = typography.mobile.size;
const textWeight = typography.weight;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  content: { paddingHorizontal: spacing[4] },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.consumerCanvas,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing[6] },
  back: {
    width: spacing[10],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[5],
    backgroundColor: colors.surface,
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: textSize.bodyTextHeavy,
    fontWeight: textWeight.bold,
    textAlign: "center",
  },
  headerSpace: { width: spacing[10] },
  hero: {
    alignItems: "center",
    padding: spacing[6],
    borderWidth: 1,
    borderColor: colors.marketBorder,
    borderRadius: spacing[5],
    backgroundColor: colors.marketSoft,
  },
  icon: {
    width: spacing[16],
    height: spacing[16],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[8],
    backgroundColor: colors.surface,
  },
  shop: {
    marginTop: spacing[3],
    color: colors.textMuted,
    fontSize: textSize.caption,
    fontWeight: textWeight.semibold,
  },
  title: {
    marginTop: spacing[1],
    color: colors.text,
    fontSize: textSize.bodyTextHeavy,
    fontWeight: textWeight.bold,
    textAlign: "center",
  },
  offer: {
    marginTop: spacing[2],
    color: colors.marketStrong,
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  code: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[4],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.marketBorder,
    borderRadius: spacing[3],
    backgroundColor: colors.surface,
  },
  codeLabel: { color: colors.textMuted, fontSize: textSize.caption, fontWeight: textWeight.bold },
  codeValue: {
    color: colors.marketStrong,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  detail: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    marginTop: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  detailIcon: {
    width: spacing[10],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[3],
    backgroundColor: colors.primarySoft,
  },
  detailCopy: { flex: 1 },
  detailTitle: {
    color: colors.text,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  detailValue: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: textSize.caption,
    lineHeight: spacing[5],
  },
  error: { color: colors.danger, fontSize: textSize.secondaryInteraction, textAlign: "center" },
});
