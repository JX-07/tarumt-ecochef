import { apiBaseUrl } from "../../../lib/api-url";
import { AppMessageModal } from "../../../shared/components/app-message-modal";
import { ContentReportSheet } from "../../../shared/components/content-report-sheet";
import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplaceStoreDetail } from "@ecochef/contracts";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createMobileApi } from "../../../lib/api";
import { useAuth } from "../../auth/auth-provider";
import { useBottomSlidePageExit } from "../bottom-slide-page";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const parameter = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

export function StoreInformationScreen() {
  const params = useLocalSearchParams<{ storeId?: string | string[] }>();
  const storeId = parameter(params.storeId);
  const insets = useSafeAreaInsets();
  const { close, animatedStyle } = useBottomSlidePageExit(
    storeId ? `/marketplace/${storeId}` : undefined,
  );
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [store, setStore] = useState<MarketplaceStoreDetail>();
  const [failedLogoUri, setFailedLogoUri] = useState<string>();
  const [mapUri, setMapUri] = useState<string>();
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [mapError, setMapError] = useState<{ title: string; message: string }>();
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      if (!storeId) return;
      setFailedLogoUri(undefined);
      setMapUri(undefined);
      setError(undefined);
      let active = true;
      void api
        .getMarketplaceStore<MarketplaceStoreDetail>(storeId)
        .then((result) => {
          if (!active) return;
          setStore(result);
          if (result.latitude == null || result.longitude == null) return;
          void api
            .getMarketplaceLocationMap<{ data_uri: string }>(result.latitude, result.longitude)
            .then((map) => {
              if (active) setMapUri(map.data_uri);
            })
            .catch(() => undefined);
        })
        .catch((reason) => {
          if (active)
            setError(
              reason instanceof Error ? reason.message : "Shop information could not be loaded.",
            );
        });
      return () => {
        active = false;
      };
    }, [api, storeId]),
  );

  const openDirections = () => {
    if (store) setDirectionsOpen(true);
  };
  const openMap = async (provider: "google" | "waze") => {
    if (!store) return;
    const hasCoordinates =
      Number.isFinite(store.latitude) &&
      Number.isFinite(store.longitude) &&
      Math.abs(store.latitude as number) <= 90 &&
      Math.abs(store.longitude as number) <= 180;
    const coordinates = hasCoordinates ? `${store.latitude},${store.longitude}` : undefined;
    const destination = encodeURIComponent(coordinates ?? store.address);
    const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    const wazeUrl = coordinates
      ? `https://waze.com/ul?ll=${destination}&navigate=yes`
      : `https://waze.com/ul?q=${encodeURIComponent(store.address)}&navigate=yes`;
    setDirectionsOpen(false);
    try {
      await Linking.openURL(provider === "google" ? googleUrl : wazeUrl);
    } catch {
      setMapError({
        title: "Could not open maps",
        message: "Please try again or long-press the address to copy it.",
      });
    }
  };

  const copyAddress = async () => {
    if (!store) return;
    try {
      await Clipboard.setStringAsync(store.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setMapError({ title: "Could not copy address", message: "Please try again." });
    }
  };

  if (!store && !error)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  return (
    <Animated.View style={[styles.root, animatedStyle]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing[4], paddingBottom: insets.bottom + spacing[8] },
        ]}
      >
        <SheetHeader
          title="Shop information"
          onClose={close}
          onReport={store ? () => setReportOpen(true) : undefined}
        />
        {error || !store ? (
          <Text style={styles.error}>{error ?? "Shop information is unavailable."}</Text>
        ) : (
          <>
            <View style={styles.intro}>
              <View
                style={[
                  styles.shopIcon,
                  !!store.icon_url && store.icon_url !== failedLogoUri && styles.logoContainer,
                ]}
              >
                {store.icon_url?.trim() && store.icon_url !== failedLogoUri ? (
                  <Image
                    accessibilityLabel={`${store.name} logo`}
                    source={{ uri: store.icon_url }}
                    resizeMode="contain"
                    style={styles.shopLogo}
                    onError={() => setFailedLogoUri(store.icon_url ?? undefined)}
                  />
                ) : (
                  <Ionicons
                    name="storefront-outline"
                    size={spacing[8]}
                    color={colors.primaryStrong}
                  />
                )}
              </View>
              <View style={styles.introCopy}>
                <Text style={styles.name}>{store.name}</Text>
                <Text style={styles.type}>{store.category || "Local shop"}</Text>
              </View>
            </View>
            <Section title="About">
              <Text style={styles.body}>
                {store.description?.trim() || "This shop has not added an about section yet."}
              </Text>
            </Section>
            <Section title="Operating hours">
              <View style={styles.hours}>
                {days.map((day) => {
                  const value = store.operating_hours_schedule?.[day];
                  const closed = value?.closed;
                  return (
                    <View key={day} style={styles.hourRow}>
                      <Text style={styles.day}>{day.slice(0, 3)}</Text>
                      <Text style={[styles.hour, closed && styles.closed]}>
                        {value
                          ? closed
                            ? "Closed"
                            : `${formatTime(String(value.open))} – ${formatTime(String(value.close))}`
                          : "Not listed"}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {store.operating_hours &&
              !Object.keys(store.operating_hours_schedule ?? {}).length ? (
                <Text style={styles.body}>{store.operating_hours}</Text>
              ) : null}
            </Section>
            <Section title="Store address">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Get directions to this shop"
                accessibilityHint="Tap to choose Google Maps or Waze. Long press to copy the address."
                onPress={openDirections}
                onLongPress={() => void copyAddress()}
                style={({ pressed }) => [styles.addressCard, pressed && styles.pressed]}
              >
                <View style={styles.addressCopy}>
                  <View style={styles.addressTitle}>
                    <Ionicons
                      name="location-outline"
                      size={spacing[5]}
                      color={colors.primaryStrong}
                    />
                    <Text style={styles.addressLabel}>Get directions</Text>
                  </View>
                  <Text style={styles.address}>{store.address}</Text>
                  <Text style={styles.copied}>{copied ? "Address copied" : ""}</Text>
                </View>
                <View style={styles.mapWrap}>
                  {mapUri ? (
                    <Image source={{ uri: mapUri }} resizeMode="cover" style={styles.map} />
                  ) : (
                    <View style={styles.mapFallback}>
                      <Ionicons name="map-outline" size={spacing[6]} color={colors.textMuted} />
                    </View>
                  )}
                  <View style={styles.pin}>
                    <Ionicons name="location" size={spacing[5]} color={colors.primaryStrong} />
                  </View>
                </View>
              </Pressable>
            </Section>
          </>
        )}
      </ScrollView>
      <Modal
        visible={directionsOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setDirectionsOpen(false)}
      >
        <View style={styles.directionsOverlay}>
          <Pressable
            accessibilityLabel="Close directions picker"
            onPress={() => setDirectionsOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.directionsCard} accessibilityViewIsModal>
            <View style={styles.directionsHeader}>
              <Text accessibilityRole="header" style={styles.directionsTitle}>
                Get directions
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close directions picker"
                hitSlop={spacing[2]}
                onPress={() => setDirectionsOpen(false)}
              >
                <Ionicons name="close" size={spacing[6]} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.directionsCopy}>
              Choose a map for directions to {store?.name ?? "this shop"}.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void openMap("google")}
              style={({ pressed }) => [styles.mapOption, pressed && styles.pressed]}
            >
              <Image
                source={require("../../../../assets/map-apps/google-maps.jpg")}
                style={styles.mapAppIcon}
                resizeMode="contain"
                accessible={false}
                accessibilityIgnoresInvertColors
              />
              <Text style={styles.mapOptionText}>Google Maps</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void openMap("waze")}
              style={({ pressed }) => [styles.mapOption, pressed && styles.pressed]}
            >
              <Image
                source={require("../../../../assets/map-apps/waze.png")}
                style={styles.mapAppIcon}
                resizeMode="contain"
                accessible={false}
                accessibilityIgnoresInvertColors
              />
              <Text style={styles.mapOptionText}>Waze</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <AppMessageModal
        visible={!!mapError}
        title={mapError?.title ?? "Directions"}
        message={mapError?.message ?? ""}
        tone="error"
        onClose={() => setMapError(undefined)}
      />
      {store ? (
        <ContentReportSheet
          visible={reportOpen}
          onClose={() => setReportOpen(false)}
          subjectType="store"
          subjectId={store.id}
          subjectName={store.name}
        />
      ) : null}
    </Animated.View>
  );
}

