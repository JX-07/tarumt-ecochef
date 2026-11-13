type ExpiryEstimate = {
  days: number;
  storage: "fridge" | "pantry";
  category:
    | "Fresh produce"
    | "Meat / seafood"
    | "Dairy / eggs"
    | "Pantry"
    | "Frozen"
    | "Prepared food"
    | "Other";
  reason: string;
};

const RULES: Array<{
  terms: string[];
  estimate: ExpiryEstimate;
}> = [
  {
    terms: ["frozen"],
    estimate: {
      days: 90,
      storage: "fridge",
      category: "Frozen",
      reason: "Frozen food is given a longer estimate when kept frozen.",
    },
  },
  {
    terms: ["cooked", "prepared", "leftover", "ready meal"],
    estimate: {
      days: 3,
      storage: "fridge",
      category: "Prepared food",
      reason: "Prepared food receives a short refrigerated estimate.",
    },
  },
  {
    terms: ["fish", "salmon", "tuna", "prawn", "shrimp", "crab", "lobster", "squid", "octopus"],
    estimate: {
      days: 2,
      storage: "fridge",
      category: "Meat / seafood",
      reason: "Fresh seafood usually keeps for only a short time.",
    },
  },
  {
    terms: ["chicken", "beef", "steak", "pork", "meat"],
    estimate: {
      days: 3,
      storage: "fridge",
      category: "Meat / seafood",
      reason: "Fresh meat is given a short refrigerated estimate.",
    },
  },
  {
    terms: [
      "spinach",
      "lettuce",
      "kale",
      "herb",
      "parsley",
      "cilantro",
      "basil",
      "berry",
      "strawberry",
    ],
    estimate: {
      days: 4,
      storage: "fridge",
      category: "Fresh produce",
      reason: "Leafy greens, herbs, and berries tend to spoil quickly.",
    },
  },
  {
    terms: ["bread", "toast", "bun", "mantou"],
    estimate: {
      days: 5,
      storage: "pantry",
      category: "Pantry",
      reason: "Fresh bread is normally best used within a few days.",
    },
  },
  {
    terms: ["milk", "yogurt", "yoghurt", "cheese", "butter"],
    estimate: {
      days: 7,
      storage: "fridge",
      category: "Dairy / eggs",
      reason: "Chilled dairy receives a one-week estimate.",
    },
  },
  {
    terms: [
      "tomato",
      "avocado",
      "broccoli",
      "cucumber",
      "pepper",
      "capsicum",
      "mushroom",
      "pea",
      "bean",
      "lemon",
      "lime",
      "orange",
      "apple",
      "pear",
      "peach",
      "grape",
    ],
    estimate: {
      days: 10,
      storage: "fridge",
      category: "Fresh produce",
      reason: "Most fresh fruit and vegetables receive a medium estimate.",
    },
  },
  {
    terms: ["egg"],
    estimate: {
      days: 21,
      storage: "fridge",
      category: "Dairy / eggs",
      reason: "Eggs generally keep longer when refrigerated.",
    },
  },
  {
    terms: ["potato", "sweet potato", "onion", "shallot", "garlic", "carrot", "cabbage"],
    estimate: {
      days: 21,
      storage: "pantry",
      category: "Fresh produce",
      reason: "Root vegetables and similar produce usually keep longer.",
    },
  },
  {
    terms: ["rice", "flour", "sugar", "salt", "oil", "pasta", "noodle", "honey"],
    estimate: {
      days: 90,
      storage: "pantry",
      category: "Pantry",
      reason: "Dry pantry ingredients are given a longer estimate.",
    },
  },
];

export function estimateIngredientExpiry(name: string): ExpiryEstimate {
  const normalized = name.trim().toLowerCase();
  return (
    RULES.find(({ terms }) => terms.some((term) => normalized.includes(term)))?.estimate ?? {
      days: 7,
      storage: "fridge",
      category: "Other",
      reason: "EcoChef does not recognize this food yet, so it uses a cautious one-week estimate.",
    }
  );
}

export function estimatedExpiryDate(name: string, purchasedAt = new Date()) {
  const result = new Date(purchasedAt);
  result.setDate(result.getDate() + estimateIngredientExpiry(name).days);
  return result;
}
