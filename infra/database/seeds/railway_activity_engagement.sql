-- Additional synthetic engagement for showcase accounts only.
BEGIN;

WITH ingredient_data(name,category,unit) AS (VALUES
 ('Banana','Produce','piece'),('Spinach','Produce','g'),('Carrot','Produce','g'),
 ('Cucumber','Produce','piece'),('Tomato','Produce','piece'),('Egg','Dairy & Eggs','piece'),
 ('Tofu','Protein','g'),('Milk','Dairy & Eggs','ml'),('Oats','Pantry','g'),
 ('Ginger','Produce','g'),('Garlic','Produce','clove'),('Mushroom','Produce','g'),
 ('Bread','Bakery','slice'),('Chicken','Protein','g'),('Onion','Produce','piece'),
 ('Noodles','Pantry','g'),('Yogurt','Dairy & Eggs','g'),('Cinnamon','Pantry','tsp')
)
INSERT INTO ingredients(ingredient_name,category,default_unit,ingredient_type)
SELECT d.name,d.category,d.unit,'manual' FROM ingredient_data d
WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE lower(i.ingredient_name)=lower(d.name));

WITH pair(title,ingredient_name,quantity) AS (VALUES
 ('Ginger Chicken Rice Bowl','Rice',150),('Ginger Chicken Rice Bowl','Chicken',200),('Ginger Chicken Rice Bowl','Ginger',15),
 ('Tomato Egg Stir Fry','Tomato',2),('Tomato Egg Stir Fry','Egg',3),
 ('Spinach Mushroom Omelette','Spinach',80),('Spinach Mushroom Omelette','Mushroom',100),('Spinach Mushroom Omelette','Egg',3),
 ('Cucumber Tofu Salad','Cucumber',1),('Cucumber Tofu Salad','Tofu',200),
 ('Vegetable Fried Rice','Rice',180),('Vegetable Fried Rice','Carrot',100),('Vegetable Fried Rice','Egg',2),
 ('Banana Yogurt Breakfast Bowl','Banana',1),('Banana Yogurt Breakfast Bowl','Yogurt',180),('Banana Yogurt Breakfast Bowl','Oats',40),
 ('Apple Cinnamon Oats','Apple',1),('Apple Cinnamon Oats','Oats',60),('Apple Cinnamon Oats','Cinnamon',1),
 ('Tomato Spinach Pasta','Tomato',3),('Tomato Spinach Pasta','Spinach',100),
 ('Carrot Ginger Soup','Carrot',300),('Carrot Ginger Soup','Ginger',20),('Carrot Ginger Soup','Onion',1),
 ('Citrus Fruit Salad','Lemon',1),('Citrus Fruit Salad','Apple',2),
 ('Tofu Vegetable Noodles','Tofu',200),('Tofu Vegetable Noodles','Noodles',150),('Tofu Vegetable Noodles','Carrot',100),
 ('Egg and Tomato Toast','Egg',2),('Egg and Tomato Toast','Tomato',1),('Egg and Tomato Toast','Bread',2)
)
INSERT INTO recipe_ingredients(recipe_id,ingredient_id,quantity)
SELECT r.id,i.id,p.quantity FROM pair p JOIN recipes r ON r.title=p.title
JOIN LATERAL (SELECT id FROM ingredients WHERE lower(ingredient_name)=lower(p.ingredient_name) ORDER BY id LIMIT 1) i ON true
WHERE NOT EXISTS (SELECT 1 FROM recipe_ingredients x WHERE x.recipe_id=r.id AND x.ingredient_id=i.id);

