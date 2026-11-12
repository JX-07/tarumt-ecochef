import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplaceCart, MarketplaceCategoryStore, MarketplaceCategoryStoreList, MarketplaceProduct } from "@ecochef/contracts";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { useAuth } from "../../auth/auth-provider";
import { openMarketplaceCart } from "../cart-navigation";
import { CartButton } from "../components/cart-button";
import { deliveryEstimateLabel } from "../delivery-estimate";
import { getMarketplaceTemporaryLocation } from "../delivery-preferences";
import { marketplaceImageUrl } from "../marketplace-image";
import { useOptimisticStoreCart } from "../use-optimistic-store-cart";
import { RequiredPlanBadge } from "../components/required-plan-badge";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

type SortOption = "ratings" | "popularity" | "distance" | "offers";
const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: "ratings", label: "Ratings" },
  { value: "popularity", label: "Popularity" },
  { value: "distance", label: "Distance" },
  { value: "offers", label: "Offers" },
];
const parameter = (value?: string | string[]) => Array.isArray(value) ? value[0] : value;

const CategoryProductCard = memo(function CategoryProductCard({ product, onQuantity, onOpen }: { product: MarketplaceProduct; onQuantity: (quantity: number) => void; onOpen: () => void }) {
  const [quantity, setQuantity] = useState(product.cart_quantity);
  const quantityRef = useRef(product.cart_quantity);
  const atCartLimit = quantity >= product.stock_quantity;
  const [imageFailed, setImageFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const imageUrl = marketplaceImageUrl(product.image_url, apiBaseUrl);
  useEffect(() => {
    quantityRef.current = product.cart_quantity;
    setQuantity(product.cart_quantity);
    if (product.cart_quantity <= 0) setExpanded(false);
  }, [product.cart_quantity]);
  const change = (next: number) => {
    const quantity = Math.max(0, Math.min(product.stock_quantity, next));
    quantityRef.current = quantity;
    setQuantity(quantity);
    requestAnimationFrame(() => requestAnimationFrame(() => onQuantity(quantity)));
  };
  return <View style={styles.productCard}>
    <View style={styles.productVisual}>
      <Pressable accessibilityRole="button" accessibilityLabel={`View ${product.name} details`} onPress={onOpen} style={styles.productImageButton}>{imageUrl && !imageFailed ? <Image accessibilityLabel={product.name} source={{ uri: imageUrl }} resizeMode="cover" onError={() => setImageFailed(true)} style={styles.productImage} /> : <View style={styles.productImageFallback}><Ionicons name="cube-outline" size={42} color={colors.textSubtle} /></View>}</Pressable>
      {quantity <= 0 ? <Pressable accessibilityRole="button" accessibilityLabel={atCartLimit ? `${product.name} is at the cart limit` : `Add ${product.name} to cart`} disabled={atCartLimit} onPress={() => change(1)} style={({ pressed }) => [styles.productAdd, pressed && styles.productAddPressed, atCartLimit && styles.productAddDisabled]}><Ionicons name="add" size={spacing[6]} color={colors.surface} /></Pressable> : expanded ? <View style={styles.productStepper}><Pressable accessibilityRole="button" accessibilityLabel={`Remove one ${product.name}`} onPress={() => change(quantityRef.current - 1)} style={styles.productStep}><Ionicons name="remove" size={spacing[5]} color={colors.primaryStrong} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Collapse quantity controls for ${product.name}`} onPress={() => setExpanded(false)} style={styles.productQuantity}><Text style={styles.productQuantityText}>{quantity}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Add one ${product.name}`} disabled={atCartLimit} onPress={() => change(quantityRef.current + 1)} style={[styles.productStep, atCartLimit && styles.productAddDisabled]}><Ionicons name="add" size={spacing[5]} color={colors.primaryStrong} /></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel={`${quantity} ${product.name} in cart. Show quantity controls`} onPress={() => setExpanded(true)} style={styles.productAdd}><Text style={styles.productCompactQuantity}>{quantity}</Text></Pressable>}
    </View>
    <Text style={styles.productPrice}>RM {Number(product.price).toFixed(2)}</Text>
    <Text style={styles.productName} numberOfLines={2}><RequiredPlanBadge product={product}/>{product.name}</Text>
    <Text style={styles.productDescription} numberOfLines={1}>{product.size?.trim() || product.unit_label?.trim() || "Size not provided"}</Text>
  </View>;
}, (previous, next) => previous.product === next.product);

