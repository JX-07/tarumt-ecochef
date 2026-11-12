import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import { MARKETPLACE_PRODUCT_CATEGORIES, type Address, type ConsumerProfile, type MarketplaceCart, type MarketplaceSlotAvailability, type MarketplaceStoreList, type MarketplaceStoreSummary, type MarketplaceSummary } from "@ecochef/contracts";
import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { PageHeader, PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { requestShoppingReturn } from "../../meal-planning/shopping-return";
import { CartButton } from "../components/cart-button";
import { StoreCard } from "../components/store-card";
import { openMarketplaceCart } from "../cart-navigation";
import { DeliveryChoiceSheet, DeliveryTimeSheet } from "../components/delivery-sheets";
import { chooseMarketplaceAddress, chooseMarketplaceTemporaryLocation, clearMarketplaceLocationDraft, consumeMarketplaceAddress, getMarketplaceArrival, getMarketplaceTemporaryLocation, setMarketplaceArrival, type MarketplaceTemporaryLocation } from "../delivery-preferences";
import { getPreciseMarketplacePosition } from "../precise-location";
import { formatMarketplaceAddress } from "../location-format";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

const SAVED_LOCATION_RADIUS_KM = .3;
const NEARBY_STORE_RADIUS_KM = 10;
const PRODUCT_CATEGORY_VISUALS = [
  { icon: "🥬", backgroundColor: colors.successSoft },
  { icon: "🥐", backgroundColor: colors.marketSoft },
  { icon: "🥫", backgroundColor: colors.adminSoft },
  { icon: "🍱", backgroundColor: colors.dangerSoft },
  { icon: "🥤", backgroundColor: colors.todaySoft },
  { icon: "🥛", backgroundColor: colors.surface },
  { icon: "🍫", backgroundColor: colors.marketSoft },
] as const;
type Coordinates = { latitude: number; longitude: number };
type MarketplaceListItem =
  | { kind: "heading"; key: string; title: string }
  | { kind: "store"; key: string; store: MarketplaceStoreSummary }
  | { kind: "nearby-empty"; key: string };
const distanceKm = (latitude: number, longitude: number, address: { latitude?: number; longitude?: number }) => {
  if (!Number.isFinite(address.latitude) || !Number.isFinite(address.longitude)) return Number.POSITIVE_INFINITY;
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(Number(address.latitude) - latitude);
  const longitudeDelta = radians(Number(address.longitude) - longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(Number(address.latitude))) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(value));
};
const compactDistance = (distance: number | undefined) => distance == null ? undefined : distance < .005 ? "0.00km" : `${Number(distance.toFixed(2))}km`;
const savedLocationHeading = (address: Address) => {
  const type = address.address_type ?? "saved";
  return type === "saved" ? address.label?.trim() || "Saved" : `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
};
const arrivalWindowSummary = (value?: string) => {
  if (!value) return undefined;
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return undefined;
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const day = start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = (date: Date) => date.toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${day} · ${time(start)} – ${time(end)}`;
};
const arrivalTimeSummary = (value?: string) => {
  if (!value) return "Deliver Now";
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return "Deliver Now";
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const time = (date: Date) => date.toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${time(start)} - ${time(end)}`;
};

export function MarketplaceScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { returnTo, date } = useLocalSearchParams<{ returnTo?: string; date?: string }>();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () =>
    user && typeof user.getIdToken === "function" ? user.getIdToken() : undefined
  ), [user]);
  const loadAvailability = useCallback((day: string) => api.getMarketplaceSlotAvailability<MarketplaceSlotAvailability>(day), [api]);
  const [profile, setProfile] = useState<ConsumerProfile>();
  const [addressId, setAddressId] = useState<string>();
  const [temporaryLocation, setTemporaryLocation] = useState<MarketplaceTemporaryLocation>();
  const [currentCoordinates, setCurrentCoordinates] = useState<Coordinates>();
  const profileRef = useRef<ConsumerProfile | undefined>(undefined);
  const addressIdRef = useRef<string | undefined>(undefined);
  const loadGeneration = useRef(0);
  const [addressOpen, setAddressOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [arrivalAt, setArrivalAt] = useState(getMarketplaceArrival());
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [summary, setSummary] = useState<MarketplaceSummary>({ deals_active: 0, average_savings_percent: 0, cart_item_count: 0 });
  const [stores, setStores] = useState<MarketplaceStoreList>({ stores: [], total: 0 });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const returning = useRef(false);
  const allowShoppingReturn = useRef(returnTo === "shopping");

  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { allowShoppingReturn.current = returnTo === "shopping"; returning.current = false; }, [returnTo, date]);
  const leave = useCallback(() => {
    if (returnTo === "shopping" && allowShoppingReturn.current) {
      returning.current = true; requestShoppingReturn(date);
      if (router.canGoBack()) router.back(); else router.replace("/(tabs)/plan");
      return;
    }
    if (router.canGoBack()) router.back(); else router.replace("/(tabs)");
  }, [returnTo, date]);
  useEffect(() => (navigation as unknown as { addListener: (name: "beforeRemove", listener: (event: { preventDefault: () => void }) => void) => () => void }).addListener("beforeRemove", (event) => { if (returnTo !== "shopping" || !allowShoppingReturn.current || returning.current) return; event.preventDefault(); leave(); }), [navigation, returnTo, leave]);
  useEffect(() => navigation.addListener("blur", () => { if (!returning.current) allowShoppingReturn.current = false; }), [navigation]);
  useFocusEffect(useCallback(() => { if (returnTo !== "shopping") return; const subscription = BackHandler.addEventListener("hardwareBackPress", () => { leave(); return true; }); return () => subscription.remove(); }, [returnTo, leave]));

  const resolveAutomaticLocation = useCallback(async (nextProfile: ConsumerProfile) => {
    setLocating(true);
    try {
      if (typeof Location.requestForegroundPermissionsAsync !== "function") {
        throw new Error("Location is unavailable in this app build. Please update the app or choose a saved delivery address.");
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Location permission is required to find your delivery address.");
      if (typeof Location.hasServicesEnabledAsync === "function" && !(await Location.hasServicesEnabledAsync())) {
        throw new Error("Turn on Location Services to find your delivery address.");
      }
      const position = await getPreciseMarketplacePosition();
      if (position.mocked) throw new Error("Your device is reporting a simulated location.");
      setCurrentCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      const closestSaved = (nextProfile.addresses ?? [])
        .map((address) => ({ address, distance: distanceKm(position.coords.latitude, position.coords.longitude, address) }))
        .filter((item) => item.distance <= SAVED_LOCATION_RADIUS_KM)
        .sort((a, b) => a.distance - b.distance)[0]?.address;
      if (closestSaved) return { addressId: closestSaved.id };
      const current = await api.reverseMarketplaceLocation<MarketplaceTemporaryLocation>(position.coords.latitude, position.coords.longitude);
      return { temporary: current };
    } finally { setLocating(false); }
  }, [api]);

  const load = useCallback(async (refresh = false, requestedAddressId?: string, requestedTemporary?: MarketplaceTemporaryLocation) => {
    const generation = ++loadGeneration.current;
    refresh ? setRefreshing(true) : setLoading(true); setError(undefined);
    try {
      // Refresh saved addresses when one was explicitly selected. The delivery
      // screen may contain a newly added or edited address that is not present
      // in the marketplace screen's cached profile yet.
      const nextProfile = requestedAddressId
        ? await api.getMyConsumerProfile<ConsumerProfile>()
        : profileRef.current ?? await api.getMyConsumerProfile<ConsumerProfile>();
      if (generation !== loadGeneration.current) return;
      let activeTemporary = requestedTemporary ?? getMarketplaceTemporaryLocation();
      let chosenAddress = activeTemporary ? undefined : requestedAddressId ?? addressIdRef.current;
      if (!activeTemporary && !chosenAddress) {
        chosenAddress = nextProfile.addresses?.find((address) => address.is_default)?.id
          ?? nextProfile.addresses?.[0]?.id;
      }
      if (!activeTemporary && !chosenAddress) {
        try {
          const automatic = await resolveAutomaticLocation(nextProfile);
          if (generation !== loadGeneration.current) return;
          activeTemporary = automatic.temporary;
          chosenAddress = automatic.addressId;
          if (activeTemporary) chooseMarketplaceTemporaryLocation(activeTemporary);
        } catch {
          if (generation !== loadGeneration.current) return;
          // Device location is an enhancement, not a requirement for browsing.
          // Older Expo clients can lack one of the native location methods, so
          // fall back to the customer's saved delivery address without turning
          // the whole marketplace into an error state.
          chosenAddress = nextProfile.addresses?.find((address) => address.is_default)?.id
            ?? nextProfile.addresses?.[0]?.id;
        }
      }
      profileRef.current = nextProfile;
      addressIdRef.current = chosenAddress;
      if (!activeTemporary && chosenAddress) chooseMarketplaceAddress(chosenAddress);
      setProfile(nextProfile); setAddressId(chosenAddress); setTemporaryLocation(activeTemporary);
      void api.getMarketplaceSummary<MarketplaceSummary>()
        .then(result => { if (generation === loadGeneration.current) setSummary(result); })
        .catch(() => undefined);
      void api.getMarketplaceCart<MarketplaceCart>(chosenAddress, activeTemporary)
        .then(result => { if (generation === loadGeneration.current) setDeliveryFee(Number(result.delivery_fee)); })
        .catch(() => undefined);
      const nextStores = await api.getMarketplaceStores<MarketplaceStoreList>(search, chosenAddress, activeTemporary);
      if (generation !== loadGeneration.current) return;
      setStores(nextStores);
    } catch (next) { if (generation === loadGeneration.current) setError(next instanceof Error ? next.message : "The marketplace could not be loaded."); }
    finally { if (generation === loadGeneration.current) { setLoading(false); setRefreshing(false); } }
  }, [api, search, resolveAutomaticLocation]);
  useFocusEffect(useCallback(() => {
    clearMarketplaceLocationDraft();
    const pendingAddress = consumeMarketplaceAddress();
    const pendingTemporary = getMarketplaceTemporaryLocation();
    if (pendingAddress) { addressIdRef.current = pendingAddress; setAddressId(pendingAddress); }
    if (pendingTemporary) { addressIdRef.current = undefined; setAddressId(undefined); }
    setTemporaryLocation(pendingTemporary);
    setArrivalAt(getMarketplaceArrival());
    void load(false, pendingAddress, pendingTemporary);
  }, [load]));
  const selectedAddress = profile?.addresses.find((item) => item.id === addressId);
  const locationHeading = selectedAddress ? savedLocationHeading(selectedAddress) : "Current Location";
  const addressSummary = temporaryLocation
    ? formatMarketplaceAddress(temporaryLocation)
    : selectedAddress
      ? formatMarketplaceAddress(selectedAddress)
      : undefined;
  const deliveryTarget = temporaryLocation ?? selectedAddress;
  const deliveryDistance = currentCoordinates && deliveryTarget
    ? compactDistance(distanceKm(currentCoordinates.latitude, currentCoordinates.longitude, deliveryTarget))
    : undefined;
  const marketplaceAddressSummary = [deliveryDistance, addressSummary].filter(Boolean).join(" · ");
  const arrivalSummary = arrivalWindowSummary(arrivalAt);
  const marketplaceRows = useMemo<MarketplaceListItem[]>(() => {
    const byDistance = [...stores.stores].sort((a, b) => (a.distance_km ?? Number.MAX_SAFE_INTEGER) - (b.distance_km ?? Number.MAX_SAFE_INTEGER));
    const nearby = byDistance.filter((store) => store.distance_km != null && store.distance_km <= NEARBY_STORE_RADIUS_KM);
    const farther = byDistance.filter((store) => store.distance_km == null || store.distance_km > NEARBY_STORE_RADIUS_KM);
    return [
      { kind: "heading", key: "nearby-heading", title: "Nearby Shops" },
      ...(nearby.length
        ? nearby.map((store): MarketplaceListItem => ({ kind: "store", key: `nearby-${store.id}`, store }))
        : [{ kind: "nearby-empty", key: "nearby-empty" } as MarketplaceListItem]),
      ...(farther.length
        ? [
          { kind: "heading", key: "more-heading", title: "More Shops" } as MarketplaceListItem,
          ...farther.map((store): MarketplaceListItem => ({ kind: "store", key: `farther-${store.id}`, store })),
        ]
        : []),
    ];
  }, [stores.stores]);
  const clearBasket = async () => {
    try {
      const cart = await api.getMarketplaceCart<MarketplaceCart>();
      await Promise.all(cart.items.map((item) => api.removeMarketplaceCartItem<MarketplaceCart>(item.product.id)));
      setSummary((current) => ({ ...current, cart_item_count: 0 }));
      setMarketplaceArrival(undefined); setArrivalAt(undefined); setTimeOpen(false);
    } catch (next) { setError(next instanceof Error ? next.message : "The basket could not be cleared."); }
  };
  const openStore = (storeId: string) => {
    const params: string[] = [];
    if (addressId) params.push(`addressId=${encodeURIComponent(addressId)}`);
    if (returnTo) params.push(`returnTo=${encodeURIComponent(returnTo)}`);
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    const query = params.join("&");
    router.push(`/marketplace/${encodeURIComponent(storeId)}${query ? `?${query}` : ""}` as never);
  };
  const openProductCategory = (category: string) => router.push({
    pathname: "/marketplace/products/[category]" as never,
    params: { category, ...(addressId ? { addressId } : {}), ...(returnTo ? { returnTo, date } : {}) },
  } as never);

  const listHeader = <>
      <View style={styles.header}>{returnTo === "shopping" ? <Pressable onPress={leave} style={styles.back}><Ionicons name="chevron-back" size={21} color={colors.text} /></Pressable> : null}<View style={styles.headerContent}><PageHeader title="Marketplace" action={<CartButton count={summary.cart_item_count} onPress={() => openMarketplaceCart({ ...(addressId ? { addressId } : {}), ...(returnTo ? { returnTo, date } : {}) })} />}/></View></View>
      <Pressable style={styles.address} onPress={() => setAddressOpen(true)}><Ionicons name="location-outline" size={21} color={colors.surface} /><View style={styles.addressCopy}><Text style={styles.addressHeading}>{locationHeading}</Text><Text style={styles.addressText} numberOfLines={1}>{marketplaceAddressSummary || (locating ? "Finding your location…" : "Location unavailable")}</Text><Text style={styles.addressDelivery}>{arrivalTimeSummary(arrivalAt)}</Text></View><Ionicons name="chevron-down" size={19} color={colors.surface} /></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/marketplace/shop-plan", params: date ? { date } : {} } as never)} style={styles.planShopping}><Ionicons name="calendar-outline" size={24} color={colors.primaryStrong}/><View style={{flex:1}}><Text style={styles.planShoppingTitle}>Shop for my plan</Text><Text style={styles.planShoppingCopy}>Find the ingredients missing from your planned meals</Text></View><Ionicons name="chevron-forward" size={20} color={colors.primaryStrong}/></Pressable>
      <View style={styles.search}><Ionicons name="search-outline" size={19} color={colors.textSubtle} /><TextInput value={query} onChangeText={setQuery} placeholder="Search shops or items..." placeholderTextColor={colors.textSubtle} style={styles.searchInput} /><ActivityIndicator animating={loading && !!search} size="small" color={colors.primary} /></View>
      {error && <Pressable style={styles.error} onPress={() => void load()}><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable>}
      <View style={styles.productCategories}><Text style={styles.productCategoriesTitle}>Product Categories</Text><FlatList horizontal data={MARKETPLACE_PRODUCT_CATEGORIES} keyExtractor={(category) => category} renderItem={({ item, index }) => <Pressable accessibilityRole="button" accessibilityLabel={`Browse ${item}`} onPress={() => openProductCategory(item)} style={({ pressed }) => [styles.productCategory, { backgroundColor: PRODUCT_CATEGORY_VISUALS[index].backgroundColor }, pressed && styles.productCategoryPressed]}><Text style={styles.productCategoryEmoji}>{PRODUCT_CATEGORY_VISUALS[index].icon}</Text><Text numberOfLines={2} style={styles.productCategoryLabel}>{item}</Text></Pressable>} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productCategoryRow} /></View>
    </>;

  return <View style={styles.root}>
    <FlatList
      data={loading && !stores.stores.length ? [] : marketplaceRows}
      keyExtractor={(item) => item.key}
      renderItem={({ item }) => item.kind === "store"
        ? <StoreCard store={item.store} onPress={() => openStore(item.store.id)} />
        : item.kind === "heading"
          ? <Text style={styles.storeSectionTitle}>{item.title}</Text>
          : <View style={styles.nearbyEmpty}><Ionicons name="location-outline" size={28} color={colors.textSubtle} /><Text style={styles.nearbyEmptyTitle}>No store nearby</Text><Text style={styles.nearbyEmptyCopy}>You can still browse shops that deliver from farther away.</Text></View>}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={loading ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : undefined}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + PAGE_TOP_GAP, paddingBottom: Math.max(insets.bottom + 105, 120) }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      initialNumToRender={6}
      maxToRenderPerBatch={8}
      windowSize={5}
      showsVerticalScrollIndicator={false}
    />
    <DeliveryChoiceSheet visible={addressOpen} addressSummary={addressSummary} arrivalSummary={arrivalSummary} onAddress={() => router.push("/marketplace/delivery")} onTime={() => setTimeOpen(true)} onClose={() => setAddressOpen(false)}/>
    <DeliveryTimeSheet loadAvailability={loadAvailability} visible={timeOpen} value={arrivalAt} deliveryFee={deliveryFee} onSelect={(value) => { setMarketplaceArrival(value); setArrivalAt(value); }} onClearCart={() => void clearBasket()} onClose={() => setTimeOpen(false)}/>
  </View>;
}

const styles = StyleSheet.create({
  planShopping: { flexDirection: "row", alignItems: "center", gap: spacing[3], padding: spacing[4], marginBottom: spacing[3], borderRadius: spacing[4], backgroundColor: colors.primarySoft },
  planShoppingTitle: { color: colors.primaryStrong, fontSize: typography.mobile.size.bodyTextHeavy, fontWeight: typography.weight.bold },
  planShoppingCopy: { color: colors.textMuted, fontSize: typography.mobile.size.secondaryInteraction, marginTop: 4 },

  root: { flex: 1, backgroundColor: colors.consumerCanvas }, content: { paddingHorizontal: 18, paddingBottom: 112 }, flex: { flex: 1 }, header: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 16 }, headerContent: { flex: 1 }, back: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: colors.surfaceMuted },
  address: { marginBottom: spacing[3], minHeight: 82, flexDirection: "row", alignItems: "center", gap: 12, padding: 15, borderWidth: 1, borderColor: colors.primaryStrong, borderRadius: 18, backgroundColor: colors.primaryStrong, elevation: 2 }, addressCopy: { flex: 1 }, addressHeading: { marginBottom: 3, color: colors.surface, fontSize: typography.mobile.size.secondaryInteraction, fontWeight: typography.weight.bold }, addressText: { color: colors.textOnMedia, fontSize: typography.mobile.size.caption, lineHeight: 18, fontWeight: typography.weight.semibold }, addressDelivery: { marginTop: 4, color: colors.textOnMedia, fontSize: typography.mobile.size.caption, lineHeight: 18, fontWeight: typography.weight.semibold },
  search: { height: 54, flexDirection: "row", alignItems: "center", gap: 9, marginTop: 0, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 17, backgroundColor: colors.surface }, searchInput: { flex: 1, color: colors.text, fontSize: typography.mobile.size.secondaryInteraction },
  productCategories: { marginTop: spacing[5] }, productCategoriesTitle: { color: colors.text, fontSize: typography.mobile.size.bodyTextHeavy, fontWeight: typography.weight.bold }, productCategoryRow: { gap: 10, paddingTop: 10 }, productCategory: { width: 146, height: 58, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 15 }, productCategoryPressed: { opacity: .68 }, productCategoryEmoji: { fontSize: typography.mobile.rawSize.s28, lineHeight: 34 }, productCategoryLabel: { flex: 1, color: colors.text, fontSize: typography.mobile.size.caption, lineHeight: 16, fontWeight: typography.weight.bold },
  storeSectionTitle: { marginTop: 24, marginBottom: 12, color: colors.text, fontSize: typography.mobile.size.bodyTextHeavy, fontWeight: typography.weight.bold }, nearbyEmpty: { alignItems: "center", marginBottom: 2, padding: 22, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface }, nearbyEmptyTitle: { marginTop: 7, color: colors.text, fontSize: typography.mobile.size.secondaryTextHeavy, fontWeight: typography.weight.bold }, nearbyEmptyCopy: { marginTop: 4, color: colors.textMuted, fontSize: typography.mobile.size.caption, lineHeight: 18, textAlign: "center" },
  loading: { marginTop: 70 }, error: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: colors.dangerSoft }, errorText: { color: colors.danger, fontSize: typography.mobile.size.caption, fontWeight: typography.weight.bold }, empty: { alignItems: "center", padding: 28, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface }, emptyTitle: { marginTop: 8, color: colors.text, fontSize: typography.mobile.size.secondaryTextHeavy, fontWeight: typography.weight.bold }, emptyCopy: { marginTop: 5, color: colors.textMuted, fontSize: typography.mobile.size.caption, textAlign: "center" },
});
