import { apiBaseUrl } from "../../../lib/api-url";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplaceReviewPrompt, MarketplaceReviewPromptList } from "@ecochef/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../../../shared/components/themed-text";
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
          paddingTop: insets.top + spacing[5],
          paddingBottom: insets.bottom + spacing[6],
        }}
      >
        <View style={styles.header}>
          <Pressable accessibilityLabel="Back" onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={spacing[6]} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Rate purchased items</Text>
        </View>
        <Text style={styles.help}>
          Ratings unlock after the shop completes your paid order. Each product has one rating from
          you, which you can update.
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
            <Pressable
              accessibilityRole="button"
              key={item.product_id}
              style={styles.card}
              onPress={() => setSelected(item)}
            >
              <View style={styles.body}>
                <Text style={styles.name}>{item.product_name}</Text>
                <Text style={styles.help}>{item.store_name}</Text>
                <Text style={styles.state}>
                  {item.reviewed
                    ? `${"★".repeat(item.rating ?? 0)} · Edit your rating`
                    : "Verified purchase · Rate this item"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={spacing[5]} color={colors.primaryStrong} />
            </Pressable>
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
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  title: {
    color: colors.text,
    fontSize: typography.mobile.size.bodyTextHeavy,
    fontWeight: typography.weight.bold,
  },
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
  error: {
    marginTop: spacing[4],
    color: colors.danger,
    fontSize: typography.mobile.size.secondaryInteraction,
  },
});