function SheetHeader({
  title,
  onClose,
  onReport,
}: {
  title: string;
  onClose: () => void;
  onReport?: () => void;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={styles.back}
      >
        <Ionicons name="chevron-down" size={spacing[6]} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      {onReport ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Report this shop"
          onPress={onReport}
          style={({ pressed }) => [styles.reportButton, pressed && styles.pressed]}
        >
          <Ionicons name="flag-outline" size={textSize.bodyTextHeavy} color={colors.text} />
        </Pressable>
      ) : (
        <View style={styles.headerSpace} />
      )}
    </View>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function formatTime(value: string) {
  const [hourValue, minute = "00"] = value.split(":");
  const hour = Number(hourValue);
  if (!Number.isFinite(hour)) return value;
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

const textSize = typography.mobile.size;
const textWeight = typography.weight;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  content: { paddingHorizontal: spacing[4] },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.consumerCanvas,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing[6] },
  back: {
    width: spacing[10],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[5],
    backgroundColor: colors.surface,
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: textSize.bodyTextHeavy,
    fontWeight: textWeight.bold,
    textAlign: "center",
  },
  headerSpace: { width: spacing[10] },
  shopLogo: { width: "100%", height: "100%", borderRadius: spacing[4] },
  logoContainer: { overflow: "hidden", backgroundColor: colors.surface },
  directionsOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[5],
    backgroundColor: colors.overlay,
  },
  directionsCard: {
    width: "100%",
    maxWidth: 420,
    padding: spacing[5],
    gap: spacing[3],
    borderRadius: spacing[5],
    backgroundColor: colors.surface,
  },
  directionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  directionsTitle: {
    flex: 1,
    color: colors.text,
    fontSize: textSize.bodyTextHeavy,
    fontWeight: textWeight.bold,
    textAlign: "left",
  },
  directionsCopy: {
    color: colors.textMuted,
    fontSize: textSize.secondaryInteraction,
    lineHeight: spacing[5],
    textAlign: "left",
  },
  mapOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: spacing[3],
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[3],
    backgroundColor: colors.surfaceMuted,
  },
  mapAppIcon: { width: spacing[10], height: spacing[10], borderRadius: spacing[2] },
  mapOptionText: {
    flex: 1,
    textAlign: "left",
    color: colors.text,
    fontSize: textSize.bodyInteraction,
    fontWeight: textWeight.semibold,
  },
  reportButton: {
    width: spacing[10],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[5],
    backgroundColor: colors.surfaceGlass,
  },
  intro: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[5],
    backgroundColor: colors.surface,
  },
  shopIcon: {
    width: spacing[16],
    height: spacing[16],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[4],
    backgroundColor: colors.primarySoft,
  },
  introCopy: { flex: 1 },
  name: { color: colors.text, fontSize: textSize.bodyTextHeavy, fontWeight: textWeight.bold },
  type: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: textSize.caption,
    fontWeight: textWeight.semibold,
  },
  section: {
    marginTop: spacing[4],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[5],
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    marginBottom: spacing[3],
    color: colors.text,
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  body: {
    color: colors.textMuted,
    fontSize: textSize.secondaryInteraction,
    lineHeight: spacing[5],
  },
  hours: { gap: spacing[2] },
  hourRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing[4] },
  day: { color: colors.textMuted, fontSize: textSize.caption, fontWeight: textWeight.semibold },
  hour: { color: colors.text, fontSize: textSize.caption, fontWeight: textWeight.semibold },
  closed: { color: colors.danger },
  addressCard: { flexDirection: "row", alignItems: "stretch", gap: spacing[3] },
  addressCopy: { flex: 1, justifyContent: "center" },
  addressTitle: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  addressLabel: {
    color: colors.primaryStrong,
    fontSize: textSize.caption,
    fontWeight: textWeight.bold,
  },
  address: {
    marginTop: spacing[2],
    color: colors.text,
    fontSize: textSize.secondaryInteraction,
    lineHeight: spacing[5],
    fontWeight: textWeight.semibold,
  },
  copied: {
    minHeight: spacing[4],
    marginTop: spacing[1],
    color: colors.success,
    fontSize: textSize.caption,
    fontWeight: textWeight.bold,
  },
  mapWrap: {
    width: spacing[16] + spacing[12],
    height: spacing[16] + spacing[8],
    overflow: "hidden",
    borderRadius: spacing[4],
    backgroundColor: colors.surfaceMuted,
  },
  map: { width: "100%", height: "100%" },
  mapFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  pin: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -spacing[2],
    marginTop: -spacing[4],
  },
  pressed: { opacity: 0.7 },
  error: { color: colors.danger, fontSize: textSize.secondaryInteraction, textAlign: "center" },
});
