import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, palette, spacing, typography } from "@ecochef/design-tokens";
import type {
  MarketplaceCart,
  MarketplaceProduct,
  MarketplaceStoreDetail,
  MarketplaceProductReviewList,
} from "@ecochef/contracts";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { useAuth } from "../../auth/auth-provider";
import { openMarketplaceCart } from "../cart-navigation";
import { useBottomSlidePageExit } from "../bottom-slide-page";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";
import { ProductReviewForm } from "../components/product-review-form";
import { CartButton } from "../components/cart-button";
import { getMarketplaceTemporaryLocation } from "../delivery-preferences";
import { marketplaceImageUrl } from "../marketplace-image";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

const parameter = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

export function MarketplaceProductDetailScreen() {
  const params = useLocalSearchParams<{
    storeId?: string | string[];
    productId?: string | string[];
    addressId?: string | string[];
    returnTo?: string | string[];
    date?: string | string[];
  }>();
  const storeId = parameter(params.storeId);
  const productId = parameter(params.productId);
  const addressId = parameter(params.addressId);
  const returnTo = parameter(params.returnTo);
  const date = parameter(params.date);
  const insets = useSafeAreaInsets();
  const { close: closeDetail, animatedStyle } = useBottomSlidePageExit(
    storeId ? `/marketplace/${storeId}` : undefined,
  );
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [productReviews, setProductReviews] = useState<MarketplaceProductReviewList>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [store, setStore] = useState<MarketplaceStoreDetail>();
  const [cartCount, setCartCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const [error, setError] = useState<string>();
  const [quantity, setQuantity] = useState(1);
  const [reportOpen, setReportOpen] = useState(false);
  const reportSheetMotion = useBottomSheetSlide(reportOpen);
  const [reportRequest, setReportRequest] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<string>();

  const load = useCallback(async () => {
    if (!storeId || !productId) return;
    setLoading(true);
    setError(undefined);
    const temporaryLocation = getMarketplaceTemporaryLocation();
    try {
      const [nextStore, cart, nextReviews] = await Promise.all([
        api.getMarketplaceStore<MarketplaceStoreDetail>(
          storeId,
          temporaryLocation ? undefined : addressId,
          temporaryLocation,
        ),
        api.getMarketplaceCart<MarketplaceCart>(),
        api.getMarketplaceProductReviews<MarketplaceProductReviewList>(productId),
      ]);
      const products = Array.isArray(nextStore.products) ? nextStore.products : [];
      const cartItems = Array.isArray(cart.items) ? cart.items : [];
      const normalizedStore = { ...nextStore, products };
      setStore(normalizedStore);
      setProductReviews(nextReviews);
      setCartCount(cart.item_count);
      const cartQuantity =
        cartItems.find((item) => item.product.id === productId)?.product.cart_quantity ??
        products.find((item) => item.id === productId)?.cart_quantity ??
        0;
      setQuantity(cartQuantity > 0 ? cartQuantity : 1);
      setImageFailed(false);
    } catch (next) {
      setError(next instanceof Error ? next.message : "This product could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [api, storeId, productId, addressId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const product = store?.products.find((item) => item.id === productId);
  const cartParams = {
    ...(addressId ? { addressId } : {}),
    ...(returnTo ? { returnTo, date } : {}),
  };
  const add = async () => {
    if (store?.closed_today || product?.store_closed_today) return;
    if (!product || busy || product.stock_quantity <= 0) return;
    setBusy(true);
    setError(undefined);
    try {
      const nextQuantity = Math.min(product.stock_quantity, quantity);
      const cart = await api.setMarketplaceCartQuantity<MarketplaceCart>(product.id, nextQuantity);
      setCartCount(cart.item_count);
      setStore((current) =>
        current
          ? {
              ...current,
              products: current.products.map((item) =>
                item.id === product.id ? { ...item, cart_quantity: nextQuantity } : item,
              ),
            }
          : current,
      );
      closeDetail();
    } catch (next) {
      setError(next instanceof Error ? next.message : "This item could not be added to the cart.");
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async () => {
    if (!product || reporting || reportRequest.trim().length < 10) return;
    setReporting(true);
    setReportFeedback(undefined);
    try {
      await api.reportMarketplaceProduct(product.id, reportRequest.trim());
      setReportRequest("");
      setReportOpen(false);
      setReportFeedback("Your report has been sent for review.");
    } catch (next) {
      setReportFeedback(next instanceof Error ? next.message : "Your report could not be sent.");
    } finally {
      setReporting(false);
    }
  };

  if (loading && !store)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  if (!store || !product)
    return (
      <View style={styles.center}>
        <Ionicons name="cube-outline" size={38} color={colors.textSubtle} />
        <Text style={styles.unavailable}>{error ?? "Product unavailable."}</Text>
        <Pressable onPress={() => void load()}>
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      </View>
    );
  const imageUrl = marketplaceImageUrl(product.image_url, apiBaseUrl);
  const closed = !!store.closed_today || !!product.store_closed_today;
  const soldOut = product.stock_quantity <= 0;
  const relatedProducts = store.products
    .filter((item) => item.id !== product.id)
    .sort(
      (left, right) =>
        Number(right.category === product.category) - Number(left.category === product.category),
    )
    .slice(0, 8);
  const openProduct = (nextProduct: MarketplaceProduct) =>
    router.replace({
      pathname: "/marketplace/[storeId]/products/[productId]" as never,
      params: { storeId, productId: nextProduct.id, ...cartParams },
    } as never);

  return (
    <Animated.View style={[styles.root, animatedStyle]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + PAGE_TOP_GAP, paddingBottom: 132 }}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={closeDetail}
            style={styles.circle}
          >
            <Ionicons name="chevron-down" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Back to ${store.name}`}
            onPress={closeDetail}
            style={styles.storeLink}
          >
            <Text style={styles.storeName} numberOfLines={1}>
              {store.name}
            </Text>
            <Ionicons name="chevron-up" size={16} color={colors.textMuted} />
          </Pressable>
          <CartButton
            disabled={closed}
            count={cartCount}
            onPress={() => openMarketplaceCart(cartParams)}
          />
        </View>
        <View style={styles.visual}>
          {imageUrl && !imageFailed ? (
            <Image
              accessibilityLabel={product.name}
              source={{ uri: imageUrl }}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
              style={styles.image}
            />
          ) : (
            <View style={styles.imageFallback}>
              <Ionicons name="cube-outline" size={64} color={colors.textSubtle} />
            </View>
          )}
        </View>
        <View style={styles.copy}>
          <Text style={styles.price}>
            RM {Number(product.price).toFixed(2)}
            {product.original_price && Number(product.original_price) > Number(product.price) ? (
              <Text style={styles.originalPrice}>
                {" "}
                RM {Number(product.original_price).toFixed(2)}
              </Text>
            ) : null}
          </Text>
          <Text style={styles.name}>{product.name}</Text>
          {product.brand || product.size ? (
            <View style={styles.productFacts}>
              {product.brand ? (
                <View style={styles.fact}>
                  <Text style={styles.factLabel}>Brand</Text>
                  <Text style={styles.factValue}>{product.brand}</Text>
                </View>
              ) : null}
              {product.size ? (
                <View style={styles.fact}>
                  <Text style={styles.factLabel}>Size</Text>
                  <Text style={styles.factValue}>{product.size}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {product.unit_label ? <Text style={styles.unit}>{product.unit_label}</Text> : null}
          <Text style={styles.stock}>{product.stock_quantity} available</Text>
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={17} color={colors.ratingStar} />
            <Text style={styles.rating}>
              {Number(productReviews?.rating ?? 0).toFixed(1)} ({productReviews?.total ?? 0}) ·
              Product rating
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={closeDetail} style={styles.shopRow}>
            <Ionicons name="storefront-outline" size={18} color={colors.primaryStrong} />
            <Text style={styles.shopName}>{store.name}</Text>
            <Ionicons name="chevron-up" size={16} color={colors.textMuted} />
          </Pressable>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Item Description</Text>
            <Text style={styles.description}>
              {product.description?.trim() || "No description provided."}
            </Text>
          </View>
          {relatedProducts.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>More from this shop</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.relatedList}
              >
                {relatedProducts.map((item) => {
                  const relatedUrl = marketplaceImageUrl(item.image_url, apiBaseUrl);
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${item.name}`}
                      onPress={() => openProduct(item)}
                      style={styles.relatedCard}
                    >
                      {relatedUrl ? (
                        <Image
                          source={{ uri: relatedUrl }}
                          resizeMode="cover"
                          style={styles.relatedImage}
                        />
                      ) : (
                        <View style={styles.relatedFallback}>
                          <Ionicons name="cube-outline" size={30} color={colors.textSubtle} />
                        </View>
                      )}
                      <Text style={styles.relatedPrice}>RM {Number(item.price).toFixed(2)}</Text>
                      <Text numberOfLines={2} style={styles.relatedName}>
                        {item.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Notes</Text>
            <Text style={styles.description}>
              Product images and packaging are for reference. Availability may change before
              checkout. You can add delivery or substitution requests during checkout.
            </Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Product ratings · {Number(productReviews?.rating ?? 0).toFixed(1)} (
              {productReviews?.total ?? 0})
            </Text>
            <Text style={styles.description}>From verified purchases of this exact item.</Text>
            {productReviews?.can_review ? (
              <Pressable
                accessibilityRole="button"
                style={styles.reportButton}
                onPress={() => setReviewOpen(true)}
              >
                <Ionicons name="star-outline" size={spacing[5]} color={colors.ratingStar} />
                <Text style={[styles.reportText, { color: colors.primaryStrong }]}>
                  {productReviews.my_review
                    ? "Edit your product rating"
                    : "Rate your purchased item"}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.description}>
                Complete a paid purchase of this item to rate it.
              </Text>
            )}
            {productReviews?.reviews.slice(0, 5).map((review) => (
              <View key={review.id} style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {review.user_name} · {"★".repeat(review.rating)}
                </Text>
                {review.comment ? <Text style={styles.description}>{review.comment}</Text> : null}
              </View>
            ))}
          </View>
          {reportFeedback ? (
            <Text
              style={[
                styles.reportFeedback,
                reportFeedback.startsWith("Your report has") ? styles.reportSuccess : styles.error,
              ]}
            >
              {reportFeedback}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setReportFeedback(undefined);
              setReportOpen(true);
            }}
            style={styles.reportButton}
          >
            <Ionicons name="flag-outline" size={18} color={colors.danger} />
            <Text style={styles.reportText}>Report this item</Text>
          </Pressable>
        </View>
      </ScrollView>
      <View style={[styles.sticky, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}>
        <View style={styles.quantityControl}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decrease quantity"
            disabled={closed || quantity <= 1 || soldOut}
            onPress={() => setQuantity((current) => Math.max(1, current - 1))}
            style={styles.quantityButton}
          >
            <Ionicons
              name="remove"
              size={20}
              color={quantity <= 1 || soldOut ? colors.textSubtle : colors.primaryStrong}
            />
          </Pressable>
          <Text style={styles.quantity}>{soldOut ? 0 : quantity}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Increase quantity"
            disabled={closed || soldOut || quantity >= product.stock_quantity}
            onPress={() => setQuantity((current) => Math.min(product.stock_quantity, current + 1))}
            style={styles.quantityButton}
          >
            <Ionicons
              name="add"
              size={20}
              color={
                soldOut || quantity >= product.stock_quantity
                  ? colors.textSubtle
                  : colors.primaryStrong
              }
            />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={closed || busy || soldOut}
          onPress={() => void add()}
          style={({ pressed }) => [
            styles.add,
            (pressed || busy) && styles.addPressed,
            (closed || soldOut) && styles.addDisabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <>
              <Ionicons name="cart-outline" size={21} color={colors.surface} />
              <Text style={styles.addText}>
                {closed
                  ? "Shop closed today"
                  : soldOut
                    ? "Sold out"
                    : product.cart_quantity > 0
                      ? "Update Cart"
                      : "Add to Cart"}
              </Text>
            </>
          )}
        </Pressable>
      </View>
      <ProductReviewForm
        productId={reviewOpen ? product.id : undefined}
        productName={product.name}
        onClose={() => setReviewOpen(false)}
        onSaved={() => void load()}
      />
      <Modal
        transparent
        animationType="fade"
        visible={reportOpen}
        onRequestClose={() => setReportOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Animated.View
            style={[
              styles.modalCard,
              { paddingBottom: Math.max(insets.bottom, spacing[5]) },
              reportSheetMotion,
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Report this item</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close report form"
                onPress={() => setReportOpen(false)}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.modalHelp}>
              Tell EcoChef what is wrong with {product.name}. Your request will be linked to this
              product for review.
            </Text>
            <TextInput
              accessibilityLabel="Report request"
              multiline
              maxLength={1000}
              value={reportRequest}
              onChangeText={setReportRequest}
              placeholder="Describe the issue in at least 10 characters"
              placeholderTextColor={colors.textSubtle}
              style={styles.reportInput}
            />
            <Text style={styles.characterCount}>{reportRequest.length}/1000</Text>
            <Pressable
              accessibilityRole="button"
              disabled={reporting || reportRequest.trim().length < 10}
              onPress={() => void submitReport()}
              style={[
                styles.submitReport,
                (reporting || reportRequest.trim().length < 10) && styles.addDisabled,
              ]}
            >
              {reporting ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.submitReportText}>Send report</Text>
              )}
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
    </Animated.View>
  );
}

const textSize = typography.mobile.size;
const textWeight = typography.weight;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[6],
    backgroundColor: colors.consumerCanvas,
  },
  unavailable: {
    marginTop: spacing[3],
    color: colors.text,
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  retry: {
    marginTop: spacing[3],
    color: colors.primaryStrong,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    marginBottom: spacing[4],
  },
  circle: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  storeLink: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing[1] },
  storeName: {
    flexShrink: 1,
    color: colors.text,
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  visual: {
    width: 240,
    height: 240,
    alignSelf: "center",
    overflow: "hidden",
    borderRadius: spacing[5],
    backgroundColor: colors.surface,
  },
  image: { width: "100%", height: "100%" },
  imageFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  copy: { padding: spacing[5] },
  price: {
    color: colors.primaryStrong,
    fontSize: textSize.bodyTextHeavy,
    fontWeight: textWeight.bold,
  },
  originalPrice: {
    color: colors.textSubtle,
    fontSize: textSize.caption,
    fontWeight: textWeight.regular,
    textDecorationLine: "line-through",
  },
  name: {
    marginTop: spacing[2],
    color: colors.text,
    fontSize: textSize.bodyTextHeavy,
    lineHeight: 24,
    fontWeight: textWeight.bold,
  },
  productFacts: { flexDirection: "row", gap: spacing[2], marginTop: spacing[3] },
  fact: {
    flex: 1,
    padding: spacing[3],
    borderRadius: spacing[3],
    backgroundColor: colors.surfaceMuted,
  },
  factLabel: {
    color: colors.textMuted,
    fontSize: textSize.caption,
    fontWeight: textWeight.semibold,
  },
  factValue: {
    marginTop: spacing[1],
    color: colors.text,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  unit: {
    marginTop: spacing[2],
    color: colors.textMuted,
    fontSize: textSize.caption,
    fontWeight: textWeight.semibold,
  },
  stock: {
    marginTop: spacing[3],
    color: colors.success,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  ratingRow: { marginTop: spacing[2], flexDirection: "row", alignItems: "center", gap: spacing[1] },
  rating: {
    color: colors.textMuted,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.semibold,
  },
  shopRow: {
    marginTop: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  shopName: {
    flex: 1,
    color: colors.text,
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  section: { marginTop: spacing[6] },
  sectionTitle: {
    color: colors.text,
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  description: {
    marginTop: spacing[2],
    color: colors.textMuted,
    fontSize: textSize.secondaryInteraction,
    lineHeight: 21,
  },
  relatedList: { gap: spacing[3], paddingTop: spacing[3], paddingRight: spacing[5] },
  relatedCard: { width: 132 },
  relatedImage: {
    width: 132,
    height: 112,
    borderRadius: spacing[3],
    backgroundColor: colors.surfaceMuted,
  },
  relatedFallback: {
    width: 132,
    height: 112,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[3],
    backgroundColor: colors.surfaceMuted,
  },
  relatedPrice: {
    marginTop: spacing[2],
    color: colors.primaryStrong,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  relatedName: {
    marginTop: spacing[1],
    color: colors.text,
    fontSize: textSize.caption,
    lineHeight: 18,
    fontWeight: textWeight.semibold,
  },
  error: { marginTop: spacing[4], color: colors.danger, fontSize: textSize.caption },
  reportFeedback: { marginTop: spacing[5], fontSize: textSize.caption },
  reportSuccess: { color: colors.success },
  reportButton: {
    marginTop: spacing[5],
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  reportText: {
    color: colors.danger,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  sticky: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    backgroundColor: colors.surface,
  },
  quantityControl: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.primaryStrong,
    borderRadius: spacing[4],
    backgroundColor: colors.primarySoft,
  },
  quantityButton: { width: 40, height: 50, alignItems: "center", justifyContent: "center" },
  quantity: {
    minWidth: 24,
    color: colors.text,
    textAlign: "center",
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  add: {
    flex: 1,
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: spacing[4],
    backgroundColor: colors.primaryStrong,
  },
  addPressed: { opacity: 0.72 },
  addDisabled: { opacity: 0.45 },
  addText: {
    color: colors.surface,
    fontSize: textSize.bodyInteraction,
    fontWeight: textWeight.bold,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: palette.crgba_21_34_24_0_42,
  },
  modalCard: {
    padding: spacing[5],
    borderTopLeftRadius: spacing[6],
    borderTopRightRadius: spacing[6],
    backgroundColor: colors.surface,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: colors.text, fontSize: textSize.bodyTextHeavy, fontWeight: textWeight.bold },
  modalClose: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
  },
  modalHelp: {
    marginTop: spacing[3],
    color: colors.textMuted,
    fontSize: textSize.secondaryInteraction,
    lineHeight: 21,
  },
  reportInput: {
    minHeight: 128,
    marginTop: spacing[4],
    padding: spacing[4],
    color: colors.text,
    fontSize: textSize.secondaryInteraction,
    lineHeight: 21,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.consumerCanvas,
  },
  characterCount: {
    marginTop: spacing[1],
    color: colors.textSubtle,
    fontSize: textSize.caption,
    textAlign: "right",
  },
  submitReport: {
    height: 50,
    marginTop: spacing[4],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[4],
    backgroundColor: colors.primaryStrong,
  },
  submitReportText: {
    color: colors.surface,
    fontSize: textSize.bodyInteraction,
    fontWeight: textWeight.bold,
  },
});
