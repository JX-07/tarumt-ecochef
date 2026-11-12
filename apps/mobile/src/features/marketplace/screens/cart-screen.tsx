import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { ConsumerProfile, MarketplaceCart, MarketplaceCheckoutResult, MarketplaceCheckoutStatus, MarketplaceSlotAvailability } from "@ecochef/contracts";
import * as Linking from "expo-linking";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { createMobileApi } from "../../../lib/api";
import { AppMessageModal } from "../../../shared/components/app-message-modal";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { requestShoppingReturn } from "../../meal-planning/shopping-return";
import { useAuth } from "../../auth/auth-provider";
import { releaseMarketplaceCartNavigation } from "../cart-navigation";
import { DeliveryTimeSheet } from "../components/delivery-sheets";
import { SwipeToDeleteCartItem } from "../components/swipe-to-delete-cart-item";
import { getMarketplaceFulfillment, setMarketplaceFulfillment, chooseMarketplaceAddress, consumeMarketplaceAddress, getMarketplaceArrival, getMarketplaceTemporaryLocation, setMarketplaceArrival } from "../delivery-preferences";
import { formatMarketplaceAddress } from "../location-format";
import { locationType } from "../location-types";
import { invalidateMarketplaceCartOptimisticUpdates } from "../use-optimistic-store-cart";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

const stripePublishableKey = runtimeProcess?.env?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripeFormUrl = `${apiBaseUrl.replace(/\/$/, "")}/stripe/checkout-form`;
type FulfillmentMethod = "delivery" | "pickup";
const destinationKey = (addressId?: string, fulfillmentMethod: FulfillmentMethod = "delivery") => {
  if (fulfillmentMethod === "pickup") return "pickup";
  const temporary = getMarketplaceTemporaryLocation();
  return temporary
    ? `temporary:${temporary.latitude}:${temporary.longitude}:${temporary.address_line_1}`
    : addressId ? `saved:${addressId}` : undefined;
};

