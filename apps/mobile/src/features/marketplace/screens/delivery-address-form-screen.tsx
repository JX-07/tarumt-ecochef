import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, typography } from "@ecochef/design-tokens";
import type { Address } from "@ecochef/contracts";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { clearMarketplaceLocationDraft, getMarketplaceEditingAddressId, getMarketplaceLocationDraft, updateMarketplaceLocationDraft, type MarketplaceLocationDraft } from "../delivery-preferences";
import { locationTypes } from "../location-types";
import { Header, base } from "./delivery-address-screen";
import { formatMarketplaceAddress } from "../location-format";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

type ApiLocation = { address_line_1: string; city: string; state: string; postal_code: string; latitude: number; longitude: number };
type MapCoordinates = { latitude: number; longitude: number };
const MAP_IMAGE_SIZE = 3000;
const MAP_OVERSCAN = 4.5;
// Geoapify's static-map zoom follows the standard 256 px slippy-map world.
// The source image is enlarged separately so the visible zoom remains fixed.
const MAP_TILE_SIZE = 256;
const MAP_ZOOM = 17;
const MAX_MAP_DRAG = 500;
const clampMapDrag = (value: number) => Math.max(-MAX_MAP_DRAG, Math.min(MAX_MAP_DRAG, value));
const shiftedCoordinates = (latitude: number, longitude: number, dx: number, dy: number, width: number) => {
  const world = MAP_TILE_SIZE * 2 ** MAP_ZOOM;
  const scale = MAP_IMAGE_SIZE / (Math.max(width, 1) * MAP_OVERSCAN);
  const x = (longitude + 180) / 360 * world - dx * scale;
  const safeLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sinLatitude = Math.sin(safeLatitude * Math.PI / 180);
  const y = (.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * world - dy * scale;
  const nextLongitude = x / world * 360 - 180;
  const mercator = Math.PI - 2 * Math.PI * y / world;
  const nextLatitude = 180 / Math.PI * Math.atan(.5 * (Math.exp(mercator) - Math.exp(-mercator)));
  return {
    latitude: Math.max(-85.05112878, Math.min(85.05112878, nextLatitude)),
    longitude: ((nextLongitude + 540) % 360) - 180,
  };
};
export function DeliveryAddressFormScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const editingAddressId = getMarketplaceEditingAddressId();
  const [draft, setDraft] = useState(getMarketplaceLocationDraft());
  const [saving, setSaving] = useState(false);
  const [mapUri, setMapUri] = useState<string>();
  const [mapFailed, setMapFailed] = useState(false);
  const [mapWidth, setMapWidth] = useState(1);
  const [mapCenter, setMapCenter] = useState<MapCoordinates | undefined>(() => Number.isFinite(draft.latitude) && Number.isFinite(draft.longitude) ? { latitude: draft.latitude as number, longitude: draft.longitude as number } : undefined);
  const [pendingCoordinates, setPendingCoordinates] = useState<MapCoordinates>();
  const [pinOffset, setPinOffset] = useState({ x: 0, y: 0 });
  const [adjustingMap, setAdjustingMap] = useState(false);
  const [error, setError] = useState<string>();
  const mapPan = useRef(new Animated.ValueXY()).current;
  const update = (change: Partial<MarketplaceLocationDraft>) => { const next = { ...draft, ...change }; setDraft(next); updateMarketplaceLocationDraft(change); };
  const save = async () => { if (!draft.label.trim() || !draft.addressLine1.trim()) { setError("Complete the required Name and Address fields."); return; } if (draft.label.trim().length > 50 || draft.addressLine1.length > 255 || draft.details.trim().length > 255 || draft.driverNote.trim().length > 280) { setError("Name, address, address details, or driver note is too long."); return; } setSaving(true); setError(undefined); try { const body = { label: draft.label.trim(), address_type: draft.addressType, address_line_1: draft.addressLine1, address_line_2: draft.details.trim() || undefined, city: draft.city.slice(0, 50), state: draft.state.slice(0, 50), postal_code: draft.postalCode.slice(0, 20), delivery_note: draft.driverNote.trim() || undefined, latitude: draft.latitude, longitude: draft.longitude }; if (editingAddressId) await api.updateMyAddress<Address>(editingAddressId, body); else await api.addMyAddress<Address>(body); clearMarketplaceLocationDraft(); router.dismissTo("/marketplace/delivery"); } catch (next) { setError(next instanceof Error ? next.message : "This location could not be saved."); } finally { setSaving(false); } };
  const fullAddress = formatMarketplaceAddress({ address_line_1: draft.addressLine1, city: draft.city, state: draft.state, postal_code: draft.postalCode });
  const hasCoordinates = !!mapCenter;
  const previewMapAdjustment = (x: number, y: number) => {
    if (!mapCenter || Math.hypot(x, y) < 3) return;
    const coordinates = shiftedCoordinates(mapCenter.latitude, mapCenter.longitude, x, y, mapWidth);
    setPendingCoordinates(coordinates);
  };
  const applyMapAddress = async () => {
    if (!pendingCoordinates) return;
    setAdjustingMap(true); setError(undefined);
    try {
      const confirmedCoordinates = pendingCoordinates;
      const [result, refreshedMap] = await Promise.all([
        api.reverseMarketplaceLocation<ApiLocation>(confirmedCoordinates.latitude, confirmedCoordinates.longitude),
        api.getMarketplaceLocationMap<{ data_uri: string }>(confirmedCoordinates.latitude, confirmedCoordinates.longitude),
      ]);
      update({ addressLine1: result.address_line_1, city: result.city, state: result.state, postalCode: result.postal_code, latitude: confirmedCoordinates.latitude, longitude: confirmedCoordinates.longitude });
      setMapFailed(false);
      setMapUri(refreshedMap.data_uri);
      setMapCenter(confirmedCoordinates);
      setPinOffset({ x: 0, y: 0 });
      mapPan.setValue({ x: 0, y: 0 });
      setPendingCoordinates(undefined);
    } catch (next) { setError(next instanceof Error ? next.message : "The adjusted map location could not be verified."); }
    finally { setAdjustingMap(false); }
  };
  const mapPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => !!mapUri && Math.hypot(gesture.dx, gesture.dy) > 3,
    onPanResponderMove: (_, gesture) => mapPan.setValue({ x: clampMapDrag(pinOffset.x + gesture.dx), y: clampMapDrag(pinOffset.y + gesture.dy) }),
    onPanResponderRelease: (_, gesture) => { const next = { x: clampMapDrag(pinOffset.x + gesture.dx), y: clampMapDrag(pinOffset.y + gesture.dy) }; mapPan.setValue(next); setPinOffset(next); previewMapAdjustment(next.x, next.y); },
    onPanResponderTerminate: () => mapPan.setValue(pinOffset),
  }), [mapUri, mapPan, mapCenter, mapWidth, pinOffset]);
  useEffect(() => {
    if (!hasCoordinates) return;
    let active = true;
    setMapFailed(false);
    void api.getMarketplaceLocationMap<{ data_uri: string }>(mapCenter.latitude, mapCenter.longitude).then((result) => { if (active) setMapUri(result.data_uri); }).catch(() => { if (active) setMapFailed(true); });
    return () => { active = false; };
  }, [api, mapCenter, hasCoordinates]);
  return <KeyboardAvoidingView style={base.root} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[base.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 28 }]}><Header title={editingAddressId ? "Edit location" : "Save location"} onBack={() => router.back()}/><Text style={styles.mapHint}>Drag the map, then confirm the centre pin</Text><View style={styles.mapCard} onLayout={(event) => setMapWidth(event.nativeEvent.layout.width)} {...mapPanResponder.panHandlers}>{mapUri ? <Animated.Image source={{ uri: mapUri }} style={[styles.map, { transform: mapPan.getTranslateTransform() }]} resizeMode="cover"/> : <View style={styles.mapFallback}>{!mapFailed && hasCoordinates ? <ActivityIndicator color={colors.primary}/> : <Ionicons name="map-outline" size={27} color={colors.textMuted}/>}<Text style={styles.mapFallbackText}>{mapFailed ? "Map preview could not be loaded" : hasCoordinates ? "Loading map…" : "Map location unavailable"}</Text></View>}<View pointerEvents="none" style={styles.centerPin}><Ionicons name="location" size={34} color={colors.primaryStrong}/></View>{adjustingMap ? <View pointerEvents="none" style={styles.mapBusy}><ActivityIndicator color={colors.primary}/></View> : null}</View>{pendingCoordinates ? <Pressable disabled={adjustingMap} style={({ pressed }) => [styles.changeAddressButton, pressed && styles.changeAddressPressed]} onPress={() => void applyMapAddress()}>{adjustingMap ? <ActivityIndicator size="small" color={colors.surface}/> : <Ionicons name="checkmark-circle-outline" size={19} color={colors.surface}/>}<Text style={styles.changeAddressText}>{adjustingMap ? "Updating address…" : "Change address"}</Text></Pressable> : null}<View style={styles.mapAddressField}><Text style={styles.fieldLabel}>Address *</Text><Pressable style={styles.addressField} onPress={() => editingAddressId ? router.push("/marketplace/delivery/search" as never) : router.back()}><Text style={styles.addressValue}>{fullAddress}</Text><Ionicons name="chevron-back" size={17} color={colors.primaryStrong}/><Text style={styles.change}>Change</Text></Pressable></View><Text style={styles.sectionLabel}>LOCATION TYPE</Text><View style={styles.types}>{locationTypes.map((item) => { const active = draft.addressType === item.value; return <Pressable key={item.value} style={[styles.type, active && { borderColor: item.color, backgroundColor: item.background }]} onPress={() => update({ addressType: item.value })}><Ionicons name={item.icon} size={18} color={active ? item.color : colors.textMuted}/><Text style={[styles.typeText, active && { color: item.color }]}>{item.label}</Text></Pressable>; })}</View><Field label="Name *" value={draft.label} onChangeText={(label) => update({ label })} placeholder="e.g. Mum's place"/><Field label="Additional address details" value={draft.details} onChangeText={(details) => update({ details })} placeholder="Floor, unit number, entrance"/><Field label="Note to driver" value={draft.driverNote} onChangeText={(driverNote) => update({ driverNote })} placeholder="Delivery instructions" multiline/>{error ? <Text style={base.error}>{error}</Text> : null}<Pressable disabled={saving} style={styles.save} onPress={() => void save()}>{saving ? <ActivityIndicator color={colors.surface}/> : <Text style={styles.saveText}>{editingAddressId ? "Save Changes" : "Save Location"}</Text>}</Pressable></ScrollView></KeyboardAvoidingView>;
}
function Field(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean }) { const maxLength = props.label.startsWith("Name") ? 50 : props.label.startsWith("Additional") ? 255 : 280; return <View style={styles.field}><Text style={styles.fieldLabel}>{props.label}</Text><TextInput value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} multiline={props.multiline} maxLength={maxLength} style={[styles.input, props.multiline && styles.multiline]} placeholderTextColor={colors.textSubtle}/></View>; }
const styles = StyleSheet.create({ mapHint: { marginBottom: 7, color: colors.textMuted, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold }, mapCard: { height: 300, overflow: "hidden", marginBottom: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surfaceMuted }, map: { position: "absolute", left: "-175%", top: "-175%", width: "450%", height: "450%" }, mapFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 7 }, mapFallbackText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.extrabold }, centerPin: { position: "absolute", left: "50%", top: "50%", marginLeft: -17, marginTop: -34 }, mapBusy: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceGlass }, changeAddressButton: { height: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 18, borderRadius: 14, backgroundColor: colors.primary }, changeAddressPressed: { opacity: .75 }, changeAddressText: { color: colors.surface, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.black }, sectionLabel: { marginBottom: 8, color: colors.textMuted, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.black, letterSpacing: .6 }, types: { flexDirection: "row", gap: 7 }, type: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.surface }, typeText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s8, fontWeight: typography.weight.black }, field: { marginTop: 13 }, mapAddressField: { marginBottom: 12 }, fieldLabel: { marginBottom: 6, color: colors.textMuted, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.extrabold }, input: { minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.surface, color: colors.text, fontSize: typography.mobile.rawSize.s12 }, multiline: { minHeight: 82, paddingTop: 12, textAlignVertical: "top" }, addressField: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 5, padding: 12, borderWidth: 1, borderColor: colors.primaryBorder, borderRadius: 13, backgroundColor: colors.surface }, addressValue: { flex: 1, color: colors.text, fontSize: typography.mobile.rawSize.s11, lineHeight: 16, fontWeight: typography.weight.bold }, change: { color: colors.primaryStrong, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.black }, save: { height: 50, alignItems: "center", justifyContent: "center", marginTop: 20, borderRadius: 14, backgroundColor: colors.primary }, saveText: { color: colors.surface, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.black } });
