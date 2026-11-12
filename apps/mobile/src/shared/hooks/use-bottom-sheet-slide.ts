import { useEffect, useRef } from "react";
import { Animated, useWindowDimensions } from "react-native";

/** Slides sheet content while the containing Modal fades its backdrop. */
export function useBottomSheetSlide(visible: boolean) {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(height);
    const animation = Animated.timing(translateY, {
      toValue: 0,
      duration: 240,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [height, translateY, visible]);

  return { transform: [{ translateY }] };
}
