import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, typography } from "@ecochef/design-tokens";
import type { Address, ConsumerProfile } from "@ecochef/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { chooseMarketplaceAddress, chooseMarketplaceTemporaryLocation, clearMarketplaceLocationDraft, MARKETPLACE_RECENT_LOCATIONS_KEY, startMarketplaceLocationEdit, type MarketplaceTemporaryLocation } from "../delivery-preferences";
import { locationType } from "../location-types";
import { getPreciseMarketplacePosition } from "../precise-location";
import { formatMarketplaceAddress } from "../location-format";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

const RECENT_LOCATIONS_KEY = "ecochef.marketplace.recent-location-ids";
type Filter = "Recent" | "Suggested" | "Saved";
const savedTypeOrder: Record<string, number> = { home: 0, work: 1, school: 2, saved: 3 };
const compareSavedLocations = (first: Address, second: Address) => {
  const typeDifference = (savedTypeOrder[first.address_type ?? "saved"] ?? 3) - (savedTypeOrder[second.address_type ?? "saved"] ?? 3);
  return typeDifference || (first.label ?? first.address_line_1).localeCompare(second.label ?? second.address_line_1);
};
type ApiLocation = { name?: string; address_line_1: string; city: string; state: string; postal_code: string; latitude: number; longitude: number };
type ApiLocationList = { locations: ApiLocation[] };
type Coordinates = { latitude: number; longitude: number };
const locationDetails = (location: ApiLocation | MarketplaceTemporaryLocation | Address, omitMainLine = false) => formatMarketplaceAddress({ address_line_1: omitMainLine ? "" : location.address_line_1, city: location.city, state: location.state, postal_code: location.postal_code });
const locationDistanceKm = (from: Coordinates | undefined, to: { latitude?: number; longitude?: number }) => {
  if (!from || !Number.isFinite(Number(to.latitude)) || !Number.isFinite(Number(to.longitude))) return undefined;
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(Number(to.latitude) - from.latitude);
  const longitudeDelta = radians(Number(to.longitude) - from.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(Number(to.latitude))) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(value));
};
const distanceLabel = (from: Coordinates | undefined, to: { latitude?: number; longitude?: number }) => {
  const distance = locationDistanceKm(from, to);
  return distance == null ? undefined : `${Number(distance.toFixed(2))}km`;
};

