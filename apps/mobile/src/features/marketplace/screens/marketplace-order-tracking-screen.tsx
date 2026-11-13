import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplaceCheckoutStatus } from "@ecochef/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { useAuth } from "../../auth/auth-provider";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

const statusRank: Record<string, number> = {
  placed: 0,
  pending: 0,
  preparing: 1,
  ready: 2,
  completed: 3,
};

export function MarketplaceOrderTrackingScreen() {
  const params = useLocalSearchParams<{
    orderId: string;
    fulfillment?: string;
    estimate?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const pickup = params.fulfillment === "pickup";
  const estimate = Math.max(10, Number(params.estimate) || 30);
  const [orderStatus, setOrderStatus] = useState("pending_payment");
  const [paymentStatus, setPaymentStatus] = useState("");

  useEffect(() => {
    if (!params.orderId) return;
    let active = true;
    const refresh = async () => {
      try {
        const result = await api.getMarketplaceCheckoutStatus<MarketplaceCheckoutStatus>(
          params.orderId,
        );
        if (active) {
          setOrderStatus(result.order_status);
          setPaymentStatus(result.payment_status);
        }
      } catch {
        /* Keep the last visible status while temporarily offline. */
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [api, params.orderId]);

  const backendStage = statusRank[orderStatus] ?? 0;
  const activeStage = paymentStatus === "paid" && orderStatus !== "cancelled" ? backendStage : -1;
  const pickedUp = orderStatus === "completed";
  const deliverySteps = [
    ["checkmark-circle", "Order confirmed", "Your payment was successful."],
    ["restaurant", "Preparing your order", "The shop is packing your items."],
    ["bag-check", "Ready for handover", "The shop has prepared your items."],
    ["location", "Delivered", "The shop has confirmed delivery of your order."],
  ] as const;
  const pickupSteps = [
    ["checkmark-circle", "Order confirmed", "Your payment was successful."],
    ["restaurant", "Preparing your order", "The shop is preparing your pickup."],
    ["bag-check", "Ready for pickup", "You can now collect your order from the shop."],
  ] as const;
  const steps = pickup ? pickupSteps : deliverySteps;
  const title =
    orderStatus === "cancelled"
      ? "Order cancelled"
      : paymentStatus !== "paid"
        ? "Confirming your payment"
        : pickedUp
          ? pickup
            ? "Pickup completed"
            : "Delivery completed"
          : pickup
            ? activeStage >= 2
              ? "Your order is ready"
              : "Pickup in progress"
            : "Track your delivery";

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + PAGE_TOP_GAP, paddingBottom: insets.bottom + spacing[8] },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerSpace} />
          <Text style={styles.headerTitle}>Order status</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close order tracking"
            style={styles.close}
            onPress={() => router.replace("/(tabs)/marketplace")}
          >
            <Ionicons name="close" size={spacing[6]} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.success}>
          <Ionicons name="checkmark-circle" size={spacing[8]} color={colors.success} />
          <View style={styles.successCopy}>
            <Text style={styles.successTitle}>
              {paymentStatus === "refunded"
                ? "Refund issued"
                : paymentStatus === "paid"
                  ? "Payment successful"
                  : "Checking payment status"}
            </Text>
            <Text style={styles.successText}>
              Order #{params.orderId?.slice(0, 8).toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons
              name={pickup ? "storefront" : "bicycle"}
              size={spacing[8]}
              color={colors.primaryStrong}
            />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {orderStatus === "cancelled"
              ? "The shop cancelled this order. Your refund was issued to your original payment method, and the items were returned to stock."
              : pickup
                ? pickedUp
                  ? "The shop has confirmed your completed pickup."
                  : activeStage >= 2
                    ? "The shop has marked your order as ready."
                    : "This page updates when the shop changes your order status."
                : pickedUp
                  ? "The shop has confirmed your completed delivery."
                  : `Initial delivery estimate: approximately ${estimate} minutes. This page updates when the shop confirms progress.`}
          </Text>
        </View>
        {orderStatus !== "cancelled" ? (
          <View style={styles.timeline}>
            {steps.map(([icon, label, detail], index) => {
              const complete = index <= activeStage || pickedUp;
              return (
                <View key={label} style={styles.step}>
                  <View style={styles.stepRail}>
                    <View style={[styles.stepDot, complete && styles.stepDotComplete]}>
                      <Ionicons
                        name={complete ? icon : "ellipse-outline"}
                        size={spacing[5]}
                        color={complete ? colors.surface : colors.textSubtle}
                      />
                    </View>
                    {index < steps.length - 1 ? (
                      <View
                        style={[styles.stepLine, index < activeStage && styles.stepLineComplete]}
                      />
                    ) : null}
                  </View>
                  <View style={styles.stepCopy}>
                    <Text style={[styles.stepTitle, complete && styles.stepTitleComplete]}>
                      {label}
                    </Text>
                    <Text style={styles.stepDetail}>{detail}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
        {pickup && activeStage >= 2 && !pickedUp ? (
          <View style={styles.pickupCard}>
            <Text style={styles.pickupTitle}>Ready for collection</Text>
            <Text style={styles.pickupText}>
              Collect your items from the shop. Your rating unlocks when the shop confirms handover.
            </Text>
          </View>
        ) : null}
        {pickedUp ? (
          <View style={styles.completed}>
            <Ionicons name="sparkles-outline" size={spacing[6]} color={colors.success} />
            <Text style={styles.completedText}>
              Your order has been marked complete by the shop.
            </Text>
          </View>
        ) : null}
        {orderStatus === "completed" && paymentStatus === "paid" ? (
          <Pressable
            style={styles.chatButton}
            onPress={() =>
              router.push({
                pathname: "/marketplace/reviews" as never,
                params: { orderId: params.orderId },
              })
            }
          >
            <Ionicons name="star-outline" size={spacing[5]} color={colors.ratingStar} />
            <Text style={styles.chatButtonText}>Rate your purchased items</Text>
          </Pressable>
        ) : null}
        {paymentStatus === "paid" ? (
          <Pressable
            style={styles.chatButton}
            onPress={() =>
              router.push({
                pathname: "/marketplace/chat" as never,
                params: { orderId: params.orderId },
              })
            }
          >
            <Ionicons name="chatbubbles-outline" size={spacing[5]} color={colors.primaryStrong} />
            <Text style={styles.chatButtonText}>Message shop</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.continueButton}
          onPress={() => router.replace("/(tabs)/marketplace")}
        >
          <Text style={styles.continueText}>Continue shopping</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const textSize = typography.mobile.size;
const textWeight = typography.weight;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  content: { paddingHorizontal: spacing[4] },
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing[5] },
  headerSpace: { width: spacing[10] },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: textSize.bodyTextHeavy,
    fontWeight: textWeight.bold,
    textAlign: "center",
  },
  close: {
    width: spacing[10],
    height: spacing[10],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[5],
    backgroundColor: colors.surface,
  },
  success: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: spacing[4],
    backgroundColor: colors.successSoft,
  },
  successCopy: { flex: 1 },
  successTitle: {
    color: colors.success,
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  successText: { marginTop: spacing[1], color: colors.textMuted, fontSize: textSize.caption },
  hero: { alignItems: "center", paddingVertical: spacing[8] },
  heroIcon: {
    width: spacing[16],
    height: spacing[16],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[8],
    backgroundColor: colors.primarySoft,
  },
  title: {
    marginTop: spacing[4],
    color: colors.text,
    fontSize: typography.mobile.rawSize.s25,
    fontWeight: textWeight.bold,
    textAlign: "center",
  },
  subtitle: {
    marginTop: spacing[2],
    maxWidth: 310,
    color: colors.textMuted,
    fontSize: textSize.secondaryInteraction,
    lineHeight: spacing[5],
    textAlign: "center",
  },
  timeline: {
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  step: { minHeight: spacing[16] + spacing[2], flexDirection: "row" },
  stepRail: { width: spacing[10], alignItems: "center" },
  stepDot: {
    width: spacing[8],
    height: spacing[8],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[4],
    backgroundColor: colors.surfaceMuted,
  },
  stepDotComplete: { backgroundColor: colors.primaryStrong },
  stepLine: { width: 2, flex: 1, backgroundColor: colors.border },
  stepLineComplete: { backgroundColor: colors.primary },
  stepCopy: { flex: 1, paddingLeft: spacing[2], paddingBottom: spacing[4] },
  stepTitle: {
    color: colors.textMuted,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  stepTitleComplete: { color: colors.text },
  stepDetail: {
    marginTop: spacing[1],
    color: colors.textMuted,
    fontSize: textSize.caption,
    lineHeight: spacing[5],
  },
  pickupCard: {
    gap: spacing[2],
    marginTop: spacing[4],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.marketBorder,
    borderRadius: spacing[4],
    backgroundColor: colors.marketSoft,
  },
  pickupTitle: {
    color: colors.text,
    fontSize: textSize.secondaryTextHeavy,
    fontWeight: textWeight.bold,
  },
  pickupText: { color: colors.textMuted, fontSize: textSize.caption, lineHeight: spacing[5] },
  slider: {
    height: 56,
    justifyContent: "center",
    overflow: "hidden",
    marginTop: spacing[2],
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
  },
  sliderText: {
    color: colors.textMuted,
    fontSize: textSize.caption,
    fontWeight: textWeight.bold,
    textAlign: "center",
  },
  sliderThumb: {
    position: "absolute",
    left: 4,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[6],
    backgroundColor: colors.primaryStrong,
  },
  completed: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: spacing[4],
    backgroundColor: colors.successSoft,
  },
  completedText: {
    flex: 1,
    color: colors.success,
    fontSize: textSize.secondaryInteraction,
    fontWeight: textWeight.bold,
  },
  chatButton: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    marginTop: spacing[5],
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: spacing[4],
    backgroundColor: colors.primarySoft,
  },
  chatButtonText: {
    color: colors.primaryStrong,
    fontSize: textSize.bodyInteraction,
    fontWeight: textWeight.bold,
  },
  continueButton: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing[3],
    borderRadius: spacing[4],
    backgroundColor: colors.primaryStrong,
  },
  continueText: {
    color: colors.surface,
    fontSize: textSize.bodyInteraction,
    fontWeight: textWeight.bold,
  },
});
