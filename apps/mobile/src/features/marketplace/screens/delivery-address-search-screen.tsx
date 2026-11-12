import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, typography } from "@ecochef/design-tokens";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { chooseMarketplaceTemporaryLocation, getMarketplaceLocationDraft, MARKETPLACE_RECENT_LOCATIONS_KEY, updateMarketplaceLocationDraft, type MarketplaceTemporaryLocation } from "../delivery-preferences";
import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { Header, base } from "./delivery-address-screen";
import { getPreciseMarketplacePosition } from "../precise-location";
import { formatMarketplaceAddress } from "../location-format";

type LocatedAddress = { name?: string; addressLine1: string; city: string; state: string; postalCode: string; latitude: number; longitude: number };
type ApiLocation = { name?: string; address_line_1: string; city: string; state: string; postal_code: string; latitude: number; longitude: number };
type ApiLocationList = { locations: ApiLocation[] };
type Coordinates = { latitude: number; longitude: number };
const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

const locationLabel = (item: LocatedAddress) => formatMarketplaceAddress({ address_line_1: item.name ?? item.addressLine1, city: item.city, state: item.state, postal_code: item.postalCode });
const locationDetails = (item: LocatedAddress) => formatMarketplaceAddress({ address_line_1: item.name ? item.addressLine1 : "", city: item.city, state: item.state, postal_code: item.postalCode });
const fromApi = (item: ApiLocation): LocatedAddress => ({ name: item.name, addressLine1: item.address_line_1, city: item.city, state: item.state, postalCode: item.postal_code, latitude: item.latitude, longitude: item.longitude });
const distanceKm = (from: Coordinates | undefined, to: LocatedAddress) => {
  if (!from) return Number.POSITIVE_INFINITY;
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(value));
};
const distanceLabel = (from: Coordinates | undefined, to: LocatedAddress) => {
  const distance = distanceKm(from, to);
  if (!Number.isFinite(distance)) return undefined;
  return distance < .005 ? "0.00km" : `${Number(distance.toFixed(2))}km`;
};