export function DeliveryAddressScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [profile, setProfile] = useState<ConsumerProfile>();
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [recentLocations, setRecentLocations] = useState<MarketplaceTemporaryLocation[]>([]);
  const [filter, setFilter] = useState<Filter>("Recent");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MarketplaceTemporaryLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const searchRequest = useRef(0);
  const [currentExpanded, setCurrentExpanded] = useState(false);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [nearbyLocations, setNearbyLocations] = useState<MarketplaceTemporaryLocation[]>([]);
  const [currentCoordinates, setCurrentCoordinates] = useState<Coordinates>();
  const [error, setError] = useState<string>();
  const locateDevice = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") throw new Error("Location permission is required to calculate distances.");
    if (!(await Location.hasServicesEnabledAsync())) throw new Error("Turn on Location Services to calculate distances.");
    const position = await getPreciseMarketplacePosition();
    if (position.mocked) throw new Error("Your device is reporting a simulated location. Turn off mock location and try again.");
    const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    setCurrentCoordinates(coordinates);
    return coordinates;
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status === "granted") {
        const cached = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000, requiredAccuracy: 500 });
        if (active && cached && !cached.mocked) setCurrentCoordinates({ latitude: cached.coords.latitude, longitude: cached.coords.longitude });
      }
      await locateDevice();
    })().catch(() => undefined);
    return () => { active = false; };
  }, [locateDevice]);
  useEffect(() => {
    const query = searchQuery.trim();
    const requestId = ++searchRequest.current;
    setSearchError(undefined);
    if (query.length < 3) { setSearchResults([]); setSearching(false); return; }
    const timer = setTimeout(() => {
      setSearching(true);
      void api.autocompleteMarketplaceLocation<ApiLocationList>(query, currentCoordinates?.latitude, currentCoordinates?.longitude).then((result) => {
        if (searchRequest.current === requestId) setSearchResults(result.locations);
      }).catch((next) => {
        if (searchRequest.current === requestId) { setSearchResults([]); setSearchError(next instanceof Error ? next.message : "Locations could not be searched."); }
      }).finally(() => { if (searchRequest.current === requestId) setSearching(false); });
    }, 400);
    return () => clearTimeout(timer);
  }, [api, searchQuery, currentCoordinates]);
  const load = useCallback(async () => {
    setError(undefined);
    try {
      const nextProfile = await api.getMyConsumerProfile<ConsumerProfile>();
      setProfile(nextProfile);
    } catch (next) {
      setProfile(undefined);
      setError(next instanceof Error ? next.message : "Saved locations could not be loaded.");
      return;
    }
    try {
      const stored = await AsyncStorage.getItem(RECENT_LOCATIONS_KEY);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new Error("Invalid recent-location history");
      setRecentIds(parsed);
    } catch {
      setRecentIds([]);
      await AsyncStorage.removeItem(RECENT_LOCATIONS_KEY).catch(() => undefined);
    }
    try {
      const storedLocations = await AsyncStorage.getItem(MARKETPLACE_RECENT_LOCATIONS_KEY);
      const parsed: unknown = storedLocations ? JSON.parse(storedLocations) : [];
      if (!Array.isArray(parsed)) throw new Error("Invalid recent locations");
      setRecentLocations((parsed as MarketplaceTemporaryLocation[]).filter((item) => item && typeof item.address_line_1 === "string" && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).slice(0, 10));
    } catch {
      setRecentLocations([]);
      await AsyncStorage.removeItem(MARKETPLACE_RECENT_LOCATIONS_KEY).catch(() => undefined);
    }
  }, [api]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const matching = profile?.addresses ?? [];
  const recent = recentIds.map((id) => matching.find((item) => item.id === id)).filter((item): item is Address => !!item).sort(compareSavedLocations);
  const suggested = [...matching].sort(compareSavedLocations);
  const visible = filter === "Recent" ? recent : filter === "Suggested" ? suggested : matching;
  const remember = async (id: string) => { const next = [id, ...recentIds.filter((item) => item !== id)].slice(0, 8); setRecentIds(next); await AsyncStorage.setItem(RECENT_LOCATIONS_KEY, JSON.stringify(next)); };
  const finishSelection = () => returnTo === "cart" ? router.back() : router.dismissTo("/(tabs)/marketplace");
  const choose = (id: string) => { void remember(id); chooseMarketplaceAddress(id); finishSelection(); };
  const chooseRecent = (location: MarketplaceTemporaryLocation) => { chooseMarketplaceTemporaryLocation(location); finishSelection(); };
  const chooseNearby = async (location: MarketplaceTemporaryLocation) => {
    chooseMarketplaceTemporaryLocation(location);
    const next = [location, ...recentLocations.filter((item) => Math.abs(item.latitude - location.latitude) > .00001 || Math.abs(item.longitude - location.longitude) > .00001)].slice(0, 10);
    setRecentLocations(next);
    await AsyncStorage.setItem(MARKETPLACE_RECENT_LOCATIONS_KEY, JSON.stringify(next)).catch(() => undefined);
    finishSelection();
  };
  const toggleCurrentLocation = async () => {
    if (currentExpanded) { setCurrentExpanded(false); return; }
    setCurrentExpanded(true);
    if (nearbyLocations.length) return;
    setCurrentLoading(true); setError(undefined);
    try {
      const coordinates = currentCoordinates ?? await locateDevice();
      const result = await api.getNearbyMarketplaceLocations<ApiLocationList>(coordinates.latitude, coordinates.longitude);
      if (!result.locations.length) throw new Error("No nearby delivery locations were found. Try searching for your address instead.");
      setNearbyLocations([...result.locations].sort((first, second) => (locationDistanceKm(coordinates, first) ?? Number.POSITIVE_INFINITY) - (locationDistanceKm(coordinates, second) ?? Number.POSITIVE_INFINITY)));
    } catch (next) { setError(next instanceof Error ? next.message : "Your current location could not be retrieved."); }
    finally { setCurrentLoading(false); }
  };
  const addNew = () => { clearMarketplaceLocationDraft(); router.push("/marketplace/delivery/search" as never); };
  const editSaved = (address: Address) => { startMarketplaceLocationEdit(address); router.push("/marketplace/delivery/form" as never); };
  const matchingRecentLocations = recentLocations;
  const empty = !visible.length && (filter !== "Recent" || !matchingRecentLocations.length);
  return <View style={styles.root}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 28 }]}><Header title="Delivery address" onBack={() => router.back()}/><View style={styles.search}><Ionicons name="search-outline" size={20} color={colors.textSubtle}/><TextInput autoFocus value={searchQuery} onChangeText={setSearchQuery} autoCorrect={false} returnKeyType="search" style={styles.searchInput} placeholder="Search all locations" placeholderTextColor={colors.textSubtle}/>{searching ? <ActivityIndicator size="small" color={colors.primary}/> : searchQuery ? <Pressable hitSlop={8} onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={20} color={colors.textSubtle}/></Pressable> : null}</View>{searchQuery.trim() ? <View style={styles.globalResults}>{searching ? <View style={styles.globalStatus}><ActivityIndicator size="small" color={colors.primary}/><Text style={styles.globalStatusText}>Searching locations…</Text></View> : searchResults.map((item) => <Pressable key={`${item.latitude}-${item.longitude}`} style={base.row} onPress={() => void chooseNearby(item)}><View style={[base.rowIcon, { backgroundColor: colors.surfaceMuted }]}><Ionicons name="location-outline" size={20} color={colors.textMuted}/></View><View style={base.flex}><Text style={base.rowTitle}>{item.name ?? item.address_line_1}</Text><Text style={base.rowSubtitle} numberOfLines={2}>{[distanceLabel(currentCoordinates, item), locationDetails(item, !item.name)].filter(Boolean).join(" · ")}</Text></View></Pressable>)}{!searching && searchQuery.trim().length >= 3 && !searchResults.length && !searchError ? <Text style={styles.empty}>No matching locations found.</Text> : null}{searchError ? <Text style={styles.error}>{searchError}</Text> : null}</View> : <><View style={styles.filters}>{(["Recent", "Suggested", "Saved"] as Filter[]).map((item) => <Pressable key={item} style={[styles.filter, filter === item && styles.filterActive]} onPress={() => setFilter(item)}><Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item}</Text></Pressable>)}</View>{filter !== "Saved" ? <><CurrentLocationRow expanded={currentExpanded} loading={currentLoading} onPress={() => void toggleCurrentLocation()}/>{currentExpanded ? <View style={styles.currentResults}>{currentLoading ? <View style={styles.currentLoading}><ActivityIndicator size="small" color={colors.primary}/><Text style={styles.currentLoadingText}>Finding locations near you…</Text></View> : nearbyLocations.map((item) => <Pressable key={`${item.latitude}-${item.longitude}`} style={styles.nearbyRow} onPress={() => void chooseNearby(item)}><View style={styles.nearbyIcon}><Ionicons name="location-outline" size={18} color={colors.textMuted}/></View><View style={styles.flex}><Text style={styles.nearbyTitle}>{item.name ?? item.address_line_1}</Text><Text style={styles.nearbySubtitle} numberOfLines={2}>{[distanceLabel(currentCoordinates, item), locationDetails(item, !item.name)].filter(Boolean).join(" · ")}</Text></View></Pressable>)}</View> : null}</> : null}{filter === "Saved" ? <Pressable style={({ pressed }) => [styles.addNew, pressed && styles.pressed]} onPress={addNew}><View style={styles.addIcon}><Ionicons name="add" size={22} color={colors.surface}/></View><View style={styles.flex}><Text style={styles.addTitle}>Add new address</Text><Text style={styles.addCopy}>Search and save another delivery location</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textSubtle}/></Pressable> : null}{visible.map((item) => <AddressRow key={item.id} address={item} currentCoordinates={currentCoordinates} onPress={() => choose(item.id)} onEdit={filter === "Saved" ? () => editSaved(item) : undefined}/>)}{filter === "Recent" ? matchingRecentLocations.map((item) => <TemporaryLocationRow key={`${item.latitude}-${item.longitude}`} location={item} currentCoordinates={currentCoordinates} onPress={() => chooseRecent(item)}/>) : null}{empty ? <Text style={styles.empty}>No {filter.toLowerCase()} addresses yet.</Text> : null}{error ? <Text style={styles.error}>{error}</Text> : null}</>}</ScrollView></View>;
}

