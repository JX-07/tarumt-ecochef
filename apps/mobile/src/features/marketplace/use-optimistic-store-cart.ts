import type { MarketplaceCart, MarketplaceProduct } from "@ecochef/contracts";
import { useEffect, useRef } from "react";

type CartApi = {
  setMarketplaceCartQuantity<Response>(
    productId: string,
    quantity: number,
    cartId?: string,
  ): Promise<Response>;
  removeMarketplaceCartItem<Response>(productId: string): Promise<Response>;
};
type ProductSync = {
  desired: number;
  confirmed: number;
  price: number;
  inFlight: boolean;
  pending?: Promise<void>;
  cancelled?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  visualCommitTimer?: ReturnType<typeof setTimeout>;
};
type Callbacks = {
  updateProduct: (productId: string, quantity: number) => void;
  updateSummary: (countDelta: number, totalDelta: number) => void;
  applyServerCart: (cart: MarketplaceCart) => void;
  showError: (message: string) => void;
};

const CART_SYNC_IDLE_MS = 2_000;
const optimisticCartResetters = new Set<() => void>();
const optimisticCartFlushers = new Set<() => Promise<void>>();

export async function flushMarketplaceCartOptimisticUpdates() {
  await Promise.all([...optimisticCartFlushers].map((flush) => flush()));
}

/** Cancel delayed catalogue writes before checkout retires the active cart. */
export function invalidateMarketplaceCartOptimisticUpdates() {
  optimisticCartResetters.forEach((reset) => reset());
}

/**
 * Keeps quick-add tactile by rendering locally first. Every tap resets a
 * two-second idle timer, so rapid changes produce one request containing only
 * the user's final quantity.
 */
export function useOptimisticStoreCart(api: CartApi, callbacks: Callbacks) {
  const callbacksRef = useRef(callbacks);
  const productsRef = useRef(new Map<string, ProductSync>());
  const cartIdRef = useRef<string | undefined>(undefined);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const reset = () => {
      productsRef.current.forEach((state) => {
        state.cancelled = true;
        if (state.timer) clearTimeout(state.timer);
        if (state.visualCommitTimer) clearTimeout(state.visualCommitTimer);
      });
      productsRef.current.clear();
    };
    optimisticCartResetters.add(reset);
    const flushAll = async () => {
      await Promise.all([...productsRef.current.keys()].map((id) => flush(id)));
    };
    optimisticCartFlushers.add(flushAll);
    return () => {
      optimisticCartFlushers.delete(flushAll);
      optimisticCartResetters.delete(reset);
      reset();
    };
  }, []);

  const flush = async (productId: string) => {
    const state = productsRef.current.get(productId);
    if (!state || state.cancelled) return;
    if (state.pending) {
      await state.pending;
      if (state.desired !== state.confirmed) await flush(productId);
      return;
    }
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    if (state.desired === state.confirmed) return;
    const pending = performFlush(productId, state);
    state.pending = pending;
    try {
      await pending;
    } finally {
      state.pending = undefined;
    }
    if (!state.cancelled && state.desired !== state.confirmed) await flush(productId);
  };

  const performFlush = async (productId: string, state: ProductSync) => {
    state.inFlight = true;
    state.timer = undefined;
    const quantity = state.desired;
    try {
      const cart =
        quantity > 0
          ? await api.setMarketplaceCartQuantity<MarketplaceCart>(
              productId,
              quantity,
              cartIdRef.current,
            )
          : await api.removeMarketplaceCartItem<MarketplaceCart>(productId);
      if (state.cancelled) return;
      state.confirmed = quantity;
      if (state.desired === quantity) {
        callbacksRef.current.updateProduct(productId, quantity);
        callbacksRef.current.applyServerCart(cart);
      }
    } catch (reason) {
      if (state.cancelled) return;
      callbacksRef.current.showError(
        reason instanceof Error ? reason.message : "The cart could not be updated.",
      );
      if (state.desired === quantity) {
        const rollback = state.confirmed;
        const delta = rollback - state.desired;
        state.desired = rollback;
        if (state.visualCommitTimer) clearTimeout(state.visualCommitTimer);
        callbacksRef.current.updateProduct(productId, rollback);
        callbacksRef.current.updateSummary(delta, delta * state.price);
      }
      throw reason;
    } finally {
      state.inFlight = false;
    }
  };

  const seed = (products: MarketplaceProduct[], cartId?: string) => {
    cartIdRef.current = cartId;
    const next = new Map(productsRef.current);
    products.forEach((product) => {
      const current = productsRef.current.get(product.id);
      if (current && (current.inFlight || current.timer || current.desired !== current.confirmed)) {
        callbacksRef.current.updateProduct(product.id, current.desired);
      }
      next.set(
        product.id,
        current && (current.inFlight || current.timer || current.desired !== current.confirmed)
          ? current
          : {
              desired: product.cart_quantity,
              confirmed: product.cart_quantity,
              price: Number(product.price),
              inFlight: false,
              cancelled: false,
            },
      );
    });
    productsRef.current = next;
  };

  const changeQuantity = (product: MarketplaceProduct, requestedQuantity: number) => {
    const state = productsRef.current.get(product.id) ?? {
      desired: product.cart_quantity,
      confirmed: product.cart_quantity,
      price: Number(product.price),
      inFlight: false,
      cancelled: false,
    };
    productsRef.current.set(product.id, state);
    const quantity = Math.max(0, Math.min(product.stock_quantity, requestedQuantity));
    if (quantity === state.desired) return;
    const delta = quantity - state.desired;
    state.desired = quantity;
    state.price = Number(product.price);
    callbacksRef.current.updateSummary(delta, delta * state.price);
    if (state.visualCommitTimer) clearTimeout(state.visualCommitTimer);
    callbacksRef.current.updateProduct(product.id, quantity);
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      void flush(product.id).catch(() => undefined);
    }, CART_SYNC_IDLE_MS);
  };

  return { seed, changeQuantity };
}
