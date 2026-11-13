import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplaceCartItem } from "@ecochef/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { marketplaceImageUrl } from "../marketplace-image";
import { QuantityStepper } from "./quantity-stepper";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

const REVEAL_DISTANCE = spacing[16] + spacing[4];
const DELETE_THRESHOLD = spacing[16];

export function SwipeToDeleteCartItem({
  item,
  busy,
  onQuantity,
  onDelete,
}: {
  item: MarketplaceCartItem;
  busy: boolean;
  onQuantity: (quantity: number) => void;
  onDelete: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [revealed, setRevealed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const animateTo = (value: number, complete?: () => void) =>
    Animated.spring(translateX, {
      toValue: value,
      useNativeDriver: true,
      speed: 24,
      bounciness: 0,
    }).start(({ finished }) => {
      if (finished) complete?.();
    });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx < -spacing[1] && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) =>
          translateX.setValue(
            Math.min(
              0,
              Math.max(-(REVEAL_DISTANCE * 2), (revealed ? -REVEAL_DISTANCE : 0) + gesture.dx),
            ),
          ),
        onPanResponderRelease: (_, gesture) => {
          if (revealed && gesture.dx < -DELETE_THRESHOLD) {
            animateTo(-(REVEAL_DISTANCE * 2), onDelete);
            return;
          }
          if (!revealed && gesture.dx < -spacing[8]) {
            setRevealed(true);
            animateTo(-REVEAL_DISTANCE);
            return;
          }
          setRevealed(false);
          animateTo(0);
        },
        onPanResponderTerminate: () => animateTo(revealed ? -REVEAL_DISTANCE : 0),
      }),
    [revealed, translateX, onDelete],
  );
  const product = item.product;
  const imageUrl = marketplaceImageUrl(product.image_url, apiBaseUrl);
  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);
  return (
    <View style={styles.clip}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${product.name}`}
        onPress={onDelete}
        style={styles.delete}
      >
        <Ionicons name="trash-outline" size={spacing[6]} color={colors.surface} />
        <Text style={styles.deleteText}>Remove</Text>
      </Pressable>
      <Animated.View
        style={[
          styles.item,
          product.store_closed_today && styles.closedItem,
          { transform: [{ translateX }] },
        ]}
        {...responder.panHandlers}
      >
        {imageUrl && !imageFailed ? (
          <Image
            source={{ uri: imageUrl }}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
            style={[styles.image, product.store_closed_today && styles.unavailable]}
          />
        ) : (
          <View style={styles.imageFallback}>
            <Ionicons name="cube-outline" size={spacing[6]} color={colors.textSubtle} />
          </View>
        )}
        <View style={[styles.itemBody, product.store_closed_today && styles.unavailable]}>
          <Text style={styles.itemName}>{product.name}</Text>
          {product.size || product.unit_label ? (
            <Text style={styles.unit}>{product.size || product.unit_label}</Text>
          ) : null}
          <Text style={styles.price}>RM {Number(product.price).toFixed(2)}</Text>
          <View style={styles.stockRow}>
            <Ionicons name="cube-outline" size={spacing[4]} color={colors.success} />
            <Text style={styles.stock}>
              {product.store_closed_today
                ? "Shop closed today"
                : `${product.stock_quantity} left in stock`}
            </Text>
          </View>
        </View>
        {product.store_closed_today ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${product.name} from cart`}
            disabled={busy}
            onPress={onDelete}
          >
            <Text style={styles.removeClosed}>Remove</Text>
          </Pressable>
        ) : (
          <QuantityStepper
            quantity={product.cart_quantity}
            maximum={product.stock_quantity}
            busy={busy}
            onChange={onQuantity}
          />
        )}
      </Animated.View>
    </View>
  );
}

const textSize = typography.mobile.size;
const textWeight = typography.weight;
const styles = StyleSheet.create({
  closedItem: { backgroundColor: colors.surfaceMuted },
  unavailable: { opacity: 0.45 },
  removeClosed: {
    color: colors.danger,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.semibold,
  },
  clip: {
    overflow: "hidden",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.danger,
  },
  delete: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: REVEAL_DISTANCE,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    backgroundColor: colors.danger,
  },
  deleteText: { color: colors.surface, fontSize: textSize.caption, fontWeight: textWeight.bold },
  item: {
    minHeight: spacing[16] + spacing[8],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[3],
    backgroundColor: colors.surface,
  },
  image: { width: spacing[12], height: spacing[12], borderRadius: spacing[3] },
  imageFallback: {
    width: spacing[12],
    height: spacing[12],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[3],
    backgroundColor: colors.surfaceMuted,
  },
  itemBody: { flex: 1 },
  itemName: { color: colors.text, fontSize: textSize.caption, fontWeight: textWeight.bold },
  unit: { marginTop: spacing[1], color: colors.textSubtle, fontSize: textSize.caption },
  price: {
    marginTop: spacing[1],
    color: colors.primaryStrong,
    fontSize: textSize.caption,
    fontWeight: textWeight.bold,
  },
  stockRow: { flexDirection: "row", alignItems: "center", gap: spacing[1], marginTop: spacing[1] },
  stock: { color: colors.success, fontSize: textSize.caption, fontWeight: textWeight.semibold },
});