export function Header({ title, onBack }: { title: string; onBack: () => void }) { return <View style={base.header}><Pressable style={base.back} onPress={onBack}><Ionicons name="chevron-back" size={22} color={colors.text}/></Pressable><Text style={base.title}>{title}</Text><View style={base.headerSpace}/></View>; }
function CurrentLocationRow({ expanded, loading, onPress }: { expanded: boolean; loading: boolean; onPress: () => void }) { return <Pressable style={base.row} onPress={onPress}><View style={[base.rowIcon, { backgroundColor: colors.surfaceMuted }]}><Ionicons name="navigate" size={20} color={colors.textMuted}/></View><View style={base.flex}><Text style={base.rowTitle}>Current location</Text><Text style={base.rowSubtitle}>{loading ? "Finding nearby locations…" : "Use your device’s live location"}</Text></View><Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={17} color={colors.textSubtle}/></Pressable>; }
export function AddressRow({ address, currentCoordinates, onPress, onEdit }: { address: Address; currentCoordinates?: Coordinates; onPress: () => void; onEdit?: () => void }) { const appearance = locationType(address.address_type); const distance = distanceLabel(currentCoordinates, address); return <Pressable style={base.row} onPress={onPress}><View style={[base.rowIcon, { backgroundColor: appearance.background }]}><Ionicons name={appearance.icon} size={20} color={appearance.color}/></View><View style={base.flex}><Text style={base.rowTitle}>{address.label || address.address_line_1}</Text><Text style={base.rowSubtitle} numberOfLines={1}>{[distance, locationDetails(address)].filter(Boolean).join(" · ")}</Text></View>{onEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${address.label || "saved location"}`} hitSlop={8} style={styles.editAddress} onPress={(event) => { event.stopPropagation(); onEdit(); }}><Ionicons name="pencil-outline" size={18} color={colors.primaryStrong}/></Pressable> : null}</Pressable>; }
function TemporaryLocationRow({ location, currentCoordinates, onPress }: { location: MarketplaceTemporaryLocation; currentCoordinates?: Coordinates; onPress: () => void }) { const distance = distanceLabel(currentCoordinates, location); return <Pressable style={base.row} onPress={onPress}><View style={[base.rowIcon, { backgroundColor: colors.surfaceMuted }]}><Ionicons name="time-outline" size={20} color={colors.textMuted}/></View><View style={base.flex}><Text style={base.rowTitle}>{location.name ?? location.address_line_1}</Text><Text style={base.rowSubtitle} numberOfLines={1}>{[distance, locationDetails(location, !location.name)].filter(Boolean).join(" · ")}</Text></View></Pressable>; }
export const base = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.consumerCanvas }, content: { paddingHorizontal: 18 }, header: { flexDirection: "row", alignItems: "center", marginBottom: 18 }, back: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: colors.surface }, title: { flex: 1, color: colors.text, fontSize: typography.mobile.rawSize.s20, fontWeight: typography.weight.black, textAlign: "center" }, headerSpace: { width: 40 }, flex: { flex: 1 }, search: { height: 52, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface }, searchInput: { flex: 1, color: colors.text, fontSize: typography.mobile.rawSize.s13 }, searchPlaceholder: { flex: 1, color: colors.textSubtle, fontSize: typography.mobile.rawSize.s13 }, row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, rowIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14 }, rowTitle: { color: colors.text, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.black }, rowSubtitle: { marginTop: 3, color: colors.textMuted, fontSize: typography.mobile.rawSize.s10 }, empty: { paddingVertical: 24, color: colors.textMuted, fontSize: typography.mobile.rawSize.s11, textAlign: "center" }, error: { marginTop: 12, color: colors.danger, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold }, pressed: { opacity: .65 } });
const styles = StyleSheet.create({ ...base, globalResults: { paddingTop: 8 }, globalStatus: { minHeight: 72, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 }, globalStatusText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold }, filters: { flexDirection: "row", gap: 8, marginVertical: 14 }, filter: { minHeight: 48, flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, paddingVertical: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface }, filterActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, filterText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold }, filterTextActive: { color: colors.primaryStrong }, currentResults: { marginLeft: 24, paddingLeft: 18, borderLeftWidth: 2, borderLeftColor: colors.primaryBorder }, currentLoading: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10 }, currentLoadingText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold }, nearbyRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingRight: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, nearbyIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: colors.surfaceMuted }, nearbyTitle: { color: colors.text, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.extrabold }, nearbySubtitle: { marginTop: 2, color: colors.textMuted, fontSize: typography.mobile.rawSize.s9, lineHeight: 13 }, editAddress: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.primarySoft }, addNew: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 5, paddingHorizontal: 11, borderWidth: 1, borderColor: colors.primaryBorder, borderRadius: 14, backgroundColor: colors.surface }, addIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: colors.primary }, addTitle: { color: colors.primaryStrong, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.black }, addCopy: { marginTop: 2, color: colors.textMuted, fontSize: typography.mobile.rawSize.s8 } });
