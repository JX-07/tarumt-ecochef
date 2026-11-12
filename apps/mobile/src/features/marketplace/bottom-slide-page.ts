import { router } from "expo-router";
import { useCallback, useRef } from "react";
import { Animated, Easing, useWindowDimensions } from "react-native";

export const BOTTOM_SLIDE_ENTER_MS = 30;
export const BOTTOM_SLIDE_EXIT_MS = 300;

/** Shared reverse transition for every marketplace page presented from below. */
export function useBottomSlidePageExit(fallbackPath?: string) {
  const { height: screenHeight } = useWindowDimensions();
  const exitOffset = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(exitOffset, {
      toValue: screenHeight,
      duration: BOTTOM_SLIDE_EXIT_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) { closing.current = false; return; }
      if (router.canGoBack()) router.back();
      else if (fallbackPath) router.replace(fallbackPath as never);
      else router.replace("/(tabs)/marketplace");
    });
  }, [exitOffset, fallbackPath, screenHeight]);

  return { close, animatedStyle: { transform: [{ translateY: exitOffset }] } };
}