function CategoryStoreRow({ store, onOpen, onOpenProduct, onQuantity }: { store: MarketplaceCategoryStore; onOpen: () => void; onOpenProduct: (product: MarketplaceProduct) => void; onQuantity: (product: MarketplaceProduct, quantity: number) => void }) {
  return <View style={styles.storeSection}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${store.name}`} onPress={onOpen} style={({ pressed }) => [styles.storeHeading, pressed && styles.pressed]}>
      <View style={styles.storeHeadingCopy}><Text style={styles.storeName}>{store.name}</Text><View style={styles.storeMeta}><Text style={styles.storeMetaText}>{deliveryEstimateLabel(store.estimated_delivery_minutes)}{store.distance_km != null ? `  ·  ${store.distance_km} km` : ""}  ·  </Text><Ionicons name="star" size={14} color={colors.ratingStar} /><Text style={styles.storeMetaText}>{Number(store.rating).toFixed(1)} ({store.review_count})</Text></View></View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSubtle} />
    </Pressable>
    <FlatList horizontal data={store.products} keyExtractor={(product) => product.id} renderItem={({ item }) => <CategoryProductCard product={item} onQuantity={(quantity) => onQuantity(item, quantity)} onOpen={() => onOpenProduct(item)} />} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productRow} />
  </View>;
}

export function MarketplaceProductsScreen() {
  const params = useLocalSearchParams<{ category?: string | string[]; addressId?: string | string[]; returnTo?: string | string[]; date?: string | string[] }>();
  const category = parameter(params.category) ?? "Products";
  const addressId = parameter(params.addressId);
  const returnTo = parameter(params.returnTo);
  const date = parameter(params.date);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [result, setResult] = useState<MarketplaceCategoryStoreList>({ category, stores: [], total: 0 });
  const [sort, setSort] = useState<SortOption>("ratings");
  const [cartCount, setCartCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const cartSync = useOptimisticStoreCart(api, {
    updateProduct: (productId, quantity) => setResult((current) => ({ ...current, stores: current.stores.map((store) => ({ ...store, products: store.products.map((product) => product.id === productId ? { ...product, cart_quantity: quantity } : product) })) })),
    updateSummary: (countDelta) => setCartCount((current) => Math.max(0, current + countDelta)),
    applyServerCart: (cart) => setCartCount(cart.item_count),
    showError: setError,
  });

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(undefined);
    const temporaryLocation = getMarketplaceTemporaryLocation();
    try {
      const [nextResult, cart] = await Promise.all([
        api.getMarketplaceProductCategory<MarketplaceCategoryStoreList>(category, temporaryLocation ? undefined : addressId, temporaryLocation),
        api.getMarketplaceCart<MarketplaceCart>(),
      ]);
      setResult(nextResult);
      setCartCount(cart.item_count);
      cartSync.seed(nextResult.stores.flatMap((store) => store.products), cart.id);
    } catch (next) {
      setError(next instanceof Error ? next.message : "This product category could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, category, addressId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const sortedStores = useMemo(() => [...result.stores].sort((a, b) => {
    if (sort === "ratings") return Number(b.rating) - Number(a.rating) || b.review_count - a.review_count || a.name.localeCompare(b.name);
    if (sort === "popularity") return b.popularity - a.popularity || Number(b.rating) - Number(a.rating) || a.name.localeCompare(b.name);
    if (sort === "offers") return b.offer_count - a.offer_count || Number(b.rating) - Number(a.rating) || a.name.localeCompare(b.name);
    return (a.distance_km ?? Number.MAX_SAFE_INTEGER) - (b.distance_km ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);
  }), [result.stores, sort]);

  const cartParams = { ...(addressId ? { addressId } : {}), ...(returnTo ? { returnTo, date } : {}) };
  const openStore = (storeId: string) => router.push({ pathname: "/marketplace/[storeId]" as never, params: { storeId, ...cartParams } } as never);
  const openProduct = (storeId: string, productId: string) => router.push({ pathname: "/marketplace/[storeId]/products/[productId]" as never, params: { storeId, productId, ...cartParams } } as never);
  const header = <>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back to marketplace" onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable><View style={styles.headerCopy}><Text style={styles.title}>{category}</Text><Text style={styles.subtitle}>{result.total} shop{result.total === 1 ? "" : "s"} with matching products</Text></View><CartButton count={cartCount} onPress={() => openMarketplaceCart(cartParams)} /></View>
    <Text style={styles.sortLabel}>Sort shops by</Text>
    <FlatList horizontal data={sortOptions} keyExtractor={(item) => item.value} renderItem={({ item }) => { const active = sort === item.value; return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setSort(item.value)} style={[styles.sortChip, active && styles.sortChipActive]}><Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>{item.label}</Text></Pressable>; }} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow} />
    {error ? <Pressable style={styles.error} onPress={() => void load()}><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}
  </>;

  return <View style={styles.root}><FlatList
    data={sortedStores}
    keyExtractor={(store) => store.id}
    renderItem={({ item }) => <CategoryStoreRow store={item} onOpen={() => openStore(item.id)} onOpenProduct={(product) => openProduct(item.id, product.id)} onQuantity={cartSync.changeQuantity} />}
    ListHeaderComponent={header}
    ListEmptyComponent={loading ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : <View style={styles.empty}><Ionicons name="basket-outline" size={34} color={colors.textSubtle} /><Text style={styles.emptyTitle}>No shops sell {category.toLowerCase()} yet</Text><Text style={styles.emptyCopy}>Try another product category from the Marketplace.</Text></View>}
    contentContainerStyle={[styles.content, { paddingTop: insets.top + PAGE_TOP_GAP, paddingBottom: Math.max(insets.bottom, spacing[8]) }]}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
    initialNumToRender={4}
    maxToRenderPerBatch={6}
    windowSize={5}
    showsVerticalScrollIndicator={false}
  /></View>;
}

const textSize = typography.mobile.size;
const textWeight = typography.weight;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas }, content: { paddingBottom: spacing[8] },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingHorizontal: spacing[4], marginBottom: spacing[5] }, back: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: colors.surface }, headerCopy: { flex: 1 }, title: { color: colors.text, fontSize: textSize.bodyTextHeavy, fontWeight: textWeight.bold }, subtitle: { marginTop: 2, color: colors.textMuted, fontSize: textSize.caption },
  sortLabel: { paddingHorizontal: spacing[4], color: colors.text, fontSize: textSize.secondaryTextHeavy, fontWeight: textWeight.bold }, sortRow: { gap: spacing[2], paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[5] }, sortChip: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing[4], borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface }, sortChipActive: { borderColor: colors.primary, backgroundColor: colors.primary }, sortChipText: { color: colors.textMuted, fontSize: textSize.caption, fontWeight: textWeight.semibold }, sortChipTextActive: { color: colors.surface },
  storeSection: { marginBottom: spacing[8] }, storeHeading: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing[2], marginHorizontal: spacing[4], marginBottom: spacing[3] }, storeHeadingCopy: { flex: 1 }, storeName: { color: colors.text, fontSize: textSize.secondaryTextHeavy, fontWeight: textWeight.bold }, storeMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: spacing[1] }, storeMetaText: { color: colors.textMuted, fontSize: textSize.caption, lineHeight: 18 }, pressed: { opacity: .65 }, productRow: { paddingLeft: spacing[4], paddingRight: spacing[1] },
  productCard: { width: 178, minHeight: 306, marginRight: spacing[4] }, productVisual: { width: 178, height: 178, overflow: "hidden", marginBottom: spacing[3], borderRadius: spacing[4], backgroundColor: colors.surfaceMuted }, productImageButton: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }, productImage: { width: "100%", height: "100%" }, productImageFallback: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted }, productAdd: { position: "absolute", top: spacing[2], right: spacing[2], width: spacing[10], height: spacing[10], alignItems: "center", justifyContent: "center", borderRadius: spacing[5], backgroundColor: colors.primaryStrong, elevation: 3 }, productStepper: { position: "absolute", top: spacing[2], right: spacing[2], height: spacing[10], flexDirection: "row", alignItems: "center", overflow: "hidden", borderWidth: 1, borderColor: colors.primaryBorder, borderRadius: spacing[5], backgroundColor: colors.surface, elevation: 3 }, productStep: { width: spacing[10], height: spacing[10], alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft }, productQuantity: { minWidth: spacing[8], height: spacing[10], alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }, productQuantityText: { color: colors.text, fontSize: textSize.caption, fontWeight: textWeight.bold }, productCompactQuantity: { color: colors.surface, fontSize: textSize.secondaryInteraction, fontWeight: textWeight.bold }, productAddPressed: { opacity: .7 }, productAddDisabled: { opacity: .42 }, productPrice: { color: colors.primaryStrong, fontSize: textSize.bodyTextHeavy, lineHeight: 23, fontWeight: textWeight.bold }, productName: { marginTop: spacing[1], color: colors.text, fontSize: textSize.secondaryInteraction, lineHeight: 19, fontWeight: textWeight.semibold }, productDescription: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption, lineHeight: 17 },
  error: { marginHorizontal: spacing[4], marginBottom: spacing[4], padding: spacing[3], borderRadius: spacing[3], backgroundColor: colors.dangerSoft }, errorText: { color: colors.danger, fontSize: textSize.caption, fontWeight: textWeight.semibold, textAlign: "center" }, loading: { marginTop: spacing[8] }, empty: { alignItems: "center", marginHorizontal: spacing[4], padding: spacing[8], borderRadius: spacing[4], backgroundColor: colors.surface }, emptyTitle: { marginTop: spacing[2], color: colors.text, fontSize: textSize.secondaryTextHeavy, fontWeight: textWeight.bold, textAlign: "center" }, emptyCopy: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption, lineHeight: 18, textAlign: "center" },
});
