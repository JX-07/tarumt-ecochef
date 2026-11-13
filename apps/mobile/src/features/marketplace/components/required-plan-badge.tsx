import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing } from "@ecochef/design-tokens";
import type { MarketplaceProduct } from "@ecochef/contracts";
import { useSyncExternalStore } from "react";
import { useAuth } from "../../auth/auth-provider";
import { matchesPlanIngredient, type PlanIngredient } from "../plan-shopping";

let requirements: { userId?: string; ingredients: PlanIngredient[] } = { ingredients: [] };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => requirements;

export function setPlanShoppingRequirements(
  userId: string | undefined,
  ingredients: PlanIngredient[],
) {
  requirements = { userId, ingredients };
  listeners.forEach((listener) => listener());
}

export function RequiredPlanBadge({ product }: { product: MarketplaceProduct }) {
  const { user } = useAuth();
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (
    !user ||
    current.userId !== user.uid ||
    !current.ingredients.some((ingredient) => matchesPlanIngredient(product, ingredient))
  )
    return null;
  return (
    <>
      <MaterialCommunityIcons
        accessible
        accessibilityLabel="Required ingredient in your selected plan"
        name="clipboard-list-outline"
        size={spacing[4]}
        color={colors.ratingStar}
      />{" "}
    </>
  );
}
