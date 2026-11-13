-- Synthetic, non-transactional showcase content for the Railway production database.
-- Idempotent; does not create fake payments, deliveries, sensor readings, or moderation events.
BEGIN;

WITH names(name, gender) AS (VALUES
 ('Nur Aina Rahman','women'),('Lim Jia Wei','men'),('Siti Hajar Ismail','women'),
 ('Tan Wei Ling','women'),('Muhammad Hafiz','men'),('Priya Nair','women'),
 ('Amirul Hakim','men'),('Lee Xin Yi','women'),('Farah Nadia','women'),
 ('Kumar Raj','men'),('Ong Mei Chen','women'),('Daniel Wong','men'),
 ('Nurul Izzah','women'),('Jason Teoh','men'),('Alicia Goh','women'),
 ('Syafiq Azman','men'),('Anjali Menon','women'),('Chong Kai Wen','men'),
 ('Sara Abdullah','women'),('Ethan Low','men'),('Nadia Yusuf','women'),
 ('Ravi Chandran','men'),('Grace Ho','women'),('Adam Lee','men'),
 ('Hannah Lim','women'),('Irfan Zulkifli','men'),('Melissa Tan','women'),
 ('Fatin Amirah','women'),('Kevin Ng','men'),('Shalini Devi','women'),
 ('Zachary Chin','men'),('Yasmin Omar','women'),('Harith Danial','men'),
 ('Chloe Yap','women'),('Ben Tan','men'),('Nisha Kumar','women'),
 ('Aiman Rosli','men'),('Rachel Lim','women'),('Marcus Foo','men'),
 ('Maya Krishnan','women'),('Imran Saifullah','men'),('Olivia Chen','women')
), people AS (
 SELECT row_number() OVER () AS n, name, gender FROM names
)
INSERT INTO users(name,email,firebase_uid,profile_picture_url,bio,date_joined)
SELECT name, 'showcase.user'||lpad(n::text,2,'0')||'@example.com',
       'showcase-railway-'||lpad(n::text,2,'0'),
       'https://randomuser.me/api/portraits/'||gender||'/'||(n+10)::text||'.jpg',
       CASE n%4 WHEN 0 THEN 'Home cook sharing simple meals and ways to reduce food waste.'
                WHEN 1 THEN 'Enjoys fresh produce, local flavours and practical cooking.'
                WHEN 2 THEN 'Planning better meals and making the most of every ingredient.'
                ELSE 'Exploring recipes and shopping for fresh ingredients.' END,
       now() - ((70-n)::text||' days')::interval
FROM people
WHERE NOT EXISTS (SELECT 1 FROM users existing WHERE existing.email='showcase.user'||lpad(people.n::text,2,'0')||'@example.com');

INSERT INTO user_preferences(user_id,cuisine_preferences,dietary_restrictions,allergies,preferred_units,profile_visibility)
SELECT u.id, ARRAY['Malaysian','Asian']::text[], ARRAY[]::text[], ARRAY[]::text[], 'metric', 'public'
FROM users u WHERE u.firebase_uid LIKE 'showcase-railway-%' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO notification_preferences(user_id)
SELECT u.id FROM users u WHERE u.firebase_uid LIKE 'showcase-railway-%' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO addresses(user_id,address_line_1,city,state,postal_code,is_default,label,address_type)
SELECT u.id, (20+n)::text||' Jalan Sungai Dua', 'George Town', 'Pulau Pinang', '11700', true, 'Home', 'home'
FROM (SELECT id,row_number() OVER (ORDER BY email) n FROM users WHERE firebase_uid LIKE 'showcase-railway-%') u
WHERE NOT EXISTS (SELECT 1 FROM addresses a WHERE a.user_id=u.id);

INSERT INTO carts(user_id)
SELECT u.id FROM users u WHERE u.firebase_uid LIKE 'showcase-railway-%'
AND NOT EXISTS (SELECT 1 FROM carts c WHERE c.user_id=u.id);