export function DeliveryAddressSearchScreen() {
  const insets = useSafeAreaInsets();
  const { current, mode } = useLocalSearchParams<{ current?: string; mode?: string }>();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [query, setQuery] = useState(getMarketplaceLocationDraft().addressLine1);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<LocatedAddress[]>([]);
  const [showingNearby, setShowingNearby] = useState(false);
  const [currentCoordinates, setCurrentCoordinates] = useState<Coordinates>();
  const [error, setError] = useState<string>();
  const autoLocated = useRef(false);
  const suggestionRequest = useRef(0);
  const continueWith = (result: LocatedAddress) => { updateMarketplaceLocationDraft(result); router.push("/marketplace/delivery/form"); };
  const selectForDelivery = async (result: LocatedAddress) => {
    const location: MarketplaceTemporaryLocation = { name: result.name, address_line_1: result.addressLine1, city: result.city, state: result.state, postal_code: result.postalCode, latitude: result.latitude, longitude: result.longitude };
    chooseMarketplaceTemporaryLocation(location);
    let recent: MarketplaceTemporaryLocation[] = [];
    try {
      const stored = await AsyncStorage.getItem(MARKETPLACE_RECENT_LOCATIONS_KEY);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) recent = parsed.filter((item): item is MarketplaceTemporaryLocation => !!item && typeof item.address_line_1 === "string" && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    } catch { recent = []; }
    const next = [location, ...recent.filter((item) => Math.abs(item.latitude - location.latitude) > .00001 || Math.abs(item.longitude - location.longitude) > .00001)].slice(0, 10);
    await AsyncStorage.setItem(MARKETPLACE_RECENT_LOCATIONS_KEY, JSON.stringify(next)).catch(() => undefined);
    router.dismissTo("/(tabs)/marketplace");
  };
  const chooseResult = (result: LocatedAddress) => mode === "select" ? void selectForDelivery(result) : continueWith(result);
  const useCurrent = async () => {
    setBusy(true); setError(undefined);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Location permission is required to use your current location.");
      if (!(await Location.hasServicesEnabledAsync())) throw new Error("Turn on Location Services, then try again.");
      const position = await getPreciseMarketplacePosition();
      if (position.mocked) throw new Error("Your device is reporting a simulated location. Turn off mock location and try again.");
      setCurrentCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      const result = await api.getNearbyMarketplaceLocations<ApiLocationList>(position.coords.latitude, position.coords.longitude);
      if (!result.locations.length) throw new Error("No nearby delivery locations were found. Try searching for your address instead.");
      const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      const nearbyLocations = result.locations.map(fromApi).sort((first, second) => distanceKm(coordinates, first) - distanceKm(coordinates, second));
      setQuery(locationLabel(nearbyLocations[0]));
      setSuggestions(nearbyLocations);
      setShowingNearby(true);
    }
    catch (next) { setError(next instanceof Error ? next.message : "Your current location could not be retrieved."); }
    finally { setBusy(false); }
  };
  const search = async () => {
    if (!query.trim()) return;
    setBusy(true); setError(undefined);
    try { const result = await api.autocompleteMarketplaceLocation<ApiLocationList>(query.trim()); if (!result.locations.length) throw new Error("No verified location matched that address. Try including the city and postcode."); chooseResult(fromApi(result.locations[0])); }
    catch (next) { setError(next instanceof Error ? next.message : "That address could not be verified."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    const searchText = query.trim();
    const requestId = ++suggestionRequest.current;
    if (showingNearby) { setSuggesting(false); return; }
    if (searchText.length < 3) { if (!showingNearby) setSuggestions([]); setSuggesting(false); return; }
    const timer = setTimeout(() => {
      setSuggesting(true);
      void api.autocompleteMarketplaceLocation<ApiLocationList>(searchText).then((result) => {
        if (suggestionRequest.current !== requestId) return;
        const unique = new Map<string, LocatedAddress>();
        result.locations.map(fromApi).forEach((item) => unique.set(locationLabel(item), item));
        setSuggestions([...unique.values()]);
      }).catch(() => { if (suggestionRequest.current === requestId) setSuggestions([]); }).finally(() => { if (suggestionRequest.current === requestId) setSuggesting(false); });
    }, 450);
    return () => clearTimeout(timer);
  }, [api, query, showingNearby]);
  useEffect(() => { if (current === "1" && !autoLocated.current) { autoLocated.current = true; void useCurrent(); } }, [current]);
  return <View style={base.root}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[base.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 28 }]}><Header title="Search locations" onBack={() => router.back()}/><View style={base.search}><Ionicons name="search-outline" size={20} color={colors.textMuted}/><TextInput autoFocus value={query} onChangeText={(value) => { setQuery(value); setShowingNearby(false); setError(undefined); }} onSubmitEditing={() => void search()} returnKeyType="search" style={base.searchInput} placeholder="Street, building, city or postcode" placeholderTextColor={colors.textSubtle}/>{busy || suggesting ? <ActivityIndicator size="small" color={colors.primary}/> : null}</View><Pressable style={base.row} onPress={() => void useCurrent()}><View style={[base.rowIcon, styles.resultIcon]}><Ionicons name="navigate" size={20} color={colors.textMuted}/></View><View style={base.flex}><Text style={base.rowTitle}>Current location</Text><Text style={base.rowSubtitle}>Find nearby delivery locations using GPS</Text></View></Pressable>{suggestions.length ? <View style={styles.results}><Text style={styles.resultsLabel}>{showingNearby ? "LOCATIONS NEAR YOU" : "SUGGESTED LOCATIONS"}</Text>{suggestions.map((item) => <Pressable key={`${item.latitude}-${item.longitude}`} style={base.row} onPress={() => chooseResult(item)}><View style={[base.rowIcon, styles.resultIcon]}><Ionicons name="location-outline" size={20} color={colors.textMuted}/></View><View style={base.flex}><Text style={base.rowTitle}>{item.name ?? item.addressLine1}</Text><Text style={base.rowSubtitle} numberOfLines={2}>{[showingNearby ? distanceLabel(currentCoordinates, item) : undefined, locationDetails(item)].filter(Boolean).join(" · ")}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textSubtle}/></Pressable>)}</View> : query.trim().length >= 3 && !suggesting ? <Pressable style={base.row} onPress={() => void search()}><View style={[base.rowIcon, styles.resultIcon]}><Ionicons name="search" size={20} color={colors.textMuted}/></View><View style={base.flex}><Text style={base.rowTitle}>Search this address</Text><Text style={base.rowSubtitle} numberOfLines={2}>{query.trim()}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textSubtle}/></Pressable> : showingNearby ? <Text style={styles.hint}>Choose the closest reachable delivery location.</Text> : null}{error ? <Text style={base.error}>{error}</Text> : null}</ScrollView></View>;
}
const styles = StyleSheet.create({ results: { marginTop: 6 }, resultsLabel: { paddingTop: 12, paddingBottom: 4, color: colors.textMuted, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.black, letterSpacing: .7 }, resultIcon: { backgroundColor: colors.surfaceMuted }, hint: { paddingVertical: 22, color: colors.textMuted, fontSize: typography.mobile.rawSize.s11, lineHeight: 17, textAlign: "center" } });
