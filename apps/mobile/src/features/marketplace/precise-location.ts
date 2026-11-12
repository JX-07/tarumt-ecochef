import * as Location from "expo-location";

const TARGET_ACCURACY_METRES = 25;
const MAX_ACCEPTABLE_ACCURACY_METRES = 75;
const FIX_TIMEOUT_MS = 2500;

export async function getPreciseMarketplacePosition() {
  if (typeof Location.getCurrentPositionAsync !== "function") {
    throw new Error("Location is unavailable in this app build. Please update the app and try again.");
  }
  const initial = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
    mayShowUserSettingsDialog: true,
  });
  if (initial.mocked || initial.coords.accuracy == null || initial.coords.accuracy <= TARGET_ACCURACY_METRES) return initial;

  if (typeof Location.watchPositionAsync !== "function") return initial;

  return new Promise<Location.LocationObject>((resolve) => {
    let best = initial;
    let settled = false;
    let subscription: Location.LocationSubscription | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      resolve(best);
    };
    const timer = setTimeout(finish, FIX_TIMEOUT_MS);
    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Highest, distanceInterval: 0, timeInterval: 500 },
      (position) => {
        if ((position.coords.accuracy ?? Number.POSITIVE_INFINITY) < (best.coords.accuracy ?? Number.POSITIVE_INFINITY)) best = position;
        if ((best.coords.accuracy ?? Number.POSITIVE_INFINITY) <= TARGET_ACCURACY_METRES) finish();
      },
    ).then((nextSubscription) => {
      subscription = nextSubscription;
      if (settled) subscription.remove();
    }).catch(finish);
  }).then((position) => {
    if (position.coords.accuracy != null && position.coords.accuracy > MAX_ACCEPTABLE_ACCURACY_METRES) {
      throw new Error(`Your location is only accurate to about ${Math.round(position.coords.accuracy)} m. Enable Precise Location or move near a window, then try again.`);
    }
    return position;
  });
}