WITH catalogue(name,price,category,image) AS (VALUES
 ('Royal Gala Apples 4 Pack',9.90,'Fruits','https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Apple_on_red_background.jpg/500px-Apple_on_red_background.jpg'),
 ('Fresh Fruit Selection Box',22.90,'Fruits','https://upload.wikimedia.org/wikipedia/commons/2/2f/Culinary_fruits_front_view.jpg'),
 ('Seasonal Citrus Box',13.90,'Fruits','https://upload.wikimedia.org/wikipedia/commons/2/2f/Culinary_fruits_front_view.jpg'),
 ('Tropical Fruit Mix',18.50,'Fruits','https://upload.wikimedia.org/wikipedia/commons/2/2f/Culinary_fruits_front_view.jpg'),
 ('Breakfast Fruit Basket',25.00,'Fruits','https://upload.wikimedia.org/wikipedia/commons/2/2f/Culinary_fruits_front_view.jpg'),
 ('Fresh Baby Spinach 200g',5.90,'Vegetables',NULL),
 ('Cherry Tomatoes 250g',6.50,'Vegetables',NULL),
 ('Carrots 500g',4.20,'Vegetables',NULL),
 ('Cucumbers 2 Pack',4.80,'Vegetables',NULL),
 ('Red Onions 500g',4.50,'Vegetables',NULL),
 ('Free Range Eggs 10 Pack',14.90,'Eggs & Dairy',NULL),
 ('Fresh Milk 1L',8.90,'Eggs & Dairy',NULL),
 ('Plain Yogurt 500g',10.50,'Eggs & Dairy',NULL),
 ('Wholemeal Bread Loaf',7.50,'Bakery',NULL),
 ('Brown Rice 1kg',11.90,'Pantry',NULL),
 ('Firm Tofu 300g',5.20,'Pantry',NULL)
)
INSERT INTO products(store_id,product_name,description,price,stock_quantity,image_url,category,unit_label,status)
SELECT s.id,c.name,'Fresh ingredients selected for everyday cooking.',c.price,35,c.image,c.category,'pack','active'
FROM catalogue c CROSS JOIN LATERAL
 (SELECT id FROM stores WHERE status='approved' ORDER BY store_name LIMIT 1) s
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.store_id=s.id AND p.product_name=c.name);

INSERT INTO products(store_id,product_name,description,price,stock_quantity,image_url,category,unit_label,status)
SELECT target.id,p.product_name,p.description,p.price,p.stock_quantity,p.image_url,p.category,p.unit_label,'active'
FROM products p JOIN stores source ON source.id=p.store_id
CROSS JOIN stores target
WHERE source.store_name='Always TT Fresh' AND target.store_name='Eco Fresh Produce'
AND p.product_name IN ('Royal Gala Apples 4 Pack','Fresh Fruit Selection Box','Seasonal Citrus Box',
 'Tropical Fruit Mix','Breakfast Fruit Basket','Fresh Baby Spinach 200g','Cherry Tomatoes 250g',
 'Carrots 500g','Cucumbers 2 Pack','Red Onions 500g','Free Range Eggs 10 Pack','Fresh Milk 1L')
AND NOT EXISTS (SELECT 1 FROM products existing WHERE existing.store_id=target.id AND existing.product_name=p.product_name);

UPDATE stores SET
 icon_url='data:image/svg+xml;base64,'||encode(convert_to(
 '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" rx="32" fill="#ddf8ec"/><circle cx="90" cy="78" r="42" fill="#08b98f"/><path d="M65 79c12 16 38 16 50 0" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/><path d="M72 52c11-15 30-15 41 0" fill="none" stroke="#057f68" stroke-width="7" stroke-linecap="round"/><text x="90" y="145" fill="#173c39" text-anchor="middle" font-size="18" font-family="Arial" font-weight="bold">FRESH</text></svg>', 'UTF8'),'base64'),
 cover_image_url='https://upload.wikimedia.org/wikipedia/commons/2/2f/Culinary_fruits_front_view.jpg'
WHERE store_name='Eco Fresh Produce' AND icon_url IS NULL;

UPDATE products SET image_url=replace(image_url,'http://127.0.0.1:8000','https://api-production-d786293b.up.railway.app')
WHERE image_url LIKE 'http://127.0.0.1:8000/api/v1/vendor/product-images/%';

UPDATE products SET image_url='https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Apple_on_red_background.jpg/500px-Apple_on_red_background.jpg'
WHERE product_name IN ('Royal Gala Apples 4 Pack','Fuji Apple Bag')
AND (image_url IS NULL OR image_url LIKE 'https://www.stockvault.net/%');

INSERT INTO store_favourites(store_id,user_id)
SELECT s.id,u.id FROM users u CROSS JOIN stores s
WHERE u.firebase_uid LIKE 'showcase-railway-%' AND s.status='approved'
AND (right(u.firebase_uid,2)::int + length(s.store_name))%3<>0
ON CONFLICT DO NOTHING;

