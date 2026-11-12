import { router } from "expo-router";
import { flushMarketplaceCartOptimisticUpdates } from "./use-optimistic-store-cart";

type CartNavigationParams = {
  addressId?: string;
  returnTo?: string;
  date?: string;
};

let cartNavigationPending = false;
let cartNavigationTimeout: ReturnType<typeof setTimeout> | undefined;

export async function openMarketplaceCart(params: CartNavigationParams = {}) {
  if (cartNavigationPending) return;
  cartNavigationPending = true;
  try {
    await flushMarketplaceCartOptimisticUpdates();
    router.push({ pathname: "/marketplace/carts" as never, params } as never);
    cartNavigationTimeout = setTimeout(releaseMarketplaceCartNavigation, 1500);
  } catch (error) {
    releaseMarketplaceCartNavigation();
  }
}

export function releaseMarketplaceCartNavigation() {
  cartNavigationPending = false;
  if (cartNavigationTimeout) clearTimeout(cartNavigationTimeout);
  cartNavigationTimeout = undefined;
}
