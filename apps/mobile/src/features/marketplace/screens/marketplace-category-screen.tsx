import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplaceCart, MarketplaceProduct, MarketplaceStoreDetail } from "@ecochef/contracts";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { useAuth } from "../../auth/auth-provider";
import { openMarketplaceCart } from "../cart-navigation";
import { CartButton } from "../components/cart-button";
import { ProductCard } from "../components/product-card";
import { getMarketplaceTemporaryLocation } from "../delivery-preferences";
import { discountedProducts, groupProductsByCategory, groupProductsBySubcategory, productCategory, recommendedProducts } from "../marketplace-catalog";
import { useOptimisticStoreCart } from "../use-optimistic-store-cart";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;


export function MarketplaceCategoryScreen() {
  const params = useLocalSearchParams<{ storeId?: string | string[]; category?: string | string[]; addressId?: string | string[]; returnTo?: string | string[]; date?: string | string[]; search?: string | string[] }>();
  const value = (param?: string | string[]) => Array.isArray(param) ? param[0] : param;
  const storeId = value(params.storeId);
  const category = value(params.category) ?? "All";
  const addressId = value(params.addressId);
  const returnTo = value(params.returnTo);
  const date = value(params.date);
  const search = value(params.search) ?? "";
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [store, setStore] = useState<MarketplaceStoreDetail>();
  const [cartCount, setCartCount] = useState(0);
  const [cartTotal, setCartTotal] = useState(0);
  const [error, setError] = useState<string>();

  const cartSync = useOptimisticStoreCart(api, {
    updateProduct: (productId, quantity) => setStore((current) => current ? { ...current, products: current.products.map((product) => product.id === productId ? { ...product, cart_quantity: quantity } : product) } : current),
    updateSummary: (countDelta, totalDelta) => { setCartCount((current) => Math.max(0, current + countDelta)); setCartTotal((current) => Math.max(0, current + totalDelta)); },
    applyServerCart: (cart) => { setCartCount(cart.item_count); setCartTotal(Number(cart.total)); },
    showError: setError,
  });

  const load = useCallback(async () => {
    if (!storeId) return;
    setError(undefined);
    const temporaryLocation = getMarketplaceTemporaryLocation();
    try {
      const [nextStore, cart] = await Promise.all([
        api.getMarketplaceStore<MarketplaceStoreDetail>(storeId, temporaryLocation ? undefined : addressId, temporaryLocation),
        api.getMarketplaceCart<MarketplaceCart>(),
      ]);
      setStore(nextStore);
      setCartCount(cart.item_count);
      setCartTotal(Number(cart.total));
      cartSync.seed(nextStore.products, cart.id);
    } catch (next) {
      setError(next instanceof Error ? next.message : "This category could not be loaded.");
    }
  }, [api, storeId, addressId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const cartParams = { ...(addressId ? { addressId } : {}), ...(returnTo ? { returnTo, date } : {}) };
  const openProduct = (product: MarketplaceProduct) => {
    if (!storeId) return;
    router.push({ pathname: "/marketplace/[storeId]/products/[productId]" as never, params: { storeId, productId: product.id, ...cartParams } } as never);
  };
  if (!store && !error) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!store) return <View style={styles.center}><Text style={styles.error}>{error ?? "Category unavailable."}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Try again</Text></Pressable></View>;

  let products = category === "Discounted items"
    ? discountedProducts(store.products)
    : category === "All"
      ? (search.trim() ? recommendedProducts(store.products, search) : store.products)
      : store.products.filter((product) => productCategory(product) === category);
  const groups: Array<[string, MarketplaceProduct[]]> = category === "All"
    ? groupProductsByCategory(products)
    : category === "Discounted items"
      ? [["Current offers", products]]
      : groupProductsBySubcategory(products);

  return <View style={styles.root}>
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + PAGE_TOP_GAP, paddingBottom: cartCount ? spacing[16] * 2 : spacing[8] }}>
      <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back to store" onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable><View style={styles.headerCopy}><Text style={styles.title}>{category}</Text><Text style={styles.subtitle}>{store.name}{category === "All" && search.trim() ? ` · results for “${search.trim()}”` : ""}</Text></View><CartButton count={cartCount} onPress={() => openMarketplaceCart(cartParams)} /></View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!products.length ? <View style={styles.empty}><Ionicons name="search-outline" size={30} color={colors.textSubtle} /><Text style={styles.emptyTitle}>No products found</Text><Text style={styles.emptyCopy}>Try another filter from the store page.</Text></View> : groups.map(([label, items]) => <View key={label} style={styles.group}><Text style={styles.groupTitle}>{label}</Text><FlatList horizontal data={items} keyExtractor={(item) => item.id} renderItem={({ item }) => <ProductCard product={item} onOpen={() => openProduct(item)} onQuantity={(quantity) => cartSync.changeQuantity(item, quantity)} />} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} /></View>)}
    </ScrollView>
    {cartCount > 0 ? <View style={[styles.sticky, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}><Pressable accessibilityRole="button" style={({ pressed }) => [styles.viewCart, pressed && styles.viewCartPressed]} onPress={() => openMarketplaceCart(cartParams)}><View style={styles.viewCartLabel}><Ionicons name="cart-outline" size={20} color={colors.surface} /><Text style={styles.viewCartText}>View Cart · {cartCount} item{cartCount === 1 ? "" : "s"}</Text></View><Text style={styles.viewCartTotal}>RM {cartTotal.toFixed(2)}</Text></Pressable></View> : null}
  </View>;
}

const textSize = typography.mobile.size;
const textWeight = typography.weight;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas }, center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing[6], backgroundColor: colors.consumerCanvas },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingHorizontal: spacing[4], marginBottom: spacing[6] }, back: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: colors.surface }, headerCopy: { flex: 1 }, title: { color: colors.text, fontSize: textSize.bodyTextHeavy, fontWeight: textWeight.bold }, subtitle: { marginTop: 2, color: colors.textMuted, fontSize: textSize.caption },
  group: { marginBottom: spacing[8] }, groupTitle: { marginBottom: spacing[3], paddingHorizontal: spacing[4], color: colors.text, fontSize: textSize.bodyTextHeavy, fontWeight: textWeight.bold }, row: { paddingLeft: spacing[4] },
  error: { marginHorizontal: spacing[4], marginBottom: spacing[4], color: colors.danger, fontSize: textSize.caption, textAlign: "center" }, retry: { marginTop: spacing[3], color: colors.primaryStrong, fontSize: textSize.secondaryInteraction, fontWeight: textWeight.bold },
  empty: { alignItems: "center", marginHorizontal: spacing[4], padding: spacing[8], borderRadius: spacing[4], backgroundColor: colors.surface }, emptyTitle: { marginTop: spacing[2], color: colors.text, fontSize: textSize.secondaryTextHeavy, fontWeight: textWeight.bold }, emptyCopy: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption },
  sticky: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing[4], paddingTop: spacing[3], backgroundColor: colors.surface }, viewCart: { height: spacing[12] + spacing[1], flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing[4], borderRadius: spacing[4], backgroundColor: colors.primary }, viewCartPressed: { backgroundColor: colors.primaryStrong }, viewCartLabel: { flexDirection: "row", alignItems: "center", gap: spacing[2] }, viewCartText: { color: colors.surface, fontSize: textSize.secondaryInteraction, fontWeight: textWeight.bold }, viewCartTotal: { color: colors.surface, fontSize: textSize.secondaryTextHeavy, fontWeight: textWeight.bold },
});

