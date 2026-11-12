import { router } from "expo-router";

type ReplaceTarget = Parameters<typeof router.replace>[0];

/** Navigate back when history exists, otherwise return to a stable app route. */
export function goBackOrReplace(fallback: ReplaceTarget) {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallback);
}