WITH showcase AS (SELECT id,row_number() OVER (ORDER BY email) n FROM users WHERE firebase_uid LIKE 'showcase-railway-%'),
items AS (SELECT id,row_number() OVER (ORDER BY ingredient_name,id) n FROM ingredients WHERE ingredient_name IN ('Apple','Banana','Carrot','Spinach','Tomato','Egg','Rice','Oats','Milk'))
INSERT INTO ingredient_inventory_items(ingredient_inventory_id,ingredient_id,quantity,expiry_date)
SELECT v.id,i.id,CASE WHEN i.n%2=0 THEN 2 ELSE 4 END,now()+((i.n+3)||' days')::interval
FROM showcase s JOIN ingredient_inventories v ON v.user_id=s.id
JOIN items i ON i.n=1+(s.n%8) OR i.n=1+((s.n+2)%8)
WHERE NOT EXISTS (SELECT 1 FROM ingredient_inventory_items x WHERE x.ingredient_inventory_id=v.id AND x.ingredient_id=i.id);

WITH showcase AS (SELECT id,row_number() OVER (ORDER BY email) n FROM users WHERE firebase_uid LIKE 'showcase-railway-%'),
recipes_ranked AS (SELECT id,row_number() OVER (ORDER BY title) n FROM recipes WHERE title IN
 ('Ginger Chicken Rice Bowl','Tomato Egg Stir Fry','Spinach Mushroom Omelette','Cucumber Tofu Salad','Vegetable Fried Rice','Banana Yogurt Breakfast Bowl','Apple Cinnamon Oats','Tomato Spinach Pasta','Carrot Ginger Soup','Citrus Fruit Salad','Tofu Vegetable Noodles','Egg and Tomato Toast'))
INSERT INTO meal_plan_recipes(meal_plan_id,recipe_id,scheduled_date,meal_slot)
SELECT m.id,r.id,current_date+(((s.n%7)+1)::int),'dinner' FROM showcase s JOIN meal_plans m ON m.user_id=s.id
JOIN recipes_ranked r ON r.n=1+(s.n%12)
ON CONFLICT DO NOTHING;

WITH showcase AS (SELECT id,row_number() OVER (ORDER BY email) n FROM users WHERE firebase_uid LIKE 'showcase-railway-%'),
goods AS (SELECT id,row_number() OVER (ORDER BY product_name,id) n FROM products WHERE product_name IN
 ('Royal Gala Apples 4 Pack','Fresh Fruit Selection Box','Fresh Baby Spinach 200g','Cherry Tomatoes 250g','Carrots 500g','Free Range Eggs 10 Pack','Wholemeal Bread Loaf','Brown Rice 1kg'))
INSERT INTO cart_items(cart_id,product_id,quantity)
SELECT c.id,p.id,1+(s.n%2) FROM showcase s JOIN carts c ON c.user_id=s.id
JOIN goods p ON p.n=1+(s.n%8) WHERE s.n<=24
ON CONFLICT DO NOTHING;

WITH showcase AS (SELECT id,row_number() OVER (ORDER BY email) n FROM users WHERE firebase_uid LIKE 'showcase-railway-%')
INSERT INTO notifications(user_id,category,title,message,action_path,source_key)
SELECT id,'meal_reminder','Plan your next meal','Your meal plan is ready to explore. Add a recipe for the week ahead.','/meal-plan','showcase-meal-plan-'||n
FROM showcase ON CONFLICT DO NOTHING;

INSERT INTO user_groups(group_name,created_by_user_id,description)
SELECT 'Sungai Dua Home Cooks',u.id,'A local circle for sharing easy weekday recipes.'
FROM users u WHERE u.firebase_uid='showcase-railway-01'
AND NOT EXISTS (SELECT 1 FROM user_groups WHERE group_name='Sungai Dua Home Cooks');

WITH showcase AS (SELECT id,row_number() OVER (ORDER BY email) n FROM users WHERE firebase_uid LIKE 'showcase-railway-%')
INSERT INTO group_members(group_id,user_id,status)
SELECT g.id,s.id,'accepted' FROM showcase s CROSS JOIN user_groups g
WHERE g.group_name='Sungai Dua Home Cooks' AND s.n<=12
ON CONFLICT DO NOTHING;

COMMIT;
