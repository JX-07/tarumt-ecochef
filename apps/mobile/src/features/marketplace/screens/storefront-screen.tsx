import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type {
  MarketplaceSlotAvailability,
  MarketplaceCart,
  MarketplaceProduct,
  MarketplaceStoreDetail,
} from "@ecochef/contracts";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createMobileApi } from "../../../lib/api";
import { useAuth } from "../../auth/auth-provider";
import { openMarketplaceCart } from "../cart-navigation";
import { DeliveryTimeSheet } from "../components/delivery-sheets";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";
import { ProductCard } from "../components/product-card";
import { PromotionCard } from "../components/promotion-card";
import { deliveryEstimateLabel } from "../delivery-estimate";
import {
  getMarketplaceFulfillment,
  setMarketplaceFulfillment,
  setMarketplaceArrival,
  getMarketplaceArrival,
  getMarketplaceTemporaryLocation,
} from "../delivery-preferences";
import {
  discountedProducts,
  groupProductsByCategory,
  recommendedProducts,
} from "../marketplace-catalog";
import { marketplaceImageUrl } from "../marketplace-image";
import { useOptimisticStoreCart } from "../use-optimistic-store-cart";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

const STORE_INFO_SCROLL_THRESHOLD = spacing[16] * 6;
const STICKY_SEARCH_REVEAL_HEIGHT = spacing[16] * 2;
const filterVisual = (
  category: string,
): { icon: keyof typeof Ionicons.glyphMap; color: string; background: string } => {
  const visuals: Record<
    string,
    { icon: keyof typeof Ionicons.glyphMap; color: string; background: string }
  > = {
    All: { icon: "grid-outline", color: colors.primaryStrong, background: colors.primarySoft },
    Produce: { icon: "leaf-outline", color: colors.success, background: colors.successSoft },
    Bakery: { icon: "cafe-outline", color: colors.marketStrong, background: colors.marketSoft },
    Pantry: { icon: "basket-outline", color: colors.adminStrong, background: colors.adminSoft },
    "Prepared Food": {
      icon: "restaurant-outline",
      color: colors.danger,
      background: colors.dangerSoft,
    },
    Beverages: { icon: "water-outline", color: colors.todayStrong, background: colors.todaySoft },
    Dairy: {
      icon: "nutrition-outline",
      color: colors.primaryStrong,
      background: colors.primarySoft,
    },
    "Snacks & Confectionery": {
      icon: "ice-cream-outline",
      color: colors.marketStrong,
      background: colors.marketSoft,
    },
  };
  return (
    visuals[category] ?? {
      icon: "pricetag-outline",
      color: colors.primaryStrong,
      background: colors.primarySoft,
    }
  );
};

type CatalogRowProps = {
  title: string;
  products: MarketplaceProduct[];
  accent?: boolean;
  onOpen?: () => void;
  onOpenProduct: (product: MarketplaceProduct) => void;
  onQuantity: (product: MarketplaceProduct, quantity: number) => void;
};

