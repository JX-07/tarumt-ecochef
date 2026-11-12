import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../src/features/auth/auth-provider";
import { AppLoadingScreen } from "../../src/features/auth/screens/app-loading-screen";

export default function MarketplaceRoutesLayout() {
  const { status } = useAuth();
  if (status === "loading") return <AppLoadingScreen />;
  if (status === "signed_out") return <Redirect href="/(auth)/sign-in" />;
  return <Stack screenOptions={{ headerShown: false, animationDuration: 160 }}>
    <Stack.Screen name="[storeId]" options={{ animation: "simple_push" }} />
    <Stack.Screen name="[storeId]/products/[productId]" options={{ animation: "slide_from_bottom", animationDuration: 30, gestureDirection: "vertical", animationMatchesGesture: true, presentation: "transparentModal", contentStyle: { backgroundColor: "transparent" } }} />
    <Stack.Screen name="[storeId]/info" options={{ animation: "slide_from_bottom", animationDuration: 30, gestureDirection: "vertical", presentation: "transparentModal", contentStyle: { backgroundColor: "transparent" } }} />
    <Stack.Screen name="[storeId]/reviews" options={{ animation: "slide_from_bottom", animationDuration: 30, gestureDirection: "vertical", presentation: "transparentModal", contentStyle: { backgroundColor: "transparent" } }} />
    <Stack.Screen name="[storeId]/promotions/[promotionId]" options={{ animation: "slide_from_bottom", animationDuration: 30, gestureDirection: "vertical", presentation: "transparentModal", contentStyle: { backgroundColor: "transparent" } }} />
    <Stack.Screen name="category" options={{ animation: "slide_from_right" }} />
    <Stack.Screen name="products/[category]" options={{ animation: "slide_from_right" }} />
    <Stack.Screen name="delivery" options={{ animation: "simple_push" }} />
    <Stack.Screen name="cart" options={{ animation: "slide_from_right" }} />
    <Stack.Screen name="reviews" options={{ animation: "slide_from_right" }} />
    <Stack.Screen name="order" options={{ animation: "slide_from_right", gestureEnabled: false }} />
    <Stack.Screen name="chat" options={{ animation: "slide_from_right" }} />
  </Stack>;
}
