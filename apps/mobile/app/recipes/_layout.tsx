import { Redirect, Stack } from "expo-router";

import { useAuth } from "../../src/features/auth/auth-provider";
import { AppLoadingScreen } from "../../src/features/auth/screens/app-loading-screen";

export default function RecipeRoutesLayout() {
  const { status } = useAuth();
  if (status === "loading") return <AppLoadingScreen />;
  if (status === "signed_out") return <Redirect href="/(auth)/sign-in" />;

  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="new" options={{ animation: "none" }} />
    <Stack.Screen name="[recipeId]" options={{ animation: "none" }} />
    <Stack.Screen name="[recipeId]/edit" options={{ animation: "none" }} />
    <Stack.Screen name="[recipeId]/cook" options={{ animation: "fade" }} />
  </Stack>;
}