export function CartScreen() {
  const params = useLocalSearchParams<{ addressId?: string; storeId?: string; returnTo?: string; date?: string; checkout?: string; order_id?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const loadAvailability = useCallback((day: string) => api.getMarketplaceSlotAvailability<MarketplaceSlotAvailability>(day, params.storeId), [api, params.storeId]);
  const [timeOpen, setTimeOpen] = useState(false);
  const [arrivalAt, setArrivalAt] = useState(getMarketplaceArrival());
  const [cart, setCart] = useState<MarketplaceCart>();
  const [profile, setProfile] = useState<ConsumerProfile>();
  const [addressId, setAddressId] = useState(params.addressId);
  const [promo, setPromo] = useState("");
  const [busy, setBusy] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<{ title: string; message: string; tone: "success" | "error" | "info" }>();
  const [invoiceUrl, setInvoiceUrl] = useState<string>();
  const [paymentSession, setPaymentSession] = useState<{ clientSecret: string; orderId: string; simulationAvailable: boolean }>();
  const [paymentFormHeight, setPaymentFormHeight] = useState(120);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod>(getMarketplaceFulfillment());
  const handledCheckout = useRef<string | undefined>(undefined);
  const paymentDestination = useRef<string | undefined>(undefined);
  const addressIdRef = useRef(addressId);
  addressIdRef.current = addressId;
  useEffect(() => {
    releaseMarketplaceCartNavigation();
    invalidateMarketplaceCartOptimisticUpdates();
  }, []);

  const acceptCart = useCallback((nextCart: MarketplaceCart) => {
    setCart(nextCart);
    if (nextCart.checkout_blocked_reason) setPaymentSession(undefined);
    if (!nextCart.stock_adjustments.length) return;
    const details = nextCart.stock_adjustments.map((adjustment) => adjustment.adjusted_quantity > 0
      ? `${adjustment.product_name} was changed from ${adjustment.previous_quantity} to ${adjustment.adjusted_quantity}.`
      : `${adjustment.product_name} was removed because it is out of stock.`
    ).join("\n");
    setMessage({
      title: "Cart updated for low stock",
      message: `${details}\n\nThe available quantity changed before payment.`,
      tone: "info",
    });
  }, []);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true); setError(undefined);
    try {
      const nextProfile = await api.getMyConsumerProfile<ConsumerProfile>();
      const temporaryLocation = getMarketplaceTemporaryLocation();
      const preferredAddress = consumeMarketplaceAddress();
      const nextAddressId = temporaryLocation ? undefined : preferredAddress ?? nextProfile.addresses.find((address) => address.id === addressIdRef.current)?.id ?? nextProfile.addresses.find((address) => address.is_default)?.id ?? nextProfile.addresses[0]?.id;
      const nextCart = await api.getMarketplaceCart<MarketplaceCart>(nextAddressId, temporaryLocation, params.storeId);
      const nextDestination = destinationKey(nextAddressId, fulfillmentMethod);
      if (paymentDestination.current && paymentDestination.current !== nextDestination) {
        paymentDestination.current = undefined;
        setPaymentSession(undefined);
        setPaymentFormHeight(120);
      }
      acceptCart(nextCart); setProfile(nextProfile);
      setAddressId(nextAddressId);
      setPromo(nextCart.applied_promo?.code ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your cart could not be loaded."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [acceptCart, api, fulfillmentMethod, params.storeId]);
  useFocusEffect(useCallback(() => { setArrivalAt(getMarketplaceArrival()); if (!paymentSession) setFulfillmentMethod(getMarketplaceFulfillment()); void load(); const timer = setInterval(() => void load(true), 30000); return () => clearInterval(timer); }, [load]));

  const waitForCheckout = useCallback(async (orderId: string) => {
    let latest: MarketplaceCheckoutStatus | undefined;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      latest = await api.getMarketplaceCheckoutStatus<MarketplaceCheckoutStatus>(orderId);
      if (["paid", "failed", "refunded", "disputed"].includes(latest.payment_status)) return latest;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    return latest;
  }, [api]);

  const showCheckoutResult = useCallback(async (orderId: string) => {
    const result = await waitForCheckout(orderId);
    acceptCart(await api.getMarketplaceCart<MarketplaceCart>(addressId, getMarketplaceTemporaryLocation(), params.storeId));
    if (result?.payment_status === "paid") {
      router.replace({
        pathname: "/marketplace/order" as never,
        params: {
          orderId,
          fulfillment: fulfillmentMethod,
          estimate: String(cart?.estimated_delivery_minutes ?? 30),
        },
      } as never);
    } else if (result?.payment_status === "failed") {
      setMessage({ title: "Payment not completed", message: "Payment was not completed. Check your basket before trying again.", tone: "error" });
    } else {
      setMessage({ title: "Payment confirmation pending", message: "Stripe is still confirming the test payment. You can check the order again shortly.", tone: "info" });
    }
  }, [acceptCart, api, cart?.estimated_delivery_minutes, fulfillmentMethod, waitForCheckout]);

  const simulatePayment = useCallback(async () => {
    if (!paymentSession || busy) return;
    invalidateMarketplaceCartOptimisticUpdates();
    setBusy("simulate-payment");
    setError(undefined);
    try {
      const result = await api.simulateMarketplacePayment<MarketplaceCheckoutStatus>(paymentSession.orderId);
      acceptCart(await api.getMarketplaceCart<MarketplaceCart>(addressId, getMarketplaceTemporaryLocation(), params.storeId));
      setPaymentSession(undefined);
      router.replace({
        pathname: "/marketplace/order" as never,
        params: {
          orderId: result.order_id,
          fulfillment: fulfillmentMethod,
          estimate: String(cart?.estimated_delivery_minutes ?? 30),
        },
      } as never);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The payment could not be completed.");
    } finally {
      setBusy(undefined);
    }
  }, [acceptCart, api, busy, cart?.estimated_delivery_minutes, fulfillmentMethod, paymentSession]);

  useEffect(() => {
    if (params.checkout !== "success" || !params.order_id || handledCheckout.current === params.order_id) return;
    handledCheckout.current = params.order_id;
    setBusy("checkout");
    void showCheckoutResult(params.order_id)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Payment status could not be loaded."))
      .finally(() => setBusy(undefined));
  }, [params.checkout, params.order_id, showCheckoutResult]);

  const grouped = useMemo(() => { const groups = new Map<string, MarketplaceCart["items"]>(); for (const item of cart?.items ?? []) groups.set(item.product.store_id, [...(groups.get(item.product.store_id) ?? []), item]); return [...groups.values()].map((items) => [items[0].store_name, items] as const); }, [cart]);
  const getPricedCart = useCallback(() => api.getMarketplaceCart<MarketplaceCart>(addressId, getMarketplaceTemporaryLocation(), params.storeId), [addressId, api, params.storeId]);
  const changeQuantity = async (productId: string, quantity: number) => {
    if (busy || paymentSession) return; setBusy(productId); setError(undefined);
    try {
      if (quantity) await api.setMarketplaceCartQuantity<MarketplaceCart>(productId, quantity);
      else await api.removeMarketplaceCartItem<MarketplaceCart>(productId);
      acceptCart(await getPricedCart());
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The cart could not be updated."); }
    finally { setBusy(undefined); }
  };
  const applyPromo = async () => { if (!promo.trim() || busy || paymentSession) return; setBusy("promo"); setError(undefined); try { await api.applyMarketplacePromo<MarketplaceCart>(promo, params.storeId); acceptCart(await getPricedCart()); } catch (reason) { setError(reason instanceof Error ? reason.message : "This promo code could not be applied."); } finally { setBusy(undefined); } };
  const removePromo = async () => { if (busy || paymentSession) return; setBusy("promo"); try { await api.removeMarketplacePromo<MarketplaceCart>(); acceptCart(await getPricedCart()); setPromo(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "The promotion could not be removed."); } finally { setBusy(undefined); } };
  const placeOrder = useCallback(async () => {
    const temporaryLocation = getMarketplaceTemporaryLocation();
    if (fulfillmentMethod === "delivery" && !addressId && !temporaryLocation) { setMessage({ title: "Delivery address required", message: "Add or choose a delivery address before placing your order.", tone: "info" }); return; }
    if (busy || paymentSession || !cart?.items.length) return;
    if (cart.checkout_blocked_reason) { setError(cart.checkout_blocked_reason); return; }
    if (new Set(cart?.items.map((item) => item.product.store_id)).size > 1) { setError("Check out one shop at a time. Remove the other shop’s items before continuing."); return; }
    setBusy("checkout"); setError(undefined);
    try {
      const checkoutRequest = fulfillmentMethod === "pickup"
        ? { fulfillment_method: "pickup" as const }
        : temporaryLocation
          ? { fulfillment_method: "delivery" as const, temporary_location: temporaryLocation }
          : { fulfillment_method: "delivery" as const, address_id: addressId as string };
      const result = await api.checkoutMarketplace<MarketplaceCheckoutResult>(checkoutRequest, getMarketplaceArrival(), params.storeId);
      handledCheckout.current = result.order_id;
      paymentDestination.current = destinationKey(addressId, fulfillmentMethod);
      setPaymentSession({ clientSecret: result.checkout_client_secret, orderId: result.order_id, simulationAvailable: result.simulation_available });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The order could not be placed."); }
    finally { setBusy(undefined); }
  }, [addressId, api, fulfillmentMethod, busy, paymentSession, cart?.items, params.storeId]);

  const chooseFulfillment = (next: FulfillmentMethod) => {
    if (next === fulfillmentMethod || busy || paymentSession) return;
    setFulfillmentMethod(next);
    setMarketplaceFulfillment(next);
    paymentDestination.current = undefined;
    setPaymentSession(undefined);
    setPaymentFormHeight(120);
  };

  if (loading && !cart) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  const shopName = grouped.length === 1 ? grouped[0][0] : "Marketplace";
  const temporaryLocation = getMarketplaceTemporaryLocation();
  const selectedAddress = profile?.addresses.find((address) => address.id === addressId);
  const appearance = locationType(selectedAddress?.address_type);
  const addressTitle = temporaryLocation ? "Current Location" : selectedAddress?.label || appearance.label;
  const addressText = temporaryLocation ? formatMarketplaceAddress(temporaryLocation) : selectedAddress ? formatMarketplaceAddress(selectedAddress) : "Choose a delivery address";
  const deliveryEstimate = cart?.estimated_delivery_minutes;
  const deliveryDistance = cart?.estimated_delivery_distance_km;
  const displayedDeliveryFee = fulfillmentMethod === "pickup" ? 0 : Number(cart?.delivery_fee ?? 0);
  const displayedTotal = fulfillmentMethod === "pickup" ? Number(cart?.total ?? 0) - Number(cart?.delivery_fee ?? 0) : Number(cart?.total ?? 0);

  return <View style={styles.root}>
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} colors={[colors.primary]} />} contentContainerStyle={[styles.content, { paddingTop: insets.top + PAGE_TOP_GAP, paddingBottom: spacing[8] }]} keyboardShouldPersistTaps="handled">
      <View style={styles.storeHeader}><Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={spacing[6]} color={colors.text} /></Pressable><Text style={styles.storeName} numberOfLines={1}>{shopName}</Text><View style={styles.headerSpace} /></View>
      {error ? <Pressable style={styles.error} onPress={() => setError(undefined)}><Text style={styles.errorText}>{error}</Text></Pressable> : null}
      {!cart?.items.length ? <View style={styles.empty}><Ionicons name="cart-outline" size={spacing[10]} color={colors.textSubtle} /><Text style={styles.emptyTitle}>Your cart is empty</Text><Text style={styles.emptyCopy}>Browse nearby shops to add discounted food.</Text><Pressable onPress={() => router.replace({ pathname: "/(tabs)/marketplace", params: params.returnTo ? { returnTo: params.returnTo, date: params.date } : {} })}><Text style={styles.shopLink}>Browse marketplace</Text></Pressable></View> : <>
        {cart.checkout_blocked_reason ? <Text accessibilityRole="alert" style={styles.errorText}>{cart.checkout_blocked_reason}</Text> : null}
        <Text style={styles.orderSummaryTitle}>Order Summary</Text>
        {grouped.map(([groupStoreName, items]) => <View key={items[0].product.store_id}>{grouped.length > 1 ? <Text style={styles.section}>{groupStoreName.toUpperCase()}</Text> : null}<View style={styles.group}>{items.map((item) => <SwipeToDeleteCartItem key={item.product.id} item={item} busy={!!busy || !!paymentSession} onQuantity={(quantity) => void changeQuantity(item.product.id, quantity)} onDelete={() => void changeQuantity(item.product.id, 0)} />)}</View></View>)}
        <View style={styles.inlineTotals}><Row label={fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"} value={displayedDeliveryFee} />{cart.discount > 0 ? <Row label="Discount" value={-cart.discount} green /> : null}<View style={styles.divider} /><Row label="Total" value={displayedTotal} total /></View>
        <Text style={styles.section}>FULFILMENT</Text><View style={styles.fulfillmentTabs}><Pressable accessibilityRole="button" accessibilityState={{ selected: fulfillmentMethod === "delivery" }} disabled={!!busy || !!paymentSession} onPress={() => chooseFulfillment("delivery")} style={[styles.fulfillmentTab, fulfillmentMethod === "delivery" && styles.fulfillmentTabActive]}><Ionicons name="bicycle-outline" size={spacing[5]} color={fulfillmentMethod === "delivery" ? colors.primaryStrong : colors.textMuted} /><Text style={[styles.fulfillmentText, fulfillmentMethod === "delivery" && styles.fulfillmentTextActive]}>Delivery</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ selected: fulfillmentMethod === "pickup" }} disabled={!!busy || !!paymentSession} onPress={() => chooseFulfillment("pickup")} style={[styles.fulfillmentTab, fulfillmentMethod === "pickup" && styles.fulfillmentTabActive]}><Ionicons name="storefront-outline" size={spacing[5]} color={fulfillmentMethod === "pickup" ? colors.primaryStrong : colors.textMuted} /><Text style={[styles.fulfillmentText, fulfillmentMethod === "pickup" && styles.fulfillmentTextActive]}>Pickup</Text></Pressable></View>
        <View style={styles.estimate}><Ionicons name="time-outline" size={spacing[5]} color={colors.primaryStrong} /><View style={styles.estimateCopy}><Text style={styles.estimateTitle}>{fulfillmentMethod === "pickup" ? "Pickup directly from the store" : deliveryEstimate ? `Approximately ${deliveryEstimate}–${deliveryEstimate + 10} minutes` : "Estimated delivery time unavailable"}</Text>{fulfillmentMethod === "delivery" ? <Text style={styles.estimateDistance}>{deliveryDistance != null ? `Estimated distance: ${deliveryDistance.toFixed(1)} km` : "Estimated distance unavailable"}</Text> : null}<Text style={styles.estimatePrice}>{fulfillmentMethod === "pickup" ? "Pickup fee: Free" : `Estimated delivery fee: RM ${displayedDeliveryFee.toFixed(2)}`}</Text><Text style={styles.estimateDetail}>{fulfillmentMethod === "pickup" ? "Collect the order after payment confirmation." : "The estimate can change with distance, traffic, and store preparation time."}</Text></View></View>
        {fulfillmentMethod === "delivery" ? <><Text style={styles.section}>DELIVERY ADDRESS</Text><Pressable accessibilityRole="button" accessibilityLabel="Change delivery address" disabled={!!busy || !!paymentSession} onPress={() => router.push({ pathname: "/marketplace/delivery" as never, params: { returnTo: "cart" } } as never)} style={({ pressed }) => [styles.address, pressed && styles.pressed]}><View style={[styles.addressIcon, { backgroundColor: temporaryLocation ? colors.surfaceMuted : appearance.background }]}><Ionicons name={temporaryLocation ? "navigate" : appearance.icon} size={spacing[5]} color={temporaryLocation ? colors.textMuted : appearance.color} /></View><View style={styles.addressCopy}><Text style={styles.addressTitle}>{addressTitle}</Text><Text style={styles.addressText} numberOfLines={2}>{addressText}</Text></View><Ionicons name="chevron-forward" size={spacing[5]} color={colors.textSubtle} /></Pressable></> : null}
        {<><Text style={styles.section}>ORDER TIME</Text><Pressable accessibilityRole="button" disabled={!!busy || !!paymentSession} onPress={() => setTimeOpen(true)} style={styles.address}><Ionicons name="time-outline" size={spacing[5]} color={colors.primaryStrong}/><View style={styles.addressCopy}><Text style={styles.addressTitle}>{arrivalAt ? new Date(arrivalAt).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" }) : fulfillmentMethod === "pickup" ? "Collect as soon as possible" : "Deliver as soon as possible"}</Text><Text style={styles.addressText}>Malaysia time · Change arrival window</Text></View></Pressable></>}
        <Text style={styles.section}>PROMO CODE</Text><View style={styles.promoRow}><TextInput value={promo} onChangeText={setPromo} editable={!cart.applied_promo && !busy && !paymentSession} autoCapitalize="characters" placeholder="Enter promo code" placeholderTextColor={colors.textSubtle} style={styles.promoInput} /><Pressable disabled={!!busy || !!paymentSession} onPress={() => void (cart.applied_promo ? removePromo() : applyPromo())} style={({ pressed }) => [styles.apply, pressed && styles.primaryPressed]}><Text style={styles.applyText}>{cart.applied_promo ? "Remove" : "Apply"}</Text></Pressable></View>
        <View style={styles.paymentSectionTitle}><Text style={styles.section}>PAYMENT METHOD</Text></View>
        {!paymentSession ? <Pressable accessibilityRole="button" disabled={!!busy || !!cart.checkout_blocked_reason || new Set(cart.items.map((item) => item.product.store_id)).size > 1} onPress={() => void placeOrder()} style={[styles.apply, !!cart.checkout_blocked_reason && {opacity:.4}, { padding: spacing[4], marginTop: spacing[3] }]}><Text style={styles.applyText}>{cart.checkout_blocked_reason ? "Shop closed today" : new Set(cart.items.map((item) => item.product.store_id)).size > 1 ? "Check out one shop at a time" : "Continue to payment"}</Text></Pressable> : <Text style={styles.estimateDetail}>Your order is reserved while you complete payment. Finish this checkout before changing the basket.</Text>}
        {busy === "checkout" && !paymentSession ? <View style={styles.paymentLoading}><ActivityIndicator color={colors.primary} /><Text style={styles.paymentLoadingText}>Loading available Stripe payment methods…</Text></View> : null}
        {paymentSession ? <View style={styles.stripeFormShell}>
          {paymentSession.simulationAvailable ? <SandboxCardPayment total={displayedTotal} busy={busy === "simulate-payment"} onPay={() => void simulatePayment()} /> : stripePublishableKey ? <WebView
            source={{ uri: stripeFormUrl }}
            injectedJavaScript={`
              window.__ECOCHEF_STRIPE_CONFIG__ = ${JSON.stringify({ publishableKey: stripePublishableKey, clientSecret: paymentSession.clientSecret })};
              window.dispatchEvent(new Event("ecochef-stripe-config"));
              true;
            `}
            onMessage={(event) => {
              try {
                const payload = JSON.parse(event.nativeEvent.data) as { type?: string; height?: number; message?: string };
                if (payload.type === "height" && payload.height) setPaymentFormHeight(Math.min(Math.max(payload.height, 80), 720));
                if (payload.type === "error") setError(payload.message ?? "Stripe could not load the payment form.");
                if (payload.type === "confirmed") {
                  invalidateMarketplaceCartOptimisticUpdates();
                  setBusy("checkout");
                  void showCheckoutResult(paymentSession.orderId)
                    .finally(() => { setBusy(undefined); setPaymentSession(undefined); });
                }
              } catch { setError("Stripe returned an invalid payment-form response."); }
            }}
            originWhitelist={["http://*", "https://*"]}
            domStorageEnabled
            scrollEnabled={false}
            setSupportMultipleWindows={false}
            containerStyle={{ flex: 0, height: paymentFormHeight }}
            style={[styles.stripeForm, { height: paymentFormHeight }]}
          /> : <Text style={styles.stripeConfigError}>Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to apps/mobile/.env to load the payment form.</Text>}
        </View> : null}
      </>}
    </ScrollView>
    <DeliveryTimeSheet visible={timeOpen} value={arrivalAt} deliveryFee={displayedDeliveryFee} loadAvailability={loadAvailability} onSelect={(value) => { setMarketplaceArrival(value); setArrivalAt(value); }} onClearCart={() => undefined} onClose={() => setTimeOpen(false)}/>
    <AppMessageModal visible={!!message} title={message?.title ?? "Marketplace"} message={message?.message ?? ""} tone={message?.tone} actionLabel={invoiceUrl ? "View Stripe invoice" : undefined} onAction={invoiceUrl ? () => { void Linking.openURL(invoiceUrl); } : undefined} onClose={() => { const success = message?.tone === "success"; setMessage(undefined); setInvoiceUrl(undefined); if (!success) return; if (params.returnTo === "shopping") { requestShoppingReturn(params.date); router.replace({ pathname: "/(tabs)/plan", params: params.date ? { date: params.date } : {} }); } else router.replace("/(tabs)/marketplace"); }} />
  </View>;
}

function Row({ label, value, green, total }: { label: string; value: number; green?: boolean; total?: boolean }) { return <View style={styles.row}><Text style={[styles.rowLabel, total && styles.total]}>{label}</Text><Text style={[styles.rowValue, green && styles.green, total && styles.total]}>RM {Number(value).toFixed(2)}</Text></View>; }
function SandboxCardPayment({ total, busy, onPay }: { total: number; busy: boolean; onPay: () => void }) { return <View><View style={styles.cardMethod}><View style={styles.cardMethodIcon}><Ionicons name="card-outline" size={spacing[6]} color={colors.primaryStrong} /></View><View style={styles.cardMethodCopy}><Text style={styles.cardMethodTitle}>Card payment</Text><Text style={styles.cardMethodText}>Processed by Stripe sandbox · no details required</Text></View><Ionicons name="checkmark-circle" size={spacing[5]} color={colors.primaryStrong} /></View><View style={styles.cardPreview}><Text style={styles.cardPreviewLabel}>STRIPE TEST CARD</Text><Text style={styles.cardPreviewValue}>Visa  •••• 4242</Text><View style={styles.cardPreviewRow}><Text style={styles.cardPreviewSmall}>Successful test payment</Text><Ionicons name="shield-checkmark-outline" size={spacing[5]} color={colors.primaryStrong} /></View></View><Pressable accessibilityRole="button" disabled={busy} onPress={onPay} style={({ pressed }) => [styles.payButton, (pressed || busy) && styles.primaryPressed]}>{busy ? <ActivityIndicator size="small" color={colors.surface} /> : <><Ionicons name="lock-closed-outline" size={spacing[5]} color={colors.surface} /><Text style={styles.payButtonText}>Pay RM {total.toFixed(2)}</Text></>}</Pressable></View>; }
const textSize = typography.mobile.size; const textWeight = typography.weight;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas }, content: { paddingHorizontal: spacing[4] }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.consumerCanvas }, storeHeader: { flexDirection: "row", alignItems: "center" }, back: { width: spacing[10], height: spacing[10], alignItems: "center", justifyContent: "center", borderRadius: spacing[5], backgroundColor: colors.surface }, storeName: { flex: 1, color: colors.text, fontSize: textSize.secondaryTextHeavy, fontWeight: textWeight.bold, textAlign: "center" }, headerSpace: { width: spacing[10] }, orderSummaryTitle: { marginTop: spacing[6], marginBottom: spacing[3], color: colors.text, fontSize: textSize.bodyTextHeavy, fontWeight: textWeight.bold }, section: { marginTop: spacing[5], marginBottom: spacing[2], color: colors.textMuted, fontSize: textSize.caption, fontWeight: textWeight.bold },
  group: { overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderRadius: spacing[4], backgroundColor: colors.surface }, inlineTotals: { paddingVertical: spacing[3], paddingHorizontal: spacing[1] }, fulfillmentTabs: { flexDirection: "row", gap: spacing[2] }, fulfillmentTab: { minHeight: spacing[12], flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[2], borderWidth: 1, borderColor: colors.border, borderRadius: spacing[3], backgroundColor: colors.surface }, fulfillmentTabActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, fulfillmentText: { color: colors.textMuted, fontSize: textSize.secondaryInteraction, fontWeight: textWeight.semibold }, fulfillmentTextActive: { color: colors.primaryStrong, fontWeight: textWeight.bold }, estimate: { minHeight: spacing[16] + spacing[2], flexDirection: "row", alignItems: "center", gap: spacing[3], marginTop: spacing[2], padding: spacing[3], borderWidth: 1, borderColor: colors.primaryBorder, borderRadius: spacing[4], backgroundColor: colors.primarySoft }, estimateCopy: { flex: 1 }, estimateTitle: { color: colors.primaryStrong, fontSize: textSize.secondaryInteraction, fontWeight: textWeight.bold }, estimateDistance: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption, fontWeight: textWeight.semibold }, estimatePrice: { marginTop: spacing[1], color: colors.text, fontSize: textSize.caption, fontWeight: textWeight.bold }, estimateDetail: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption, lineHeight: spacing[4] },
  address: { minHeight: spacing[16] + spacing[2], flexDirection: "row", alignItems: "center", gap: spacing[3], padding: spacing[3], borderWidth: 1, borderColor: colors.border, borderRadius: spacing[4], backgroundColor: colors.surface }, addressIcon: { width: spacing[10], height: spacing[10], alignItems: "center", justifyContent: "center", borderRadius: spacing[3] }, addressCopy: { flex: 1 }, addressTitle: { color: colors.text, fontSize: textSize.secondaryInteraction, fontWeight: textWeight.bold }, addressText: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption, lineHeight: spacing[4] },
  promoRow: { flexDirection: "row", gap: spacing[2] }, promoInput: { flex: 1, height: spacing[12], paddingHorizontal: spacing[3], borderWidth: 1, borderColor: colors.border, borderRadius: spacing[3], backgroundColor: colors.surface, color: colors.text, fontSize: textSize.secondaryInteraction }, apply: { minWidth: spacing[16] + spacing[3], alignItems: "center", justifyContent: "center", borderRadius: spacing[3], backgroundColor: colors.primary }, applyText: { color: colors.surface, fontSize: textSize.caption, fontWeight: textWeight.bold }, paymentSectionTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, paymentLoading: { minHeight: spacing[16], flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[3], marginTop: spacing[2], borderWidth: 1, borderColor: colors.border, borderRadius: spacing[4], backgroundColor: colors.surface }, paymentLoadingText: { color: colors.textMuted, fontSize: textSize.caption }, testBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: spacing[2], overflow: "hidden", backgroundColor: colors.surface, color: colors.primaryStrong, fontSize: typography.mobile.rawSize.s9, fontWeight: textWeight.bold },
  stripeFormShell: { overflow: "hidden", marginTop: spacing[2], borderWidth: 1, borderColor: colors.border, borderRadius: spacing[4], backgroundColor: colors.surface, padding: spacing[3] }, stripeForm: { backgroundColor: colors.surface }, stripeConfigError: { padding: spacing[3], color: colors.danger, fontSize: textSize.caption, lineHeight: spacing[5], textAlign: "center" },
  cardMethod: { minHeight: spacing[12], flexDirection: "row", alignItems: "center", gap: spacing[3] }, cardMethodIcon: { width: spacing[10], height: spacing[10], alignItems: "center", justifyContent: "center", borderRadius: spacing[3], backgroundColor: colors.primarySoft }, cardMethodCopy: { flex: 1 }, cardMethodTitle: { color: colors.text, fontSize: textSize.secondaryInteraction, fontWeight: textWeight.bold }, cardMethodText: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption }, cardPreview: { gap: spacing[2], marginTop: spacing[3], padding: spacing[3], borderWidth: 1, borderColor: colors.border, borderRadius: spacing[3], backgroundColor: colors.surfaceMuted }, cardPreviewLabel: { color: colors.textSubtle, fontSize: typography.mobile.rawSize.s9, fontWeight: textWeight.bold }, cardPreviewValue: { color: colors.textMuted, fontSize: textSize.bodyInteraction, letterSpacing: 1 }, cardPreviewRow: { flexDirection: "row", justifyContent: "space-between" }, cardPreviewSmall: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption },
  payButton: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[2], marginTop: spacing[3], borderRadius: spacing[3], backgroundColor: colors.primary }, payButtonText: { color: colors.surface, fontSize: textSize.secondaryInteraction, fontWeight: textWeight.bold },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing[2] }, rowLabel: { color: colors.textMuted, fontSize: textSize.secondaryInteraction }, rowValue: { color: colors.text, fontSize: textSize.secondaryInteraction, fontWeight: textWeight.bold }, divider: { marginTop: spacing[3], borderTopWidth: 1, borderColor: colors.border }, total: { color: colors.text, fontSize: textSize.secondaryTextHeavy, fontWeight: textWeight.bold }, green: { color: colors.primaryStrong },
  primaryPressed: { backgroundColor: colors.primaryStrong }, error: { marginTop: spacing[3], padding: spacing[3], borderRadius: spacing[3], backgroundColor: colors.dangerSoft }, errorText: { color: colors.danger, fontSize: textSize.caption, textAlign: "center" }, empty: { alignItems: "center", marginTop: spacing[16] }, emptyTitle: { marginTop: spacing[3], color: colors.text, fontSize: textSize.secondaryTextHeavy, fontWeight: textWeight.bold }, emptyCopy: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption }, shopLink: { marginTop: spacing[3], color: colors.primaryStrong, fontSize: textSize.secondaryInteraction, fontWeight: textWeight.bold }, pressed: { opacity: 0.7 },
});
