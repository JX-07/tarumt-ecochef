import { apiBaseUrl } from "../../lib/api-url";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useSegments } from "expo-router";
import type { MarketplaceReviewPrompt, MarketplaceReviewPromptList } from "@ecochef/contracts";
import { createMobileApi } from "../../lib/api";
import { useAuth } from "../auth/auth-provider";
import { ProductReviewForm } from "./components/product-review-form";

/** A gentle completed-purchase reminder on Home, outside task-specific screens. */
export function VerifiedPurchaseReviewPrompt({ blocked }: { blocked: boolean }) {
  const { status, user } = useAuth();
  const segments = useSegments() as string[];
  const onHome = segments[0] === "(tabs)" && (segments[1] === "index" || segments.length === 1);
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [consumer, setConsumer] = useState(false);
  const [target, setTarget] = useState<MarketplaceReviewPrompt>();
  const dismissed = useRef(new Set<string>());
  const lastPoll = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) =>
      setForeground(next === "active"),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let active = true;
    setConsumer(false);
    setTarget(undefined);
    dismissed.current.clear();
    lastPoll.current = 0;
    if (status === "signed_in" && user) {
      // This endpoint is restricted to consumer accounts by the API.
      api
        .getMyConsumerProfile()
        .then(() => {
          if (active) setConsumer(true);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [api, status, user]);
  useEffect(() => {
    if (!onHome || !foreground) setTarget(undefined);
  }, [onHome, foreground]);
  useEffect(() => {
    if (!consumer || !user || !foreground || !onHome || blocked || target) return;
    let active = true;
    const poll = async () => {
      if (inFlight.current || Date.now() - lastPoll.current < 60000) return;
      inFlight.current = true;
      lastPoll.current = Date.now();
      try {
        const result = await api.getMarketplaceReviewPrompts<MarketplaceReviewPromptList>();
        if (!active) return;
        const next = result.items.find(
          (item) => !item.reviewed && !dismissed.current.has(item.product_id),
        );
        if (next) {
          dismissed.current.add(next.product_id);
          setTarget(next);
        }
      } catch {
        /* Reviews remain available from purchase history while offline. */
      } finally {
        inFlight.current = false;
      }
    };
    const initial = setTimeout(() => void poll(), 1500);
    const interval = setInterval(() => void poll(), 60000);
    return () => {
      active = false;
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [api, consumer, user, foreground, onHome, blocked, target]);
  if (!consumer || !user || !foreground || !onHome || blocked) return null;
  return (
    <ProductReviewForm
      productId={target?.product_id}
      productName={target?.product_name}
      onClose={() => setTarget(undefined)}
    />
  );
}
