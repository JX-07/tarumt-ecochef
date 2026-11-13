import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplaceProduct } from "@ecochef/contracts";
import { memo, useEffect, useRef, useState } from "react";
import { Image, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { marketplaceImageUrl } from "../marketplace-image";
import { RequiredPlanBadge } from "./required-plan-badge";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

type ProductCardProps = {
  product: MarketplaceProduct;
  onQuantity: (quantity: number) => void;
  onOpen?: () => void;
  style?: StyleProp<ViewStyle>;
};

function ProductCardView({ product, onQuantity, onOpen, style }: ProductCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [quantity, setQuantity] = useState(product.cart_quantity);
  const quantityRef = useRef(product.cart_quantity);
  const imageUrl = marketplaceImageUrl(product.image_url, apiBaseUrl);
  const closed = !!product.store_closed_today;
  const soldOut = product.stock_quantity <= 0;
  const atCartLimit = closed || soldOut || product.stock_quantity <= quantity;
  const hasDiscount =
    product.original_price != null && Number(product.original_price) > Number(product.price);
  useEffect(() => {
    quantityRef.current = product.cart_quantity;
    setQuantity(product.cart_quantity);
    if (product.cart_quantity <= 0) setExpanded(false);
  }, [product.cart_quantity]);
  const change = (next: number) => {
    if (closed) return;
    const quantity = Math.max(0, Math.min(product.stock_quantity, next));
    quantityRef.current = quantity;
    setQuantity(quantity);
    onQuantity(quantity);
  };
  const add = () => {
    if (!atCartLimit) change(quantityRef.current + 1);
  };

  return (
    <View style={[styles.card, style, closed && styles.closedCard]}>
      <View style={styles.visual}>
        {imageUrl && !imageFailed ? (
          <Pressable
            accessibilityRole={onOpen ? "button" : undefined}
            accessibilityLabel={onOpen ? `View ${product.name}` : product.name}
            disabled={!onOpen || closed}
            onPress={onOpen}
            style={styles.imagePressable}
          >
            <Image
              source={{ uri: imageUrl }}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
              style={styles.image}
            />
          </Pressable>
        ) : (
          <View style={styles.fallback}>
            <Ionicons name="cube-outline" size={40} color={colors.textSubtle} />
          </View>
        )}
        {hasDiscount ? (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>
              {Math.max(0, Math.round(Number(product.discount_percent)))}% off
            </Text>
          </View>
        ) : null}
        {!closed && soldOut ? (
          <View style={styles.soldOutBadge}>
            <Text style={styles.soldOutText}>Sold out</Text>
          </View>
        ) : null}
        {closed ? null : quantity <= 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              atCartLimit ? `${product.name} is at the cart limit` : `Add ${product.name} to cart`
            }
            disabled={atCartLimit}
            onPress={add}
            style={({ pressed }) => [
              styles.add,
              pressed && styles.addPressed,
              atCartLimit && styles.addDisabled,
            ]}
          >
            <Ionicons name="add" size={22} color={colors.surface} />
          </Pressable>
        ) : expanded ? (
          <View style={styles.expandedStepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove one ${product.name}`}
              onPress={() => change(quantityRef.current - 1)}
              style={({ pressed }) => [styles.stepButton, pressed && styles.addPressed]}
            >
              <Ionicons name="remove" size={18} color={colors.primaryStrong} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Collapse quantity controls for ${product.name}`}
              onPress={() => setExpanded(false)}
              style={styles.quantityButton}
            >
              <Text style={styles.quantity}>{quantity}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add one ${product.name}`}
              disabled={atCartLimit}
              onPress={add}
              style={({ pressed }) => [
                styles.stepButton,
                pressed && styles.addPressed,
                atCartLimit && styles.addDisabled,
              ]}
            >
              <Ionicons name="add" size={18} color={colors.primaryStrong} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${quantity} ${product.name} in cart. Show quantity controls`}
            onPress={() => setExpanded(true)}
            style={({ pressed }) => [styles.quantityCompact, pressed && styles.addPressed]}
          >
            <Text style={styles.compactQuantity}>{quantity}</Text>
          </Pressable>
        )}
      </View>
      <Pressable disabled={!onOpen || closed} onPress={onOpen} style={styles.copy}>
        <Text style={styles.price}>
          RM {Number(product.price).toFixed(2)}{" "}
          {hasDiscount ? (
            <Text style={styles.original}>RM {Number(product.original_price).toFixed(2)}</Text>
          ) : null}
        </Text>
        <Text style={styles.name} numberOfLines={2}>
          <RequiredPlanBadge product={product} />
          {product.name}
        </Text>
        <Text style={styles.unit} numberOfLines={1}>
          {product.size?.trim() || product.unit_label?.trim() || "Size not provided"}
        </Text>
        <View style={styles.stockRow}>
          <Ionicons
            name="cube-outline"
            size={spacing[4]}
            color={soldOut ? colors.textSubtle : colors.success}
          />
          <Text style={[styles.stock, soldOut && styles.stockEmpty]}>
            {product.stock_quantity} left in stock
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

