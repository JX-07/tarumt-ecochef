import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, typography } from "@ecochef/design-tokens";
import type { MarketplaceStoreSummary } from "@ecochef/contracts";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { deliveryEstimateLabel } from "../delivery-estimate";

export function StoreCard({ store, onPress }: { store: MarketplaceStoreSummary; onPress: () => void }) {
  const image = store.icon_url ?? store.cover_image_url;
  const usingLogo = !!store.icon_url;
  const closed = !!store.store_closed_today;
  const offer = store.best_promotion?.free_delivery ? "Free delivery" : store.best_promotion?.title;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${store.name}${closed ? ", closed today" : ""}`} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={[styles.visual, closed && styles.closedVisual]}>{image ? usingLogo ? <Image accessibilityLabel={`${store.name} logo`} source={{ uri: image }} resizeMode="cover" style={[styles.logo, closed && styles.closedImage]} /> : <Image accessibilityLabel={`${store.name} photo`} source={{ uri: image }} resizeMode="cover" style={[styles.image, closed && styles.closedImage]} /> : <View style={styles.fallback}><Ionicons name="storefront-outline" size={40} color={closed ? colors.textSubtle : colors.primaryStrong} /></View>}
      {closed ? <View pointerEvents="none" style={styles.closedOverlay} /> : null}
    </View>
    <View style={styles.body}>
      {closed ? <Text style={styles.closedLabel}>CLOSED</Text> : store.best_promotion ? <Text style={styles.promoLabel}>PROMO</Text> : null}
      <Text style={styles.name} numberOfLines={1}>{store.name}</Text>
      <Text style={styles.category} numberOfLines={1}>{store.category || "Marketplace store"}</Text>
      <View style={styles.meta}>
        {store.distance_km != null ? <View style={styles.metaItem}><Ionicons name="location" size={14} color={colors.danger} /><Text style={styles.metaText}>{store.distance_km} km</Text></View> : null}
        <View style={styles.metaItem}><Ionicons name="star" size={14} color={colors.ratingStar} /><Text style={styles.metaText}>{Number(store.rating).toFixed(1)} ({store.review_count})</Text></View>
        {store.estimated_delivery_minutes != null ? <View style={styles.metaItem}><Ionicons name="bicycle" size={15} color={colors.primary} /><Text style={styles.metaText}>{deliveryEstimateLabel(store.estimated_delivery_minutes)}</Text></View> : null}
      </View>
      {offer ? <Text style={styles.offer} numberOfLines={1}>{offer}</Text> : null}
    </View>
  </Pressable>;
}
const styles = StyleSheet.create({
  card: { minHeight: 148, flexDirection: "row", gap: 14, marginBottom: 12, padding: 12, overflow: "hidden", borderRadius: 16, backgroundColor: colors.surface, elevation: 2 }, pressed: { opacity: .72 },
  visual: { width: 118, height: 118, overflow: "hidden", borderRadius: 13, backgroundColor: colors.primarySoft }, image: { width: "100%", height: "100%" }, logo: { width: "100%", height: "100%", transform: [{ scale: 1.12 }] }, fallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  closedVisual: { backgroundColor: colors.surfaceMuted }, closedImage: { opacity: .35 }, closedOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.surfaceMuted, opacity: .45 }, closedLabel: { marginBottom: 2, color: colors.danger, fontSize: typography.mobile.size.caption, fontWeight: typography.weight.bold },
  body: { flex: 1, justifyContent: "center", minWidth: 0 }, promoLabel: { marginBottom: 2, color: colors.danger, fontSize: typography.mobile.size.caption, fontWeight: typography.weight.bold },
  name: { color: colors.text, fontSize: typography.mobile.size.bodyTextHeavy, lineHeight: 22, fontWeight: typography.weight.bold }, category: { marginTop: 2, color: colors.textSubtle, fontSize: typography.mobile.size.caption },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 8, rowGap: 3, marginTop: 7 }, metaItem: { flexDirection: "row", alignItems: "center", gap: 3 }, metaText: { color: colors.textMuted, fontSize: typography.mobile.size.caption },
  offer: { marginTop: 7, color: colors.primary, fontSize: typography.mobile.size.secondaryInteraction, fontWeight: typography.weight.bold },
});
