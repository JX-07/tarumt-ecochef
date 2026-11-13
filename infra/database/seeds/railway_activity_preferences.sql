BEGIN;

INSERT INTO diet_tags(tag_name)
SELECT name FROM (VALUES ('Plant foods'),('Animal products'),('Gluten'),('Dairy')) v(name)
WHERE NOT EXISTS (SELECT 1 FROM diet_tags d WHERE d.tag_name=v.name);

INSERT INTO diets(diet_name,description,tag_preference_id,tag_restrict_id)
SELECT 'Vegetarian','Prefers plant-based meals and avoids meat.',p.id,r.id
FROM diet_tags p CROSS JOIN diet_tags r
WHERE p.tag_name='Plant foods' AND r.tag_name='Animal products'
AND NOT EXISTS (SELECT 1 FROM diets WHERE diet_name='Vegetarian');

INSERT INTO user_diets(user_id,diet_id)
SELECT u.id,d.id FROM users u CROSS JOIN diets d
WHERE u.firebase_uid LIKE 'showcase-railway-%' AND right(u.firebase_uid,2)::int%7=0
AND d.diet_name='Vegetarian' ON CONFLICT DO NOTHING;

UPDATE user_preferences p SET dietary_restrictions=ARRAY['Vegetarian']::text[]
FROM users u WHERE p.user_id=u.id AND u.firebase_uid LIKE 'showcase-railway-%'
AND right(u.firebase_uid,2)::int%7=0 AND p.dietary_restrictions='{}'::text[];

INSERT INTO recipe_tags(tag_name,description)
SELECT name,description FROM (VALUES
 ('Quick meals','Ready in about half an hour.'),
 ('Vegetarian','Made without meat or fish.'),
 ('Breakfast','Good for the first meal of the day.'),
 ('Low waste','Makes practical use of everyday ingredients.')
) v(name,description)
WHERE NOT EXISTS (SELECT 1 FROM recipe_tags t WHERE t.tag_name=v.name);

INSERT INTO recipe_tag_list(recipe_id,recipe_tag_id)
SELECT r.id,t.id FROM recipes r CROSS JOIN recipe_tags t
WHERE r.title IN ('Ginger Chicken Rice Bowl','Tomato Egg Stir Fry','Spinach Mushroom Omelette',
 'Cucumber Tofu Salad','Vegetable Fried Rice','Banana Yogurt Breakfast Bowl','Apple Cinnamon Oats',
 'Tomato Spinach Pasta','Carrot Ginger Soup','Citrus Fruit Salad','Tofu Vegetable Noodles','Egg and Tomato Toast')
AND ((t.tag_name='Quick meals' AND coalesce(r.prep_time,0)+coalesce(r.cook_time,0)<=30)
 OR (t.tag_name='Vegetarian' AND r.title IN ('Tomato Egg Stir Fry','Spinach Mushroom Omelette','Cucumber Tofu Salad','Vegetable Fried Rice','Banana Yogurt Breakfast Bowl','Apple Cinnamon Oats','Tomato Spinach Pasta','Carrot Ginger Soup','Citrus Fruit Salad','Tofu Vegetable Noodles','Egg and Tomato Toast'))
 OR (t.tag_name='Breakfast' AND r.title IN ('Spinach Mushroom Omelette','Banana Yogurt Breakfast Bowl','Apple Cinnamon Oats','Egg and Tomato Toast'))
 OR (t.tag_name='Low waste' AND r.title IN ('Vegetable Fried Rice','Carrot Ginger Soup','Tomato Spinach Pasta')))
ON CONFLICT DO NOTHING;

INSERT INTO group_roles(group_id,user_id,role_name)
SELECT g.id,g.created_by_user_id,'owner' FROM user_groups g
WHERE g.group_name='Sungai Dua Home Cooks'
AND NOT EXISTS (SELECT 1 FROM group_roles x WHERE x.group_id=g.id AND x.user_id=g.created_by_user_id);

COMMIT;
