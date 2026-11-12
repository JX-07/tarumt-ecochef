import type { MarketplaceProduct } from "@ecochef/contracts";
import type { ShoppingListItem } from "../meal-planning/types";

export type PlanIngredient = { key: string; name: string; quantities: string[]; recipes: string[]; inKitchen: boolean };
const singular: Record<string, string> = { tomatoes: "tomato", potatoes: "potato", leaves: "leaf", berries: "berry" };
const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).map(word => singular[word] ?? (word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
export const ingredientKey = (name: string) => words(name).join(" ");

export function groupPlanIngredients(items: ShoppingListItem[]): PlanIngredient[] {
  const groups = new Map<string, PlanIngredient>();
  for (const item of items) {
    const key = ingredientKey(item.name);
    const existing = groups.get(key);
    if (!existing) groups.set(key, { key, name: item.name, quantities: item.in_kitchen ? [] : [item.quantity], recipes: item.in_kitchen ? [] : [item.recipe_title], inKitchen: item.in_kitchen });
    else {
      existing.inKitchen = existing.inKitchen && item.in_kitchen;
      if (!item.in_kitchen) { existing.quantities.push(item.quantity); if (!existing.recipes.includes(item.recipe_title)) existing.recipes.push(item.recipe_title); }
    }
  }
  return [...groups.values()].sort((a, b) => Number(a.inKitchen) - Number(b.inKitchen) || a.name.localeCompare(b.name));
}

/** Conservative name matches; prepared foods are not offered as raw ingredients. */
export function matchesPlanIngredient(product: MarketplaceProduct, ingredient: PlanIngredient): boolean {
  const needed = words(ingredient.name);
  const name = words(product.name);
  if (!needed.length || !needed.every(word => name.includes(word))) return false;
  const prepared = ["juice", "sauce", "soup", "cake", "biscuit", "jam", "flavour", "flavored", "flavoured", "candy", "drink", "powder", "oil", "paste", "puree", "flour", "syrup", "seasoning", "dried"];
  return !prepared.some(word => name.includes(word) && !needed.includes(word));
}

export function planQuantityLabel(quantities: string[]) {
  const totals = new Map<string, { amount: number; unit: string }>();
  const other: string[] = [];
  for (const quantity of quantities) {
    const parsed = quantity.trim().match(/^(\d+(?:\.\d+)?)\s*([^\d]*)$/);
    if (!parsed) { if (quantity.trim()) other.push(quantity); continue; }
    const unit = parsed[2].trim();
    const key = unit.toLowerCase();
    const current = totals.get(key);
    totals.set(key, { amount: (current?.amount ?? 0) + Number(parsed[1]), unit });
  }
  return [...totals.values()].map(value => `${Number(value.amount.toFixed(2))}${value.unit ? ` ${value.unit}` : ""}`).concat(other).join(" + ");
}

export function planCartQuantityLabel(products: MarketplaceProduct[], ingredient: PlanIngredient) {
  const quantities = products.filter(product => product.cart_quantity > 0 && matchesPlanIngredient(product, ingredient)).map(product => {
    const labels = [product.size?.trim(), product.unit_label?.trim()].filter((label): label is string => !!label);
    const size = labels.map(label => label.match(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|pcs?|pieces?|items?)$/i)).find(match => match != null);
    let amount = product.cart_quantity * (size ? Number(size[1]) : 1);
    let unit = size ? size[2].toLowerCase() : labels.some(label => /^(pcs?|pieces?|items?)$/i.test(label)) ? "pcs" : "items";
    if (size && /^(pcs?|pieces?|items?)$/.test(unit)) unit = "pcs";
    if (unit === "kg" || unit === "l") { amount *= 1000; unit = unit === "kg" ? "g" : "ml"; }
    return `${amount} ${unit}`;
  });
  return quantities.length ? planQuantityLabel(quantities) : "0 items";
}

export function planDateRange(date: string, range: "day" | "week" | "month") {
  const start = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(start.getTime())) throw new Error("Choose a valid plan date.");
  if (range === "week") start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  if (range === "month") start.setDate(1);
  const end = new Date(start);
  if (range === "week") end.setDate(end.getDate() + 6);
  if (range === "month") end.setMonth(end.getMonth() + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end) };
}
