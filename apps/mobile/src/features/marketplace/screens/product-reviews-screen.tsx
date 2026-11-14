import { apiBaseUrl } from "../../../lib/api-url";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplaceReviewPrompt, MarketplaceReviewPromptList } from "@ecochef/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../../../shared/components/themed-text";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { createMobileApi } from "../../../lib/api";
import { useAuth } from "../../auth/auth-provider";
import { ProductReviewForm } from "../components/product-review-form";

export function ProductReviewsScreen() {
  const { orderId, storeId } = useLocalSearchParams<{ orderId?: string; storeId?: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [items, setItems] = useState<MarketplaceReviewPrompt[]>([]);
  const [selected, setSelected] = useState<MarketplaceReviewPrompt>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setItems(
        (
          await api.getMarketplaceReviewPrompts<MarketplaceReviewPromptList>({
            order_id: orderId,
            store_id: storeId,
          })
        ).items,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Purchased items could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [api, orderId, storeId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing[5],
          paddingTop: insets.top + PAGE_TOP_GAP,
          paddingBottom: insets.bottom + spacing[6],
        }}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to purchase history"
            style={styles.back}
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace("/account?section=purchases" as never)
            }
          >
            <Ionicons name="chevron-back" size={22} color={colors.textMuted} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Rating History</Text>
            <Text style={styles.subtitle}>Your verified purchases and ratings</Text>
          </View>
        </View>
        <Text style={styles.help}>
          Ratings unlock after the shop completes your paid order. You can rate each item once.
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : error ? (
          <Pressable onPress={() => void load()}>
            <Text style={styles.error}>{error} Tap to retry.</Text>
          </Pressable>
        ) : !items.length ? (
          <Text style={styles.help}>
            No completed purchases to rate yet. Items appear here once their orders are completed.
          </Text>
        ) : (
          items.map((item) => (
            <View key={item.product_id} style={styles.card}>
              <View style={styles.body}>
                <Text style={styles.name}>{item.product_name}</Text>
                <Text style={styles.help}>{item.store_name}</Text>
                <Text style={styles.meta}>Order #{item.order_id.slice(0, 8).toUpperCase()}</Text>
                <Text style={styles.meta}>
                  {item.reviewed ? "Rated" : "Purchased"}{" "}
                  {new Date(
                    item.reviewed && item.rated_at ? item.rated_at : item.purchased_at,
                  ).toLocaleDateString("en-MY", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    timeZone: "Asia/Kuala_Lumpur",
                  })}
                </Text>
                {item.reviewed ? (
                  <View
                    style={styles.ratingRow}
                    accessibilityLabel={`Your rating: ${item.rating ?? 0} out of 5 stars`}
                  >
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Ionicons
                        key={star}
                        name={star <= (item.rating ?? 0) ? "star" : "star-outline"}
                        size={18}
                        color={colors.ratingStar}
                      />
                    ))}
                    <Text style={styles.ratingValue}>{(item.rating ?? 0).toFixed(1)}/5.0</Text>
                  </View>
                ) : (
                  <Text style={styles.state}>Verified purchase</Text>
                )}
              </View>
              {!item.reviewed && (
                <Pressable
                  accessibilityRole="button"
                  style={styles.rateButton}
                  onPress={() => setSelected(item)}
                >
                  <Text style={styles.rateButtonText}>Rate item</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </ScrollView>
      <ProductReviewForm
        productId={selected?.product_id}
        productName={selected?.product_name}
        onClose={() => setSelected(undefined)}
        onSaved={() => void load()}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  back: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  headerCopy: { flex: 1 },
  title: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s21,
    fontWeight: typography.weight.bold,
  },
  subtitle: { marginTop: 1, color: colors.textMuted, fontSize: typography.mobile.rawSize.s11 },
  help: {
    marginVertical: spacing[3],
    color: colors.textMuted,
    fontSize: typography.mobile.size.secondaryInteraction,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  body: { flex: 1 },
  name: {
    color: colors.text,
    fontSize: typography.mobile.size.secondaryTextHeavy,
    fontWeight: typography.weight.bold,
  },
  state: {
    color: colors.primaryStrong,
    fontSize: typography.mobile.size.secondaryInteraction,
    fontWeight: typography.weight.semibold,
  },
  meta: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: typography.mobile.size.caption,
  },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: spacing[2] },
  ratingValue: {
    marginLeft: 6,
    color: colors.textMuted,
    fontSize: typography.mobile.size.secondaryInteraction,
  },
  rateButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.primaryStrong,
  },
  rateButtonText: { color: colors.surface, fontSize: 12, fontWeight: "700" },
  error: {
    marginTop: spacing[4],
    color: colors.danger,
    fontSize: typography.mobile.size.secondaryInteraction,
  },
});