function CatalogRow({
  title,
  products,
  accent,
  onOpen,
  onOpenProduct,
  onQuantity,
}: CatalogRowProps) {
  if (!products.length) return null;
  return (
    <View style={styles.catalogSection}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionTitleRow}>
          {accent ? <Ionicons name="pricetag" size={spacing[5]} color={colors.market} /> : null}
          <Text style={[styles.sectionTitle, accent && styles.discountTitle]}>{title}</Text>
        </View>
        {onOpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View all ${title}`}
            onPress={onOpen}
            style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-forward" size={textSize.bodyTextHeavy} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        horizontal
        data={products}
        keyExtractor={(product) => product.id}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            onOpen={() => onOpenProduct(item)}
            onQuantity={(quantity) => onQuantity(item, quantity)}
          />
        )}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.productRow}
      />
    </View>
  );
}

export function StorefrontScreen() {
  const params = useLocalSearchParams<{
    storeId?: string | string[];
    addressId?: string | string[];
    returnTo?: string | string[];
    date?: string | string[];
    search?: string | string[];
  }>();
  const value = (param?: string | string[]) => (Array.isArray(param) ? param[0] : param);
  const storeId = value(params.storeId),
    addressId = value(params.addressId),
    returnTo = value(params.returnTo),
    date = value(params.date),
    initialSearch = value(params.search);
  const hasValidStoreId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(storeId ?? "");
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsSheetMotion = useBottomSheetSlide(optionsOpen);
  const [timeOpen, setTimeOpen] = useState(false);
  const [arrival, setArrival] = useState(getMarketplaceArrival());
  const [method, setMethod] = useState(getMarketplaceFulfillment());
  const loadAvailability = useCallback(
    (day: string) => api.getMarketplaceSlotAvailability<MarketplaceSlotAvailability>(day, storeId),
    [api, storeId],
  );
  const [store, setStore] = useState<MarketplaceStoreDetail>();
  const [cartCount, setCartCount] = useState(0);
  const [cartTotal, setCartTotal] = useState(0);
  const [query, setQuery] = useState(initialSearch ?? "");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backdropAspectRatio, setBackdropAspectRatio] = useState(16 / 9);
  const [storeInfoBottom, setStoreInfoBottom] = useState(STORE_INFO_SCROLL_THRESHOLD);
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [searchInteractive, setSearchInteractive] = useState(false);
  const [error, setError] = useState<string>();
  const scrollY = useRef(new Animated.Value(0)).current;
  const searchInteractiveRef = useRef(false);
  const searchRevealStart = Math.max(0, storeInfoBottom - spacing[12]);
  const searchRevealEnd = storeInfoBottom + spacing[4];
  const stickyTranslateY = scrollY.interpolate({
    inputRange: [searchRevealStart, searchRevealEnd],
    outputRange: [-(STICKY_SEARCH_REVEAL_HEIGHT + insets.top + spacing[2]), 0],
    extrapolate: "clamp",
  });
  const stickyContentOpacity = scrollY.interpolate({
    inputRange: [searchRevealStart, storeInfoBottom, searchRevealEnd],
    outputRange: [0, 0.45, 1],
    extrapolate: "clamp",
  });

  useEffect(() => {
    const subscription = scrollY.addListener(({ value }) => {
      const interactive = value >= storeInfoBottom;
      if (searchInteractiveRef.current === interactive) return;
      searchInteractiveRef.current = interactive;
      setSearchInteractive(interactive);
    });
    return () => scrollY.removeListener(subscription);
  }, [scrollY, storeInfoBottom]);

  const cartSync = useOptimisticStoreCart(api, {
    updateProduct: (productId, quantity) =>
      setStore((current) =>
        current
          ? {
              ...current,
              products: current.products.map((product) =>
                product.id === productId ? { ...product, cart_quantity: quantity } : product,
              ),
            }
          : current,
      ),
    updateSummary: (countDelta, totalDelta) => {
      setCartCount((current) => Math.max(0, current + countDelta));
      setCartTotal((current) => Math.max(0, current + totalDelta));
    },
    applyServerCart: (cart) => {
      setCartCount(cart.item_count);
      setCartTotal(Number(cart.total));
    },
    showError: setError,
  });

  const load = useCallback(
    async (refresh = false) => {
      refresh ? setRefreshing(true) : setLoading(true);
      setError(undefined);
      if (!hasValidStoreId) {
        setLoading(false);
        setRefreshing(false);
        router.replace("/(tabs)/marketplace");
        return;
      }
      const temporaryLocation = getMarketplaceTemporaryLocation();
      try {
        const [nextStore, cart] = await Promise.all([
          api.getMarketplaceStore<MarketplaceStoreDetail>(
            storeId as string,
            temporaryLocation ? undefined : addressId,
            temporaryLocation,
          ),
          api.getMarketplaceCart<MarketplaceCart>(),
        ]);
        setStore(nextStore);
        setHeroImageFailed(false);
        setCartCount(cart.item_count);
        setCartTotal(Number(cart.total));
        cartSync.seed(nextStore.products, cart.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "This shop could not be loaded.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, storeId, addressId, hasValidStoreId],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(true), 30000);
      return () => clearInterval(timer);
    }, [load]),
  );
  const cartParams = {
    ...(addressId ? { addressId } : {}),
    ...(returnTo ? { returnTo, date } : {}),
  };
  const openCategory = (category: string) => {
    if (storeId)
      router.push({
        pathname: "/marketplace/category" as never,
        params: {
          storeId,
          category,
          ...cartParams,
          ...(query.trim() ? { search: query.trim() } : {}),
        },
      } as never);
  };
  const openProduct = (product: MarketplaceProduct) => {
    if (storeId)
      router.push({
        pathname: "/marketplace/[storeId]/products/[productId]" as never,
        params: { storeId, productId: product.id, ...cartParams },
      } as never);
  };
  const openInfo = () => {
    if (storeId)
      router.push({
        pathname: "/marketplace/[storeId]/info" as never,
        params: { storeId },
      } as never);
  };
  const openReviews = () => {
    if (storeId)
      router.push({
        pathname: "/marketplace/[storeId]/reviews" as never,
        params: { storeId },
      } as never);
  };
  const toggleFavourite = async () => {
    if (!store || !storeId) return;
    const favourite = !store.is_favourite;
    setStore({ ...store, is_favourite: favourite });
    try {
      await api.setMarketplaceStoreFavourite(storeId, favourite);
    } catch {
      setStore((current) => (current ? { ...current, is_favourite: !favourite } : current));
    }
  };

  if (loading && !store)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  if (!store)
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? "Store unavailable."}</Text>
        <Pressable onPress={() => void load()}>
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      </View>
    );

  const categories = groupProductsByCategory(store.products);
  const deals = discountedProducts(store.products);
  const searching = Boolean(query.trim());
  const searchResults = searching
    ? recommendedProducts(store.products, query, store.products.length)
    : [];
  const featured = deals.length ? deals : recommendedProducts(store.products, "");
  const storeImage = marketplaceImageUrl(store.cover_image_url, apiBaseUrl);
  const deliveryMode = arrival
    ? `Scheduled · ${formatArrival(arrival)}`
    : method === "pickup"
      ? "Pickup"
      : "Delivery now";
  const deliveryFee =
    Number(store.delivery_fee) > 0
      ? `RM ${Number(store.delivery_fee).toFixed(2)}`
      : "Free delivery";

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={{
          paddingBottom: cartCount ? spacing[16] * 2 + insets.bottom : spacing[8],
        }}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={spacing[4]}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
      >
        <View style={styles.hero}>
          <View style={[styles.topBar, { paddingTop: insets.top + spacing[2] }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to marketplace"
              style={styles.circle}
              onPress={() => router.back()}
            >
              <Ionicons name="chevron-back" size={textSize.bodyTextHeavy} color={colors.text} />
            </Pressable>
            <View style={styles.heroActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  store.is_favourite ? "Remove store from favourites" : "Favourite this store"
                }
                style={styles.circle}
                onPress={() => void toggleFavourite()}
              >
                <Ionicons
                  name={store.is_favourite ? "heart" : "heart-outline"}
                  size={textSize.bodyTextHeavy}
                  color={store.is_favourite ? colors.danger : colors.text}
                />
              </Pressable>
            </View>
          </View>
          <View style={{ width: "100%", aspectRatio: backdropAspectRatio }}>
            {storeImage && !heroImageFailed ? (
              <Image
                accessibilityLabel={`${store.name} backdrop`}
                source={{ uri: storeImage }}
                resizeMode="contain"
                onLoad={({ nativeEvent }) => {
                  const { width, height } = nativeEvent.source;
                  if (width > 0 && height > 0) setBackdropAspectRatio(width / height);
                }}
                onError={() => setHeroImageFailed(true)}
                style={styles.heroImage}
              />
            ) : (
              <View style={styles.heroFallback}>
                <Ionicons name="images-outline" size={spacing[12]} color={colors.primaryStrong} />
                <Text style={styles.heroFallbackText}>Store backdrop coming soon</Text>
              </View>
            )}
          </View>
        </View>
        <View
          style={styles.storeCard}
          onLayout={({ nativeEvent }) =>
            setStoreInfoBottom(Math.max(spacing[16], nativeEvent.layout.y - insets.top))
          }
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View information about ${store.name}`}
            onPress={openInfo}
            style={({ pressed }) => [styles.infoRow, pressed && styles.pressed]}
          >
            <View style={styles.infoCopy}>
              <View style={styles.titleRow}>
                <Text style={[styles.name, { flexShrink: 1 }]}>{store.name}</Text>
                {store.closed_today ? <Text style={styles.closedText}>CLOSED</Text> : null}
              </View>
              <Text style={styles.storeType}>{store.category || "Local shop"}</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={textSize.bodyTextHeavy}
              color={colors.textSubtle}
            />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${store.review_count} ratings and reviews`}
            onPress={openReviews}
            style={({ pressed }) => [styles.ratingRow, pressed && styles.pressed]}
          >
            <Ionicons name="star" size={textSize.bodyTextHeavy} color={colors.ratingStar} />
            <Text style={styles.ratingValue}>{Number(store.rating).toFixed(1)}</Text>
            <Text style={styles.reviewCount}>({store.review_count})</Text>
            <Text style={styles.ratingLink}>Ratings & reviews</Text>
            <Ionicons
              name="chevron-forward"
              size={textSize.bodyTextHeavy}
              color={colors.textSubtle}
            />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            accessibilityRole="button"
            onPress={() => setOptionsOpen(true)}
            style={styles.deliveryRow}
          >
            <View style={styles.deliveryIcon}>
              <Ionicons name="bicycle-outline" size={spacing[5]} color={colors.primaryStrong} />
            </View>
            <View style={styles.deliveryCopy}>
              <Text style={styles.deliveryTitle}>
                {store.distance_km != null ? `${store.distance_km} km · ` : ""}
                {deliveryEstimateLabel(store.estimated_delivery_minutes)}
              </Text>
              <Text style={styles.deliveryMeta}>
                {deliveryMode} ·{" "}
                <Text style={styles.deliveryPrice}>
                  {method === "pickup" ? "Free pickup" : deliveryFee}
                </Text>
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={spacing[5]} color={colors.textSubtle} />
          </Pressable>
        </View>
        {store.holiday_closure ? (
          <View style={styles.closureNotice}>
            <Ionicons name="calendar-outline" size={spacing[5]} color={colors.warning} />
            <View>
              <Text style={styles.closureTitle}>
                {store.holiday_closure.whole_day
                  ? "Closed today"
                  : `Special hours ${store.holiday_closure.opens_at?.slice(0, 5)}–${store.holiday_closure.closes_at?.slice(0, 5)}`}
              </Text>
              <Text style={styles.closureReason}>{store.holiday_closure.reason}</Text>
            </View>
          </View>
        ) : null}
        {store.promotions.length ? (
          <View style={styles.promotions}>
            <FlatList
              horizontal
              data={store.promotions}
              keyExtractor={(promotion) => promotion.id}
              renderItem={({ item }) => (
                <PromotionCard
                  promotion={item}
                  onPress={() =>
                    router.push({
                      pathname: "/marketplace/[storeId]/promotions/[promotionId]" as never,
                      params: { storeId, promotionId: item.id },
                    } as never)
                  }
                />
              )}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.promotionRow}
            />
          </View>
        ) : null}
        <FlatList
          horizontal
          data={["All", ...categories.map(([category]) => category)]}
          keyExtractor={(category) => category}
          renderItem={({ item }) => {
            const visual = filterVisual(item);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${item} products`}
                onPress={() => openCategory(item)}
                style={({ pressed }) => [styles.filter, pressed && styles.filterPressed]}
              >
                <View style={[styles.filterIcon, { backgroundColor: visual.background }]}>
                  <Ionicons name={visual.icon} size={spacing[4]} color={visual.color} />
                </View>
                <Text numberOfLines={1} style={styles.filterText}>
                  {item}
                </Text>
              </Pressable>
            );
          }}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        />
        {searching ? (
          searchResults.length ? (
            <CatalogRow
              title={`Results for “${query.trim()}”`}
              products={searchResults}
              onOpenProduct={openProduct}
              onQuantity={cartSync.changeQuantity}
            />
          ) : (
            <View style={styles.noMatches}>
              <Text style={styles.noMatchesTitle}>No matches for “{query.trim()}”</Text>
              <Text style={styles.empty}>Try another product name or browse a category.</Text>
            </View>
          )
        ) : (
          <>
            <CatalogRow
              title={deals.length ? "Discounted items" : "For you"}
              products={featured}
              accent={deals.length > 0}
              onOpen={() => openCategory(deals.length ? "Discounted items" : "All")}
              onOpenProduct={openProduct}
              onQuantity={cartSync.changeQuantity}
            />
            {categories.map(([category, products]) => (
              <CatalogRow
                key={category}
                title={category}
                products={products}
                onOpen={() => openCategory(category)}
                onOpenProduct={openProduct}
                onQuantity={cartSync.changeQuantity}
              />
            ))}
          </>
        )}
        {error ? (
          <Pressable style={styles.error} onPress={() => setError(undefined)}>
            <Text style={styles.errorText}>{error}</Text>
          </Pressable>
        ) : null}
      </Animated.ScrollView>
      <Animated.View
        pointerEvents={searchInteractive ? "auto" : "none"}
        style={[
          styles.stickySearchShell,
          { paddingTop: insets.top + spacing[2], transform: [{ translateY: stickyTranslateY }] },
        ]}
      >
        <Animated.View style={{ opacity: stickyContentOpacity }}>
          <View style={styles.stickySearchContent}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to marketplace"
              onPress={() => router.back()}
              style={styles.searchBack}
            >
              <Ionicons name="chevron-back" size={textSize.bodyTextHeavy} color={colors.text} />
            </Pressable>
            <Text numberOfLines={1} style={[styles.name, { flex: 1 }]}>
              {store.name}
            </Text>
            {store.closed_today ? <Text style={styles.closedText}>CLOSED</Text> : null}
          </View>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={spacing[5]} color={colors.textSubtle} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search this shop"
              placeholderTextColor={colors.textSubtle}
              style={styles.searchInput}
            />
          </View>
        </Animated.View>
      </Animated.View>
      <Modal
        visible={optionsOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setOptionsOpen(false)}
      >
        <View style={styles.optionsOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOptionsOpen(false)} />
          <Animated.View
            style={[
              styles.optionsSheet,
              { paddingBottom: Math.max(insets.bottom, spacing[4]) },
              optionsSheetMotion,
            ]}
          >
            <Text style={styles.sectionTitle}>Delivery method</Text>
            {(["delivery", "pickup"] as const).map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: method === option }}
                style={styles.methodOption}
                onPress={() => {
                  setMethod(option);
                  setMarketplaceFulfillment(option);
                }}
              >
                <Ionicons
                  name={method === option ? "radio-button-on" : "radio-button-off"}
                  size={spacing[6]}
                  color={colors.primaryStrong}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{option === "delivery" ? "Delivery" : "Pickup"}</Text>
                  <Text style={styles.deliveryMeta}>
                    {option === "delivery"
                      ? deliveryEstimateLabel(store.estimated_delivery_minutes)
                      : store.estimated_pickup_minutes
                        ? `Collect in approximately ${store.estimated_pickup_minutes} minutes`
                        : "Ready time confirmed by the shop after ordering"}
                  </Text>
                </View>
                <Text style={styles.deliveryPrice}>
                  {option === "delivery" ? deliveryFee : "Free"}
                </Text>
              </Pressable>
            ))}
            <Text style={[styles.sectionTitle, { marginTop: spacing[5] }]}>Order time</Text>
            <Pressable
              style={styles.methodOption}
              onPress={() => {
                setOptionsOpen(false);
                requestAnimationFrame(() => setTimeOpen(true));
              }}
            >
              <Ionicons name="time-outline" size={spacing[6]} color={colors.primaryStrong} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Order later</Text>
                <Text style={styles.deliveryMeta}>
                  {arrival ? formatArrival(arrival) : "Choose a time during shop opening hours"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={spacing[5]} color={colors.textSubtle} />
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
      <DeliveryTimeSheet
        scheduledOnly
        visible={timeOpen}
        value={arrival}
        deliveryFee={method === "pickup" ? 0 : Number(store.delivery_fee)}
        loadAvailability={loadAvailability}
        onSelect={(value) => {
          setArrival(value);
          setMarketplaceArrival(value);
        }}
        onClearCart={() => undefined}
        onClose={() => setTimeOpen(false)}
      />
      {cartCount > 0 ? (
        <View style={[styles.sticky, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View cart, ${cartCount} item${cartCount === 1 ? "" : "s"}, RM ${cartTotal.toFixed(2)}`}
            disabled={!!store.closed_today}
            accessibilityState={{ disabled: !!store.closed_today }}
            style={({ pressed }) => [
              styles.primary,
              store.closed_today && styles.closedControl,
              pressed && styles.primaryPressed,
            ]}
            onPress={() => openMarketplaceCart(cartParams)}
          >
            <View style={styles.cartLabel}>
              <Ionicons name="cart-outline" size={spacing[5]} color={colors.surface} />
              <Text style={styles.primaryText}>
                {store.closed_today ? "Closed today" : "View Cart"} · {cartCount} item
                {cartCount === 1 ? "" : "s"}
              </Text>
            </View>
            <Text style={styles.cartTotal}>RM {cartTotal.toFixed(2)}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function formatArrival(value: string) {
  return new Date(value).toLocaleString("en-MY", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
const textSize = typography.mobile.size;
const textWeight = typography.weight;
const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  closedText: {
    color: colors.warningStrong,
    fontSize: typography.mobile.size.caption,
    fontWeight: typography.weight.bold,
  },
  optionsOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  optionsSheet: {
    padding: spacing[5],
    borderTopLeftRadius: spacing[6],
    borderTopRightRadius: spacing[6],
    backgroundColor: colors.surface,
  },
  methodOption: {
    minHeight: spacing[16],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  closedControl: { opacity: 0.4 },
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[6],
    backgroundColor: colors.consumerCanvas,
  },
  hero: { backgroundColor: colors.primarySoft },
  heroImage: { ...StyleSheet.absoluteFill },
  heroFallback: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
  heroFallbackText: {
    color: colors.primaryStrong,
    fontSize: textSize.caption,
    fontWeight: textWeight.bold,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: spacing[4],
    right: spacing[4],
    zIndex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroActions: { flexDirection: "row", gap: spacing[2] },
  circle: {
    width: spacing[10],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[5],
    backgroundColor: colors.surfaceGlass,
  },
  storeCard: {
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    marginBottom: spacing[4],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[6],
    backgroundColor: colors.surface,
    elevation: 4,
  },
  infoRow: { minHeight: spacing[16], flexDirection: "row", alignItems: "center", gap: spacing[3] },
  infoCopy: { flex: 1 },
  name: {
    color: colors.text,
    fontSize: textSize.bodyTextHeavy,
    lineHeight: spacing[6],
    fontWeight: textWeight.bold,
  },
  storeType: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: textSize.caption,
    fontWeight: textWeight.semibold,
  },
  divider: { borderTopWidth: 1, borderColor: colors.border },
  ratingRow: {
    minHeight: spacing[12] + spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  ratingValue: {
    color: colors.text,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  reviewCount: { color: colors.textMuted, fontSize: textSize.secondaryInteraction },
  ratingLink: {
    flex: 1,
    marginLeft: spacing[1],
    color: colors.text,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.semibold,
  },
  deliveryRow: {
    minHeight: spacing[12],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[1],
  },
  deliveryIcon: {
    width: spacing[8],
    height: spacing[8],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[4],
    backgroundColor: colors.primarySoft,
  },
  deliveryCopy: { flex: 1 },
  deliveryTitle: { color: colors.text, fontSize: textSize.caption, fontWeight: textWeight.bold },
  deliveryMeta: { marginTop: 2, color: colors.textMuted, fontSize: textSize.caption },
  deliveryPrice: { color: colors.primaryStrong, fontWeight: textWeight.bold },
  closureNotice: {
    marginHorizontal: spacing[4],
    marginTop: -spacing[2],
    marginBottom: spacing[4],
    padding: spacing[3],
    flexDirection: "row",
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: spacing[4],
    backgroundColor: colors.warningSoft,
  },
  closureTitle: { color: colors.text, fontSize: textSize.caption, fontWeight: textWeight.bold },
  closureReason: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption },
  promotions: { marginBottom: spacing[2] },
  promotionRow: { gap: spacing[2], paddingHorizontal: spacing[4] },
  filters: { gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  filter: {
    minHeight: spacing[10],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingLeft: spacing[2],
    paddingRight: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[5],
    backgroundColor: colors.surface,
  },
  filterIcon: {
    width: spacing[6],
    height: spacing[6],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[3],
  },
  filterText: { color: colors.text, fontSize: textSize.caption, fontWeight: textWeight.bold },
  filterPressed: {
    borderColor: colors.primaryBorder,
    backgroundColor: colors.surfaceMuted,
    opacity: 0.76,
    transform: [{ scale: 0.97 }],
  },
  catalogSection: { marginBottom: spacing[5] },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  sectionTitle: {
    color: colors.text,
    fontSize: textSize.bodyTextHeavy,
    fontWeight: textWeight.bold,
  },
  discountTitle: { color: colors.marketStrong },
  arrow: {
    width: spacing[8],
    height: spacing[8],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[4],
    backgroundColor: colors.surfaceMuted,
  },
  productRow: { paddingLeft: spacing[4] },
  noMatches: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[5],
    padding: spacing[5],
    alignItems: "center",
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  noMatchesTitle: {
    color: colors.text,
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  empty: {
    paddingVertical: spacing[3],
    color: colors.textMuted,
    fontSize: textSize.caption,
    textAlign: "center",
  },
  error: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    padding: spacing[3],
    borderRadius: spacing[3],
    backgroundColor: colors.dangerSoft,
  },
  errorText: { color: colors.danger, fontSize: textSize.caption, textAlign: "center" },
  retry: {
    marginTop: spacing[3],
    color: colors.primaryStrong,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  stickySearchShell: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stickySearchContent: {
    height: spacing[12],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  searchBack: {
    width: spacing[10],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[5],
    backgroundColor: colors.surfaceMuted,
  },
  searchWrap: {
    marginTop: spacing[2],
    height: spacing[12],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surfaceMuted,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: textSize.secondaryInteraction },
  sticky: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    backgroundColor: colors.surface,
  },
  primary: {
    height: spacing[12] + spacing[1],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    borderRadius: spacing[4],
    backgroundColor: colors.primary,
  },
  primaryPressed: { backgroundColor: colors.primaryStrong },
  cartLabel: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  primaryText: {
    color: colors.surface,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  cartTotal: {
    color: colors.surface,
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  pressed: { opacity: 0.7 },
});