WITH titles(title,summary,instructions,cuisine,prep,cook) AS (VALUES
 ('Ginger Chicken Rice Bowl','Comforting rice bowl with ginger and greens.','Cook rice. Pan fry chicken with ginger and garlic until fully cooked. Add greens and serve.', 'Malaysian',15,25),
 ('Tomato Egg Stir Fry','Quick tomato and egg meal for busy evenings.','Whisk eggs and cook gently. Soften tomatoes in a pan, then fold the eggs back in.', 'Chinese',10,12),
 ('Spinach Mushroom Omelette','A simple breakfast packed with vegetables.','Saute mushrooms and spinach. Pour in beaten eggs and cook until set.', 'Western',10,10),
 ('Cucumber Tofu Salad','Cool and light lunch with a savoury dressing.','Slice cucumber and tofu. Toss with soy sauce, lime and sesame oil.', 'Asian',15,0),
 ('Vegetable Fried Rice','A useful way to turn leftover rice into lunch.','Stir fry onions and vegetables. Add cold rice and season until hot throughout.', 'Asian',15,12),
 ('Banana Yogurt Breakfast Bowl','Fast breakfast with fruit and yogurt.','Spoon yogurt into a bowl. Add banana slices and a handful of oats.', 'Western',5,0),
 ('Apple Cinnamon Oats','Warm oats with fresh apple.','Simmer oats with milk. Add chopped apple and cinnamon until tender.', 'Western',5,10),
 ('Tomato Spinach Pasta','Everyday pasta with a vegetable sauce.','Cook pasta. Simmer tomatoes with garlic, stir in spinach and toss together.', 'Italian',10,20),
 ('Carrot Ginger Soup','Smooth soup using pantry vegetables.','Cook carrots, onion and ginger in stock until soft, then blend.', 'Western',15,25),
 ('Citrus Fruit Salad','Refreshing mix for a shared table.','Peel and cut the fruit. Chill and toss together just before serving.', 'Asian',15,0),
 ('Tofu Vegetable Noodles','Quick noodles with tofu and crunchy vegetables.','Cook noodles. Stir fry tofu and vegetables, then toss with sauce.', 'Asian',15,15),
 ('Egg and Tomato Toast','A satisfying breakfast with simple ingredients.','Toast bread. Cook eggs and tomatoes, then layer on top.', 'Western',8,8)
), numbered AS (SELECT row_number() OVER (ORDER BY title) n,* FROM titles), authors AS
 (SELECT id,row_number() OVER (ORDER BY email) n FROM users WHERE firebase_uid LIKE 'showcase-railway-%')
INSERT INTO recipes(user_id,title,summary,instructions,prep_time,cook_time,servings,cuisine,difficulty,is_published,date_created)
SELECT a.id,t.title,t.summary,t.instructions,t.prep,t.cook,2,t.cuisine,'easy',true,now()-(t.n||' days')::interval
FROM numbered t JOIN authors a ON a.n=t.n
WHERE NOT EXISTS (SELECT 1 FROM recipes r WHERE r.title=t.title AND r.user_id=a.id);

INSERT INTO recipe_favourites(recipe_id,user_id)
SELECT r.id,u.id FROM recipes r CROSS JOIN users u
WHERE u.firebase_uid LIKE 'showcase-railway-%' AND r.title IN
 ('Ginger Chicken Rice Bowl','Tomato Egg Stir Fry','Spinach Mushroom Omelette','Cucumber Tofu Salad','Vegetable Fried Rice','Banana Yogurt Breakfast Bowl','Apple Cinnamon Oats','Tomato Spinach Pasta','Carrot Ginger Soup','Citrus Fruit Salad','Tofu Vegetable Noodles','Egg and Tomato Toast')
AND mod(abs(hashtext(u.firebase_uid||r.title)),5)=0 AND u.id<>r.user_id
ON CONFLICT DO NOTHING;

INSERT INTO ingredient_inventories(user_id)
SELECT u.id FROM users u WHERE u.firebase_uid LIKE 'showcase-railway-%'
AND NOT EXISTS (SELECT 1 FROM ingredient_inventories i WHERE i.user_id=u.id);

INSERT INTO meal_plans(user_id)
SELECT u.id FROM users u WHERE u.firebase_uid LIKE 'showcase-railway-%'
AND NOT EXISTS (SELECT 1 FROM meal_plans m WHERE m.user_id=u.id);

COMMIT;
