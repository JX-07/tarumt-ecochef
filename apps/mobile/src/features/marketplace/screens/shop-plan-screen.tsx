import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type {
  ConsumerProfile,
  MarketplaceCart,
  MarketplaceCategoryStoreList,
  MarketplaceProduct,
} from "@ecochef/contracts";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../../../shared/components/themed-text";
import { PageHeader, PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { apiBaseUrl } from "../../../lib/api-url";
import { createMobileApi } from "../../../lib/api";
import { useAuth } from "../../auth/auth-provider";
import type { PlannedShoppingList } from "../../meal-planning/types";
import { DatePickerSheet, dateToIso } from "../../meal-planning/components/date-picker-sheet";
import { ProductCard } from "../components/product-card";
import { setPlanShoppingRequirements } from "../components/required-plan-badge";
import {
  consumeMarketplaceAddress,
  getMarketplaceTemporaryLocation,
} from "../delivery-preferences";
import { formatMarketplaceAddress } from "../location-format";
import { openMarketplaceCart } from "../cart-navigation";
import { useOptimisticStoreCart } from "../use-optimistic-store-cart";
import {
  groupPlanIngredients,
  ingredientKey,
  matchesPlanIngredient,
  planDateRange,
  planQuantityLabel,
  planCartQuantityLabel,
  type PlanIngredient,
} from "../plan-shopping";

export function ShopPlanScreen() {
  const params = useLocalSearchParams<{ date?: string; range?: string; ingredients?: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [date, setDate] = useState(params.date || dateToIso(new Date()));
  const [range, setRange] = useState<"day" | "week" | "month">(
    params.range === "week" || params.range === "month" ? params.range : "day",
  );
  const [selection, setSelection] = useState<string[] | undefined>(() => {
    try {
      const names: unknown = JSON.parse(params.ingredients || "null");
      return Array.isArray(names) && names.every((name) => typeof name === "string")
        ? names.map(ingredientKey)
        : undefined;
    } catch {
      return undefined;
    }
  });
  const [ingredients, setIngredients] = useState<PlanIngredient[]>([]);
  const [catalogue, setCatalogue] = useState<MarketplaceCategoryStoreList>({
    category: "All",
    stores: [],
    total: 0,
  });
  const [cartProducts, setCartProducts] = useState<MarketplaceProduct[]>([]);
  const [active, setActive] = useState("all");
  const [showKitchen, setShowKitchen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [addressId, setAddressId] = useState<string>();
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const dates = useMemo(() => planDateRange(date, range), [date, range]);
  const sync = useOptimisticStoreCart(api, {
    updateProduct: (id, quantity) => {
      setCatalogue((current) => ({
        ...current,
        stores: current.stores.map((store) => ({
          ...store,
          products: store.products.map((product) =>
            product.id === id ? { ...product, cart_quantity: quantity } : product,
          ),
        })),
      }));
      const product = catalogue.stores
        .flatMap((store) => store.products)
        .find((product) => product.id === id);
      setCartProducts((current) => [
        ...current.filter((item) => item.id !== id),
        ...(product && quantity > 0 ? [{ ...product, cart_quantity: quantity }] : []),
      ]);
    },
    updateSummary: () => {},
    applyServerCart: (cart) => setCartProducts(cart.items.map((item) => item.product)),
    showError: setError,
  });
  const load = useCallback(
    async (refresh = false) => {
      const request = ++generation.current;
      refresh ? setRefreshing(true) : setLoading(true);
      setError(undefined);
      try {
        const temporary = getMarketplaceTemporaryLocation();
        const profile = await api.getMyConsumerProfile<ConsumerProfile>();
        const destination = temporary
          ? undefined
          : (consumeMarketplaceAddress() ??
            profile.addresses.find((address) => address.is_default)?.id ??
            profile.addresses[0]?.id);
        const [plan, products, cart] = await Promise.all([
          api.getMyShoppingList<PlannedShoppingList>(dates.start, dates.end),
          api.getMarketplaceProductCategory<MarketplaceCategoryStoreList>(
            "All",
            destination,
            temporary,
          ),
          api.getMarketplaceCart<MarketplaceCart>(destination, temporary),
        ]);
        if (request !== generation.current) return;
        setAddressId(destination);
        const address = profile.addresses.find((address) => address.id === destination);
        setLocation(
          temporary
            ? formatMarketplaceAddress(temporary)
            : address
              ? formatMarketplaceAddress(address)
              : "Location unavailable",
        );
        setIngredients(groupPlanIngredients(plan.items));
        setCatalogue(products);
        setCartProducts(cart.items.map((item) => item.product));
        sync.seed(
          products.stores.flatMap((store) => store.products),
          cart.id,
        );
      } catch (reason) {
        if (request === generation.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Your planned ingredients could not be loaded.",
          );
      } finally {
        if (request === generation.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, dates.start, dates.end],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );
  const needed = ingredients.filter(
    (item) => !item.inKitchen && (!selection || selection.includes(item.key)),
  );
  useEffect(() => {
    setPlanShoppingRequirements(
      user?.uid,
      ingredients.filter((item) => !item.inKitchen && (!selection || selection.includes(item.key))),
    );
  }, [ingredients, selection, user?.uid]);
  const available = ingredients.filter(
    (item) => (showKitchen || !item.inKitchen) && (!selection || selection.includes(item.key)),
  );
  const visible = active === "all" ? available : available.filter((item) => item.key === active);
  const inCart = (ingredient: PlanIngredient) =>
    cartProducts.some(
      (product) => product.cart_quantity > 0 && matchesPlanIngredient(product, ingredient),
    );
  const count = needed.filter(inCart).length;
  const cartParams = { addressId, returnTo: "shopping", date };
  const shortDate = (value: string, year = false) =>
    new Date(`${value}T12:00:00`).toLocaleDateString("en-MY", {
      day: "numeric",
      month: "short",
      ...(year ? { year: "numeric" as const } : {}),
    });
  const rangeLabel =
    dates.start === dates.end
      ? shortDate(dates.start, true)
      : `${shortDate(dates.start)} – ${shortDate(dates.end, true)}`;
  const changeDates = () => {
    setActive("all");
    setSelection(undefined);
  };
  const renderIngredient = ({ item }: { item: PlanIngredient }) => {
    const matches = catalogue.stores
      .flatMap((store) =>
        store.products
          .filter((product) => matchesPlanIngredient(product, item))
          .map((product) => ({ product, store })),
      )
      .sort(
        (a, b) =>
          Number(!!a.store.store_closed_today) - Number(!!b.store.store_closed_today) ||
          (a.store.distance_km ?? Infinity) - (b.store.distance_km ?? Infinity),
      );
    return (
      <View style={s.ingredient}>
        <View style={s.ingredientHeading}>
          <Text style={s.ingredientName}>{item.name}</Text>
          <Text
            style={[
              s.state,
              {
                color: item.inKitchen
                  ? colors.success
                  : inCart(item)
                    ? colors.marketStrong
                    : colors.textMuted,
              },
            ]}
          >
            {item.inKitchen ? "In kitchen" : inCart(item) ? "In cart" : "To shop"}
          </Text>
        </View>
        <Text style={s.copy}>
          {item.inKitchen
            ? "Already available in your kitchen"
            : `Needed: ${planQuantityLabel(item.quantities) || "Check recipe quantity"}`}
        </Text>
        <Text style={[s.copy, { color: inCart(item) ? colors.primaryStrong : colors.textMuted }]}>
          Added to carts: {planCartQuantityLabel(cartProducts, item)}
        </Text>
        {!!item.recipes.length && <Text style={s.muted}>For {item.recipes.join(", ")}</Text>}
        {!matches.length ? (
          <View style={s.noMatches}>
            <Ionicons name="search-outline" size={spacing[5]} color={colors.textMuted} />
            <Text style={s.muted}>No matching products available</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.products}
          >
            {matches.map(({ product, store }) => (
              <View key={product.id} style={s.product}>
                <ProductCard
                  product={product}
                  onQuantity={(quantity) => sync.changeQuantity(product, quantity)}
                  onOpen={() =>
                    router.push({
                      pathname: "/marketplace/[storeId]/products/[productId]",
                      params: { storeId: store.id, productId: product.id, ...cartParams },
                    } as never)
                  }
                />
                <Text numberOfLines={1} style={s.shop}>
                  {store.name}
                </Text>
                <Text style={s.muted}>
                  {store.store_closed_today ? "Closed" : "Open"} ·{" "}
                  {store.distance_km != null
                    ? `${store.distance_km.toFixed(1)} km`
                    : "Distance unavailable"}
                </Text>
                {product.expiry_date && product.expiry_date.slice(0, 10) <= dates.end ? (
                  <Text style={s.warning}>
                    Expires {product.expiry_date.slice(0, 10)} — check your meal date
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    );
  };
  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={s.back}
        >
          <Ionicons name="chevron-back" size={spacing[6]} color={colors.text} />
        </Pressable>
        <View style={s.title}>
          <PageHeader title="Shop for my plan" />
        </View>
      </View>
      <View style={s.panel}>
        <Pressable accessibilityRole="button" onPress={() => setDateOpen(true)} style={s.date}>
          <Ionicons name="calendar-outline" size={spacing[5]} color={colors.primaryStrong} />
          <Text style={s.link}>{rangeLabel}</Text>
          <Ionicons name="chevron-down" size={spacing[4]} color={colors.primaryStrong} />
        </Pressable>
        <View style={s.rangeRow}>
          {(["day", "week", "month"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: range === value }}
              onPress={() => {
                setRange(value);
                changeDates();
              }}
              style={[s.range, range === value && s.activeRange]}
            >
              <Text style={range === value ? s.activeText : s.copy}>
                {value === "day" ? "Day" : value === "week" ? "Week" : "Month"}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={s.locationRow}>
          <Ionicons name="location-outline" size={spacing[4]} color={colors.primaryStrong} />
          <Text numberOfLines={1} style={[s.muted, s.title]}>
            {location || "Using your marketplace location"}
          </Text>
        </View>
        <View style={s.options}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: showKitchen }}
            onPress={() => {
              setShowKitchen(!showKitchen);
              setActive("all");
            }}
            style={s.locationRow}
          >
            <Ionicons
              name={showKitchen ? "checkbox" : "square-outline"}
              size={spacing[5]}
              color={colors.primaryStrong}
            />
            <Text style={s.link}>Show already have</Text>
          </Pressable>
          {selection ? (
            <Pressable
              onPress={() => {
                setSelection(undefined);
                setActive("all");
              }}
            >
              <Text style={s.link}>Show all needed</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipScroller}
        contentContainerStyle={s.chips}
      >
        {[{ key: "all", name: showKitchen ? "All ingredients" : "All needed" }, ...available].map(
          (item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active === item.key }}
              onPress={() => setActive(item.key)}
              style={[s.chip, active === item.key && s.activeRange]}
            >
              <Text style={active === item.key ? s.activeText : s.copy}>{item.name}</Text>
            </Pressable>
          ),
        )}
      </ScrollView>
      {error ? (
        <Pressable onPress={() => void load()} style={s.error}>
          <Text style={s.warning}>{error} Tap to retry.</Text>
        </Pressable>
      ) : null}
      <FlatList
        style={s.results}
        ListHeaderComponent={
          <View style={s.resultsHeader}>
            <View style={s.locationRow}>
              <MaterialCommunityIcons
                name="clipboard-list-outline"
                size={spacing[5]}
                color={colors.ratingStar}
              />
              <Text style={s.copy}>Required for your plan</Text>
            </View>
            <Text style={s.muted}>Check pack quantities and expiry before buying.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(tabs)/marketplace")}
            >
              <Text style={s.link}>Browse all shops →</Text>
            </Pressable>
          </View>
        }
        data={loading ? [] : visible}
        renderItem={renderIngredient}
        keyExtractor={(item) => item.key}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={s.empty}>
              <Ionicons name="basket-outline" size={spacing[10]} color={colors.primaryStrong} />
              <Text style={s.ingredientName}>
                {ingredients.length ? "Nothing to shop for" : "No planned ingredients"}
              </Text>
              <Text style={s.copy}>
                {ingredients.length
                  ? "Your required ingredients are already in your kitchen. Change dates or show already have to browse."
                  : "Choose another date or add recipes to your plan."}
              </Text>
            </View>
          )
        }
        contentContainerStyle={s.list}
      />
      <View style={[s.footer, { paddingBottom: insets.bottom + spacing[3] }]}>
        <View style={s.title}>
          <Text style={s.shop}>
            {count} of {needed.length} ingredients in carts
          </Text>
          <Text style={s.muted}>Check quantities in your carts</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void openMarketplaceCart(cartParams)}
          style={s.cartButton}
        >
          <Text style={s.activeText}>View carts</Text>
        </Pressable>
      </View>
      <DatePickerSheet
        visible={dateOpen}
        value={date}
        title="Shop for which dates?"
        description="Choose the date for your planned ingredients."
        onClose={() => setDateOpen(false)}
        onSelect={(value) => {
          setDate(value);
          setDateOpen(false);
          changeDates();
        }}
      />
    </View>
  );
}

const font = typography.mobile.size,
  weight = typography.weight;
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  top: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  back: { padding: spacing[2] },
  title: { flex: 1 },
  panel: {
    margin: spacing[4],
    padding: spacing[4],
    borderRadius: spacing[4],
    backgroundColor: colors.primarySoft,
    gap: spacing[3],
  },
  date: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  rangeRow: { flexDirection: "row", gap: spacing[2] },
  range: {
    flex: 1,
    minHeight: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[3],
    backgroundColor: colors.surface,
  },
  activeRange: { backgroundColor: colors.primary },
  activeText: { color: colors.surface, fontSize: font.bodyInteraction, fontWeight: weight.bold },
  copy: { color: colors.text, fontSize: font.bodyInteraction, lineHeight: spacing[6] },
  muted: { color: colors.textMuted, fontSize: font.secondaryInteraction, lineHeight: spacing[5] },
  link: {
    color: colors.primaryStrong,
    fontSize: font.secondaryInteraction,
    fontWeight: weight.semibold,
  },
  options: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing[3],
  },
  chipScroller: { flexGrow: 0, flexShrink: 0, height: spacing[16] },
  chips: {
    alignItems: "center",
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  chip: {
    minHeight: spacing[12],
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderRadius: spacing[5],
    backgroundColor: colors.surface,
  },
  results: { flex: 1 },
  resultsHeader: { gap: spacing[2], paddingBottom: spacing[2] },
  locationRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  list: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
    gap: spacing[4],
    flexGrow: 1,
  },
  ingredient: {
    padding: spacing[4],
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
    gap: spacing[2],
  },
  ingredientHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  ingredientName: {
    flexShrink: 1,
    color: colors.text,
    fontSize: font.bodyTextHeavy,
    fontWeight: weight.bold,
  },
  state: { fontSize: font.secondaryInteraction, fontWeight: weight.semibold },
  products: { paddingTop: spacing[3] },
  product: { width: 170 },
  shop: { color: colors.text, fontSize: font.secondaryInteraction, fontWeight: weight.semibold },
  warning: { color: colors.danger, fontSize: font.caption, lineHeight: spacing[5] },
  noMatches: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing[3],
    gap: spacing[2],
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  cartButton: { padding: spacing[4], borderRadius: spacing[3], backgroundColor: colors.primary },
  empty: { padding: spacing[6], alignItems: "center", gap: spacing[4] },
  error: { paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
});
