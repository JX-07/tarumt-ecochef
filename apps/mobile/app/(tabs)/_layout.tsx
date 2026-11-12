import { Text } from "../../src/shared/components/themed-text";
import { palette, typography } from "@ecochef/design-tokens";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useEffect, useRef, type ComponentProps } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../src/features/auth/auth-provider";
import { AppLoadingScreen } from "../../src/features/auth/screens/app-loading-screen";

const GREEN = palette.c12ad55;
const AnimatedView = Animated.createAnimatedComponent(View);
const visibleRoutes = ["index", "recipes", "scan", "plan", "marketplace"];
const labels: Record<string, string> = { index: "Home", recipes: "Recipes", scan: "", plan: "Plan", marketplace: "Market" };
type TabRoute = { key: string; name: string; params?: object };
type CurrentTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];
type CompatibleTabBarProps = CurrentTabBarProps & {
  emitter?: { emit: (event: { type: "tabPress" | "tabLongPress"; target: string; canPreventDefault?: true }) => { defaultPrevented?: boolean } };
  navigateToTab?: (routeKey: string) => void;
};

function TabIcon({ route, focused }: { route: string; focused: boolean }) {
  const color = focused ? palette.cffffff : palette.c96a1b0;
  if (route === "recipes") return <MaterialCommunityIcons name="chef-hat" color={color} size={22} />;
  if (route === "scan") return <Ionicons name="camera-outline" color={palette.cffffff} size={25} />;
  if (route === "plan") return <Ionicons name={focused ? "calendar" : "calendar-outline"} color={color} size={21} />;
  if (route === "marketplace") return <Ionicons name={focused ? "bag-handle" : "bag-handle-outline"} color={color} size={21} />;
  return <Ionicons name={focused ? "home" : "home-outline"} color={color} size={21} />;
}

function AnimatedTab({ route, focused, onPress, onLongPress }: { route: string; focused: boolean; onPress: () => void; onLongPress: () => void }) {
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => { Animated.spring(progress, { toValue: focused ? 1 : 0, useNativeDriver: true, speed: 18, bounciness: 7 }).start(); }, [focused, progress]);
  const center = route === "scan";
  return <Pressable accessibilityRole="button" accessibilityState={focused ? { selected: true } : {}} accessibilityLabel={center ? "Scan" : labels[route]} onPress={onPress} onLongPress={onLongPress} style={[styles.tabPressable, center && styles.centerSlot]}>
    <AnimatedView style={[styles.activeShape, center && styles.scanShape, { opacity: center ? 1 : progress, transform: [{ scale: center ? progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) : progress.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }) }] }]} />
    <View style={styles.tabContent}><TabIcon route={route} focused={focused || center} />{!center && <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{labels[route]}</Text>}</View>
  </Pressable>;
}

function FloatingTabBar(props: CompatibleTabBarProps) {
  const { state, emitter, navigateToTab } = props;
  const insets = useSafeAreaInsets();
  const protectedBottomGap = Math.max(insets.bottom + 12, 24);
  return <View pointerEvents="box-none" style={[styles.floatingArea, { bottom: protectedBottomGap }]}><View style={styles.bar}><View pointerEvents="none" style={styles.glassHighlight} />
    {state.routes.filter((route) => visibleRoutes.includes(route.name)).map((route) => {
      const index = state.routes.findIndex((candidate) => candidate.key === route.key);
      const focused = state.index === index;
      return <AnimatedTab key={route.key} route={route.name} focused={focused} onPress={() => {
        const event = emitter?.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (!event?.defaultPrevented) navigateToTab?.(route.key);
      }} onLongPress={() => {
        emitter?.emit({ type: "tabLongPress", target: route.key });
      }} />;
    })}
  </View></View>;
}

export default function ConsumerTabs() {
  const { status } = useAuth();
  if (status === "loading") return <AppLoadingScreen />;
  if (status === "signed_out") return <Redirect href="/(auth)/sign-in" />;

  return <Tabs id="consumer-tabs" tabBar={(props) => <FloatingTabBar {...props} />} screenOptions={{ headerShown: false }}>
    <Tabs.Screen name="index" options={{ title: "Home" }} />
    <Tabs.Screen name="recipes" options={{ title: "Recipes" }} />
    <Tabs.Screen name="scan" options={{ title: "Scan" }} />
    <Tabs.Screen name="plan" options={{ title: "Plan" }} />
    <Tabs.Screen name="marketplace" options={{ title: "Market" }} />
    <Tabs.Screen name="inventory" options={{ href: null }} />
    <Tabs.Screen name="profile" options={{ href: null }} />
  </Tabs>;
}

const styles = StyleSheet.create({
  floatingArea: { position: "absolute", left: 13, right: 13, height: 72, zIndex: 30 },
  bar: { flex: 1, flexDirection: "row", alignItems: "center", overflow: "visible", paddingHorizontal: 7, paddingVertical: 6, borderWidth: 1, borderColor: palette.crgba_255_255_255_0_96, borderRadius: 20, backgroundColor: palette.crgba_248_251_249_0_94, shadowColor: palette.c173c2e, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 18, elevation: 14 },
  glassHighlight: { position: "absolute", left: 8, right: 8, top: 4, height: 22, borderRadius: 15, borderTopWidth: 1, borderColor: palette.crgba_255_255_255_0_98, backgroundColor: palette.crgba_255_255_255_0_32 },
  tabPressable: { flex: 1, height: 58, alignItems: "center", justifyContent: "center" }, centerSlot: { marginHorizontal: 3, transform: [{ translateY: -16 }] },
  activeShape: { ...StyleSheet.absoluteFill, borderRadius: 16, backgroundColor: GREEN },
  scanShape: { left: 4, right: 4, top: 1, bottom: 1, borderWidth: 4, borderColor: palette.cffffff, borderRadius: 15, shadowColor: GREEN, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.32, shadowRadius: 7, elevation: 8 },
  tabContent: { alignItems: "center", justifyContent: "center", gap: 3 },
  tabLabel: { color: palette.c98a3b2, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.bold }, tabLabelActive: { color: palette.cffffff },
});