export const ProductCard = memo(
  ProductCardView,
  (previous, next) => previous.product === next.product && previous.style === next.style,
);

const textSize = typography.mobile.size;
const textWeight = typography.weight;

const styles = StyleSheet.create({
  closedCard: { opacity: 0.45, backgroundColor: colors.surfaceMuted },
  card: { width: 154, marginRight: spacing[4] },
  visual: {
    width: 154,
    height: 154,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: spacing[4],
    backgroundColor: colors.surfaceMuted,
  },
  imagePressable: { width: "100%", height: "100%" },
  image: { width: "100%", height: "100%" },
  fallback: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  discountBadge: {
    position: "absolute",
    left: spacing[2],
    bottom: spacing[2],
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: spacing[2],
    backgroundColor: colors.market,
  },
  discountText: { color: colors.surface, fontSize: textSize.caption, fontWeight: textWeight.bold },
  soldOutBadge: {
    position: "absolute",
    left: spacing[2],
    top: spacing[2],
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: spacing[2],
    backgroundColor: colors.textMuted,
  },
  soldOutText: { color: colors.surface, fontSize: textSize.caption, fontWeight: textWeight.bold },
  add: {
    position: "absolute",
    top: spacing[2],
    right: spacing[2],
    width: spacing[10],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[5],
    backgroundColor: colors.primary,
    elevation: 3,
  },
  quantityCompact: {
    position: "absolute",
    top: spacing[2],
    right: spacing[2],
    width: spacing[10],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[5],
    backgroundColor: colors.primary,
    elevation: 3,
  },
  compactQuantity: {
    color: colors.surface,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  expandedStepper: {
    position: "absolute",
    top: spacing[2],
    right: spacing[2],
    height: spacing[10],
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: spacing[5],
    backgroundColor: colors.surface,
    elevation: 3,
  },
  stepButton: {
    width: spacing[10],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  quantityButton: {
    minWidth: spacing[8],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  addPressed: { opacity: 0.72 },
  addDisabled: { opacity: 0.42 },
  quantity: { color: colors.text, fontSize: textSize.caption, fontWeight: textWeight.bold },
  copy: { paddingTop: spacing[2] },
  price: {
    color: colors.primaryStrong,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  original: {
    color: colors.textSubtle,
    fontSize: textSize.caption,
    fontWeight: textWeight.regular,
    textDecorationLine: "line-through",
  },
  name: {
    marginTop: spacing[1],
    color: colors.text,
    fontSize: textSize.caption,
    lineHeight: 17,
    fontWeight: textWeight.medium,
  },
  description: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: textSize.caption,
    lineHeight: 17,
  },
  unit: { marginTop: 2, color: colors.textMuted, fontSize: textSize.caption },
  stockRow: { flexDirection: "row", alignItems: "center", gap: spacing[1], marginTop: spacing[1] },
  stock: { color: colors.success, fontSize: textSize.caption, fontWeight: textWeight.semibold },
  stockEmpty: { color: colors.textSubtle },
});
