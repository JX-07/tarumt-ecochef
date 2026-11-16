BEGIN;

-- Older showcase recipes stored only a number. Make every amount explicit so
-- meal plans and shopping lists never have to guess whether it means grams,
-- pieces, slices, or another unit.
WITH corrections(recipe_title, ingredient_name, old_quantity, new_quantity) AS (
    VALUES
        ('Apple Cinnamon Oats', 'Apple', '1', '1 pcs'),
        ('Apple Cinnamon Oats', 'Cinnamon', '1', '1 tsp'),
        ('Apple Cinnamon Oats', 'Oats', '60', '60 g'),
        ('Banana Yogurt Breakfast Bowl', 'Banana', '1', '1 pcs'),
        ('Banana Yogurt Breakfast Bowl', 'Oats', '40', '40 g'),
        ('Banana Yogurt Breakfast Bowl', 'Yogurt', '180', '180 g'),
        ('Carrot Ginger Soup', 'Carrot', '300', '300 g'),
        ('Carrot Ginger Soup', 'Ginger', '20', '20 g'),
        ('Carrot Ginger Soup', 'Onion', '1', '1 pcs'),
        ('Citrus Fruit Salad', 'Apple', '2', '2 pcs'),
        ('Citrus Fruit Salad', 'Lemon', '1', '1 pcs'),
        ('Cucumber Tofu Salad', 'Cucumber', '1', '1 pcs'),
        ('Cucumber Tofu Salad', 'Tofu', '200', '200 g'),
        ('Egg and Tomato Toast', 'Bread', '2', '2 slices'),
        ('Egg and Tomato Toast', 'Egg', '2', '2 pcs'),
        ('Egg and Tomato Toast', 'Tomato', '1', '1 pcs'),
        ('Ginger Chicken Rice Bowl', 'Chicken', '200', '200 g'),
        ('Ginger Chicken Rice Bowl', 'Ginger', '15', '15 g'),
        ('Ginger Chicken Rice Bowl', 'Rice', '150', '150 g'),
        ('Spinach Mushroom Omelette', 'Egg', '3', '3 pcs'),
        ('Spinach Mushroom Omelette', 'Mushroom', '100', '100 g'),
        ('Spinach Mushroom Omelette', 'Spinach', '80', '80 g'),
        ('Tofu Vegetable Noodles', 'Carrot', '100', '100 g'),
        ('Tofu Vegetable Noodles', 'Noodles', '150', '150 g'),
        ('Tofu Vegetable Noodles', 'Tofu', '200', '200 g'),
        ('Tomato Egg Stir Fry', 'Egg', '3', '3 pcs'),
        ('Tomato Egg Stir Fry', 'Tomato', '2', '2 pcs'),
        ('Tomato Spinach Pasta', 'Spinach', '100', '100 g'),
        ('Tomato Spinach Pasta', 'Tomato', '3', '3 pcs'),
        ('Vegetable Fried Rice', 'Carrot', '100', '100 g'),
        ('Vegetable Fried Rice', 'Egg', '2', '2 pcs'),
        ('Vegetable Fried Rice', 'Rice', '180', '180 g')
)
UPDATE recipe_ingredients recipe_ingredient
SET quantity = correction.new_quantity
FROM recipes recipe, ingredients ingredient, corrections correction
WHERE recipe_ingredient.recipe_id = recipe.id
  AND recipe_ingredient.ingredient_id = ingredient.id
  AND recipe.title = correction.recipe_title
  AND lower(ingredient.ingredient_name) = lower(correction.ingredient_name)
  AND trim(recipe_ingredient.quantity) = correction.old_quantity;

ALTER TABLE recipe_ingredients
    DROP CONSTRAINT IF EXISTS recipe_ingredients_quantity_has_unit;
ALTER TABLE recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_quantity_has_unit
    CHECK (trim(quantity) ~ '[[:alpha:]]');

INSERT INTO schema_migrations(version) VALUES ('0052_recipe_ingredient_quantity_units')
ON CONFLICT (version) DO NOTHING;

COMMIT;
