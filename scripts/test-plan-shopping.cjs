const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "apps/mobile/node_modules/typescript"));
const source = fs.readFileSync(path.join(root, "apps/mobile/src/features/marketplace/plan-shopping.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleExports = {};
vm.runInNewContext(compiled, { exports: moduleExports, Map, Date });
const { groupPlanIngredients, matchesPlanIngredient, planDateRange, planQuantityLabel } = moduleExports;
const { planCartQuantityLabel } = moduleExports;
assert.equal(planCartQuantityLabel([
  { name: "Capsicum", cart_quantity: 4, size: "1 pc" },
  { name: "Capsicum", cart_quantity: 2, unit_label: "1 pc" },
], { name: "Capsicum" }), "6 pcs");
assert.equal(planCartQuantityLabel([
  { name: "Rice", cart_quantity: 2, size: "500 g" },
  { name: "Rice", cart_quantity: 1, size: "1 kg" },
], { name: "Rice" }), "2000 g");
assert.equal(planCartQuantityLabel([{ name: "Rice", cart_quantity: 2 }], { name: "Rice" }), "2 items");
const rows = [
  { ingredient_id: "a", name: "Tomatoes", quantity: "100 g", recipe_title: "Pasta", in_kitchen: false },
  { ingredient_id: "a", name: "Tomatoes", quantity: "200 g", recipe_title: "Salad", in_kitchen: false },
  { ingredient_id: "a", name: "Tomatoes", quantity: "50 g", recipe_title: "Soup", in_kitchen: true },
];
const ingredient = groupPlanIngredients(rows)[0];
assert.equal(ingredient.inKitchen, false);
assert.equal(planQuantityLabel(ingredient.quantities), "300 g");
assert.equal(ingredient.recipes.join(", "), "Pasta, Salad");
assert.equal(matchesPlanIngredient({ name: "Fresh tomato 500g" }, ingredient), true);
assert.equal(matchesPlanIngredient({ name: "Tomato sauce" }, ingredient), false);
assert.equal(matchesPlanIngredient({ name: "Apple juice" }, { name: "Apples" }), false);
assert.equal(matchesPlanIngredient({ name: "Fresh pineapple" }, { name: "Apples" }), false);
assert.equal(matchesPlanIngredient({ name: "Olive oil 500ml" }, { name: "Olive oil" }), true);
assert.equal(planQuantityLabel(["1 cup", "100 g", "to taste"]), "1 cup + 100 g + to taste");
assert.equal(planDateRange("2026-11-08", "week").start, "2026-11-02");
assert.equal(planDateRange("2026-11-08", "week").end, "2026-11-08");
assert.equal(planDateRange("2028-02-12", "month").end, "2028-02-29");
console.log("Plan shopping checks passed: missing quantities, ingredient matches, prepared foods, and date ranges.");
