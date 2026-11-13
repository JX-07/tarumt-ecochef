import type { MealSlot } from "../meal-planning/types";

type RecipeTagOption = readonly [emoji: string, label: string];

export function recipeDefaultMealSlot(tags: string[]): MealSlot {
  const slots: Record<string, MealSlot> = {
    drink: "drink",
    breakfast: "breakfast",
    brunch: "brunch",
    lunch: "lunch",
    teatime: "teatime",
    dinner: "dinner",
    dessert: "dessert",
    snack: "snacks",
    snacks: "snacks",
  };
  for (const tag of tags) {
    const slot = slots[tag.trim().toLowerCase()];
    if (slot) return slot;
  }
  return "breakfast";
}

export const recipeMealTypes: ReadonlyArray<RecipeTagOption> = [
  ["🥤", "Drink"],
  ["🌅", "Breakfast"],
  ["🧇", "Brunch"],
  ["🍲", "Lunch"],
  ["🍵", "Teatime"],
  ["🍽️", "Dinner"],
  ["🍰", "Dessert"],
  ["🍎", "Snack"],
];

export const recipeDietaryTags: ReadonlyArray<RecipeTagOption> = [
  ["🌱", "Vegan"],
  ["🥦", "Vegetarian"],
  ["🌾", "Gluten-Free"],
  ["🥛", "Dairy-Free"],
  ["🥑", "Keto"],
  ["🍖", "Paleo"],
  ["💪", "High-Protein"],
  ["🚫", "Nut-Free"],
];

export const recipeSuggestedTags: ReadonlyArray<RecipeTagOption> = [
  ...recipeMealTypes,
  ...recipeDietaryTags,
];

const mealTagNames = new Set(recipeMealTypes.map(([, label]) => label.toLowerCase()));
const dietaryTagNames = new Set(recipeDietaryTags.map(([, label]) => label.toLowerCase()));

export type RecipeTagKind = "meal" | "dietary" | "custom";

export function recipeTagKind(tag: string): RecipeTagKind {
  const normalized = tag.trim().toLowerCase();
  if (mealTagNames.has(normalized)) return "meal";
  if (dietaryTagNames.has(normalized)) return "dietary";
  return "custom";
}

const forbiddenIngredients: Record<string, string[]> = {
  vegan: [
    "beef",
    "chicken",
    "pork",
    "lamb",
    "mutton",
    "fish",
    "salmon",
    "tuna",
    "prawn",
    "shrimp",
    "crab",
    "egg",
    "milk",
    "cheese",
    "butter",
    "cream",
    "yogurt",
    "honey",
    "gelatin",
  ],
  vegetarian: [
    "beef",
    "chicken",
    "pork",
    "lamb",
    "mutton",
    "fish",
    "salmon",
    "tuna",
    "prawn",
    "shrimp",
    "crab",
    "gelatin",
  ],
  "gluten-free": ["wheat", "barley", "rye", "bread", "pasta", "noodle", "soy sauce"],
  "dairy-free": ["milk", "cheese", "butter", "cream", "yogurt", "whey", "casein"],
  keto: ["sugar", "rice", "bread", "pasta", "potato", "flour", "corn", "oat"],
  paleo: [
    "milk",
    "cheese",
    "butter",
    "yogurt",
    "wheat",
    "rice",
    "bread",
    "pasta",
    "bean",
    "lentil",
    "soy",
  ],
  "nut-free": [
    "peanut",
    "almond",
    "cashew",
    "walnut",
    "pecan",
    "pistachio",
    "hazelnut",
    "macadamia",
    "nut butter",
  ],
};
const highProteinIngredients = [
  "chicken",
  "beef",
  "pork",
  "lamb",
  "fish",
  "salmon",
  "tuna",
  "prawn",
  "shrimp",
  "egg",
  "tofu",
  "tempeh",
  "bean",
  "lentil",
  "chickpea",
  "yogurt",
  "cheese",
];

export function dietaryIngredientIssues(tags: string[], ingredients: string[]): string[] {
  const names = ingredients.map((name) => name.trim().toLowerCase()).filter(Boolean);
  const selected = new Set(tags.map((tag) => tag.toLowerCase()));
  const issues: string[] = [];
  Object.entries(forbiddenIngredients).forEach(([diet, forbidden]) => {
    if (!selected.has(diet)) return;
    const conflicts = names.filter((name) => forbidden.some((term) => name.includes(term)));
    if (conflicts.length)
      issues.push(
        `${diet.replace(/(^|-)(\w)/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)} conflicts with ${Array.from(new Set(conflicts)).join(", ")}`,
      );
  });
  if (
    selected.has("high-protein") &&
    !names.some((name) => highProteinIngredients.some((term) => name.includes(term)))
  )
    issues.push("High-Protein needs at least one clear protein-rich ingredient");
  return issues;
}
