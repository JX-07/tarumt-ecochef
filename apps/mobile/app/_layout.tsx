import * as ScreenOrientation from "expo-screen-orientation";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { AuthProvider } from "../src/features/auth/auth-provider";
import { PushNotificationBridge } from "../src/features/notifications/push-notification-bridge";
import { VerifiedPurchaseReviewPrompt } from "../src/features/marketplace/verified-purchase-review-prompt";
import { SharedVoucherPopup } from "../src/features/marketplace/shared-voucher-popup";

export default function RootLayout() {
  const [voucherBusy, setVoucherBusy] = useState(true);
  useEffect(() => {
    if (Platform.OS === "web") return;
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );
  }, []);

  return (
    <AuthProvider>
      <PushNotificationBridge />
      <SharedVoucherPopup onVisibilityChange={setVoucherBusy}/>
      <VerifiedPurchaseReviewPrompt blocked={voucherBusy}/>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="marketplace" options={{ animation: "none" }} />
      </Stack>
    </AuthProvider>
  );
}
