import { Redirect } from "expo-router";

import { useAuth } from "../src/features/auth/auth-provider";
import { AppLoadingScreen } from "../src/features/auth/screens/app-loading-screen";

export default function IndexRoute() {
  const { status } = useAuth();
  if (status === "loading") return <AppLoadingScreen />;
  return <Redirect href={status === "signed_in" ? "/(tabs)" : "/(auth)/sign-in"} />;
}
