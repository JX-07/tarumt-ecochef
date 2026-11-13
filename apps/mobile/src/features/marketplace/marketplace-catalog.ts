import type { MarketplaceProduct } from "@ecochef/contracts";

const parentForLegacyCategory: Record<string, string> = {
  fruits: "Produce",
  vegetables: "Produce",
  "herbs & aromatics": "Produce",
  mushrooms: "Produce",
  bread: "Bakery",
  pastries: "Bakery",
  cakes: "Bakery",
  "biscuits & cookies": "Snacks & Confectionery",
  "chips & crisps": "Snacks & Confectionery",
  "chocolate & candy": "Snacks & Confectionery",
  "nuts & seeds": "Snacks & Confectionery",
  milk: "Dairy",
  cheese: "Dairy",
  yoghurt: "Dairy",
  "butter & cream": "Dairy",
  "plant-based alternatives": "Dairy",
  water: "Beverages",
  waters: "Beverages",
  "carbonated beverages": "Beverages",
  "sports & energy drinks": "Beverages",
  juices: "Beverages",
  "tea & coffee": "Beverages",
};

export const productCategory = (product: MarketplaceProduct) => {
  const category = product.category?.trim() || "Other";
  return parentForLegacyCategory[category.toLowerCase()] ?? category;
};

export const productSubcategory = (product: MarketplaceProduct) => {
  if (product.subcategory?.trim()) return product.subcategory.trim();
  const rawCategory = product.category?.trim();
  const category = productCategory(product);
  if (rawCategory && rawCategory !== category) return rawCategory;
  return `Other ${category}`;
};

export const groupProductsByCategory = (products: MarketplaceProduct[]) => {
  const groups = new Map<string, MarketplaceProduct[]>();
  products.forEach((product) => {
    const category = productCategory(product);
    groups.set(category, [...(groups.get(category) ?? []), product]);
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
};

export const groupProductsBySubcategory = (products: MarketplaceProduct[]) => {
  const groups = new Map<string, MarketplaceProduct[]>();
  products.forEach((product) => {
    const subcategory = productSubcategory(product);
    groups.set(subcategory, [...(groups.get(subcategory) ?? []), product]);
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
};

const searchScore = (product: MarketplaceProduct, query: string) => {
  const term = query.toLocaleLowerCase();
  const name = product.name.toLocaleLowerCase();
  const category = productCategory(product).toLocaleLowerCase();
  const subcategory = productSubcategory(product).toLocaleLowerCase();
  const description = product.description?.toLocaleLowerCase() ?? "";
  if (name === term) return 6;
  if (name.startsWith(term)) return 5;
  if (name.includes(term)) return 4;
  if (subcategory.includes(term)) return 3;
  if (category.includes(term)) return 2;
  if (description.includes(term)) return 1;
  return 0;
};

export const recommendedProducts = (products: MarketplaceProduct[], query: string, limit = 10) => {
  const term = query.trim();
  if (!term)
    return [...products]
      .sort((a, b) => b.discount_percent - a.discount_percent || a.name.localeCompare(b.name))
      .slice(0, Math.min(8, limit));
  const ranked = products
    .map((product) => ({ product, score: searchScore(product, term) }))
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));
  const matches = ranked.filter((result) => result.score > 0).map((result) => result.product);
  if (!matches.length) return [];
  const relatedCategories = new Set(
    matches.reduce<string[]>(
      (values, product) => [...values, productCategory(product), productSubcategory(product)],
      [],
    ),
  );
  const related = ranked
    .filter(
      (result) =>
        result.score === 0 &&
        (relatedCategories.has(productCategory(result.product)) ||
          relatedCategories.has(productSubcategory(result.product))),
    )
    .map((result) => result.product);
  const suggested = [...matches, ...related];
  if (suggested.length < 6) {
    const used = new Set(suggested.map((product) => product.id));
    suggested.push(
      ...ranked.filter((result) => !used.has(result.product.id)).map((result) => result.product),
    );
  }
  return suggested.slice(0, limit);
};

export const discountedProducts = (products: MarketplaceProduct[]) =>
  products
    .filter((product) => product.discount_percent > 0)
    .sort((a, b) => b.discount_percent - a.discount_percent || a.name.localeCompare(b.name))
    .slice(0, 10);
