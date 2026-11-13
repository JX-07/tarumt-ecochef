import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { ConsumerProfile, MarketplaceCart, MarketplaceStoreList } from "@ecochef/contracts";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiBaseUrl } from "../../../lib/api-url";
import { createMobileApi } from "../../../lib/api";
import { Text } from "../../../shared/components/themed-text";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { useAuth } from "../../auth/auth-provider";
import { releaseMarketplaceCartNavigation } from "../cart-navigation";
import {
  consumeMarketplaceAddress,
  getMarketplaceTemporaryLocation,
} from "../delivery-preferences";
import { marketplaceImageUrl } from "../marketplace-image";

type ShopCart = {
  id: string;
  name: string;
  items: MarketplaceCart["items"];
  distance?: number;
  closed: boolean;
};

export function ShopCartsScreen() {
  const params = useLocalSearchParams<{ addressId?: string; returnTo?: string; date?: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [shops, setShops] = useState<ShopCart[]>([]);
  const [addressId, setAddressId] = useState(params.addressId);
  const addressRef = useRef(addressId);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<string[]>();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(
    async (refresh = false) => {
      releaseMarketplaceCartNavigation();
      if (refresh) setRefreshing(true);
      setError(undefined);
      try {
        const profile = await api.getMyConsumerProfile<ConsumerProfile>();
        const temporary = getMarketplaceTemporaryLocation();
        const destination = temporary
          ? undefined
          : (consumeMarketplaceAddress() ??
            addressRef.current ??
            profile.addresses.find((a) => a.is_default)?.id ??
            profile.addresses[0]?.id);
        addressRef.current = destination;
        setAddressId(destination);
        const [cart, storeList] = await Promise.all([
          api.getMarketplaceCart<MarketplaceCart>(destination, temporary),
          api.getMarketplaceStores<MarketplaceStoreList>("", destination, temporary),
        ]);
        const groups = new Map<string, MarketplaceCart["items"]>();
        for (const item of cart.items)
          groups.set(item.product.store_id, [...(groups.get(item.product.store_id) ?? []), item]);
        const entries = [...groups].map(([id, items]) => {
          const store = storeList.stores.find((store) => store.id === id);
          return {
            id,
            name: store?.name ?? items[0].store_name,
            items,
            distance: store?.distance_km,
            closed: store?.store_closed_today ?? !!items[0].product.store_closed_today,
          };
        });
        setShops(entries);
        setSelected((current) => current.filter((id) => groups.has(id)));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Your carts could not be loaded.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  const remove = async () => {
    if (!confirmation?.length || removing) return;
    setRemoving(true);
    setError(undefined);
    try {
      await api.removeMarketplaceShopCarts<MarketplaceCart>(confirmation);
      setShops((current) => current.filter((shop) => !confirmation.includes(shop.id)));
      setSelected((current) => current.filter((id) => !confirmation.includes(id)));
      setConfirmation(undefined);
    } catch (reason) {
      setConfirmation(undefined);
      setError(reason instanceof Error ? reason.message : "The carts could not be removed.");
    } finally {
      setRemoving(false);
    }
  };
  const allSelected = shops.length > 0 && selected.length === shops.length;
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Ionicons name="chevron-back" size={spacing[6]} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Carts</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setManaging(!managing);
            setSelected([]);
          }}
          disabled={!shops.length || removing}
        >
          <Text style={styles.manage}>{managing ? "Done" : "Manage"}</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.primary}
          />
        }
      >
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : !shops.length ? (
          <View style={styles.empty}>
            <Ionicons name="cart-outline" size={spacing[12]} color={colors.primaryStrong} />
            <Text style={styles.emptyTitle}>Your carts are empty</Text>
            <Text style={styles.secondary}>Add food from a shop to start a cart.</Text>
          </View>
        ) : (
          shops.map((shop) => (
            <ShopCartCard
              key={shop.id}
              shop={shop}
              managing={managing}
              selected={selected.includes(shop.id)}
              onToggle={() => toggle(shop.id)}
              onDelete={() => setConfirmation([shop.id])}
              onOpen={() =>
                router.push({
                  pathname: "/marketplace/cart",
                  params: { ...params, addressId, storeId: shop.id },
                } as never)
              }
            />
          ))
        )}
      </ScrollView>
      {managing && shops.length ? (
        <View style={[styles.toolbar, { paddingBottom: insets.bottom + spacing[4] }]}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allSelected }}
            onPress={() => setSelected(allSelected ? [] : shops.map((shop) => shop.id))}
            style={styles.selectAll}
          >
            <Ionicons
              name={allSelected ? "checkbox" : "square-outline"}
              size={spacing[6]}
              color={colors.primaryStrong}
            />
            <Text style={styles.manage}>Select all</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!selected.length || removing}
            style={[styles.removeButton, !selected.length && styles.disabled]}
            onPress={() => setConfirmation(selected)}
          >
            <Text style={styles.whiteText}>Remove ({selected.length})</Text>
          </Pressable>
        </View>
      ) : null}
      <Modal
        visible={!!confirmation}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!removing) setConfirmation(undefined);
        }}
      >
        <View style={styles.overlay}>
          <View style={styles.confirmCard}>
            <View style={styles.dangerIcon}>
              <Ionicons name="trash-outline" size={spacing[6] + spacing[1]} color={colors.danger} />
            </View>
            <Text style={styles.emptyTitle}>
              Remove {confirmation?.length === 1 ? "this cart" : "these carts"}?
            </Text>
            <Text style={styles.confirmCopy}>
              All items from{" "}
              {confirmation?.length === 1
                ? (shops.find((shop) => shop.id === confirmation[0])?.name ?? "this shop")
                : `these ${confirmation?.length ?? 0} shops`}{" "}
              will be removed from your carts.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={removing}
                onPress={() => setConfirmation(undefined)}
                style={styles.cancelButton}
              >
                <Text style={styles.manage}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={removing}
                onPress={() => void remove()}
                style={styles.removeButton}
              >
                <Text style={styles.whiteText}>{removing ? "Removing…" : "Remove"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ShopCartCard({
  shop,
  managing,
  selected,
  onToggle,
  onDelete,
  onOpen,
}: {
  shop: ShopCart;
  managing: boolean;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  const close = () => {
    offset.current = 0;
    Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          !managing && Math.abs(g.dx) > spacing[2] && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_, g) =>
          x.setValue(Math.max(-(spacing[16] + spacing[4]), Math.min(0, offset.current + g.dx))),
        onPanResponderRelease: (_, g) => {
          offset.current = offset.current + g.dx < -spacing[8] ? -(spacing[16] + spacing[4]) : 0;
          Animated.spring(x, { toValue: offset.current, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: close,
      }),
    [managing, x],
  );
  const count = shop.items.reduce((sum, item) => sum + item.product.cart_quantity, 0);
  return (
    <View style={styles.cardClip}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete ${shop.name} cart`}
        onPress={onDelete}
        style={styles.delete}
      >
        <Ionicons name="trash-outline" size={spacing[6]} color={colors.surface} />
        <Text style={styles.whiteText}>Delete</Text>
      </Pressable>
      <Animated.View
        {...(!managing ? pan.panHandlers : {})}
        style={{ transform: [{ translateX: managing ? 0 : x }] }}
      >
        <Pressable
          accessibilityRole={managing ? "checkbox" : "button"}
          accessibilityState={managing ? { checked: selected } : undefined}
          accessibilityLabel={`${shop.name}, ${count} items, ${shop.closed ? "Closed" : "Open"}`}
          onPress={
            managing
              ? onToggle
              : () => {
                  if (offset.current) close();
                  else onOpen();
                }
          }
          style={[styles.card, selected && styles.selectedCard]}
        >
          {managing ? (
            <Ionicons
              name={selected ? "checkbox" : "square-outline"}
              size={spacing[6]}
              color={colors.primaryStrong}
            />
          ) : null}
          <View style={styles.foodImages}>
            {shop.items.slice(0, 3).map((item, index) => (
              <FoodImage key={item.product.id} uri={item.product.image_url} index={index} />
            ))}
          </View>
          <View style={styles.cardBody}>
            <Text numberOfLines={1} style={styles.shopName}>
              {shop.name}
            </Text>
            <Text style={styles.secondary}>
              {count} {count === 1 ? "item" : "items"} in cart
            </Text>
            <Text style={styles.secondary}>
              {shop.distance == null
                ? "Distance unavailable"
                : `${shop.distance.toFixed(1)} km from selected location`}
            </Text>
            <Text style={[styles.status, { color: shop.closed ? colors.danger : colors.success }]}>
              {shop.closed ? "Closed" : "Open"}
            </Text>
          </View>
          {!managing ? (
            <Ionicons name="chevron-forward" size={spacing[5]} color={colors.textSubtle} />
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

function FoodImage({ uri, index }: { uri?: string; index: number }) {
  const [failed, setFailed] = useState(false);
  const image = marketplaceImageUrl(uri, apiBaseUrl);
  return image && !failed ? (
    <Image
      source={{ uri: image }}
      onError={() => setFailed(true)}
      style={[styles.foodImage, { left: index * spacing[3], top: index * spacing[2] }]}
    />
  ) : (
    <View
      style={[
        styles.foodImage,
        styles.imageFallback,
        { left: index * spacing[3], top: index * spacing[2] },
      ]}
    >
      <Ionicons name="restaurant-outline" size={spacing[5]} color={colors.primaryStrong} />
    </View>
  );
}

const size = typography.mobile.size;
const weight = typography.weight;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[5],
  },
  iconButton: { padding: spacing[2] },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: size.pageTitle,
    lineHeight: 38,
    fontWeight: weight.bold,
  },
  manage: {
    color: colors.primaryStrong,
    fontSize: size.bodyInteraction,
    fontWeight: weight.semibold,
  },
  content: { padding: spacing[5], gap: spacing[4], paddingBottom: spacing[8] },
  cardClip: { overflow: "hidden", borderRadius: spacing[4], backgroundColor: colors.danger },
  delete: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: spacing[16] + spacing[4],
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: spacing[16] * 2 + spacing[4],
    padding: spacing[4],
    borderRadius: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selectedCard: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  foodImages: { width: spacing[16] + spacing[10], height: spacing[16] + spacing[10] },
  foodImage: {
    position: "absolute",
    width: spacing[16] + spacing[2],
    height: spacing[16] + spacing[2],
    borderRadius: spacing[3],
    borderWidth: 2,
    borderColor: colors.surface,
  },
  imageFallback: {
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, gap: spacing[1] },
  shopName: {
    color: colors.text,
    fontSize: size.bodyTextHeavy,
    lineHeight: spacing[6],
    fontWeight: weight.bold,
  },
  secondary: {
    color: colors.textMuted,
    fontSize: size.secondaryInteraction,
    lineHeight: spacing[5],
  },
  status: { fontSize: size.secondaryInteraction, lineHeight: spacing[5], fontWeight: weight.bold },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing[5],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  selectAll: {
    minHeight: spacing[12],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  removeButton: {
    alignItems: "center",
    minHeight: spacing[12],
    justifyContent: "center",
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: spacing[3],
    backgroundColor: colors.danger,
  },
  disabled: { opacity: 0.4 },
  whiteText: {
    color: colors.surface,
    fontSize: size.secondaryInteraction,
    fontWeight: weight.bold,
  },
  empty: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[16] },
  emptyTitle: {
    color: colors.text,
    fontSize: size.bodyTextHeavy,
    fontWeight: weight.bold,
    textAlign: "center",
  },
  error: { color: colors.danger, fontSize: size.bodyInteraction },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[6],
    backgroundColor: colors.overlay,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: spacing[6],
    padding: spacing[6],
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: spacing[4],
  },
  dangerIcon: {
    padding: spacing[4],
    borderRadius: spacing[10],
    backgroundColor: colors.dangerSoft,
  },
  confirmCopy: { color: colors.textMuted, fontSize: size.bodyInteraction, textAlign: "center" },
  confirmActions: { flexDirection: "row", gap: spacing[3] },
  cancelButton: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: spacing[3],
    backgroundColor: colors.surfaceMuted,
  },
});
