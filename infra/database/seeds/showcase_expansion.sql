-- Additional idempotent showcase content for a migrated EcoChef database.
-- These accounts use reserved demo Firebase identifiers and cannot sign in unless
-- matching Firebase users are created separately.
BEGIN;

INSERT INTO business_owners (name, email, firebase_uid, business_name)
VALUES
    ('Mei Lin Tan', 'showcase.penang.pantry@example.com', 'showcase-owner-penang-pantry', 'Penang Pantry Market'),
    ('Arif Hakim', 'showcase.fresh.catch@example.com', 'showcase-owner-fresh-catch', 'Fresh Catch Corner'),
    ('Kavitha Nair', 'showcase.little.garden@example.com', 'showcase-owner-little-garden', 'Little Garden Grocer')
ON CONFLICT (email) DO NOTHING;

INSERT INTO stores (
    business_owner_id,
    store_name,
    store_address,
    street_address,
    postal_code,
    city,
    state,
    country,
    phone_number,
    operating_hours,
    status,
    description,
    category,
    delivery_fee,
    estimated_delivery_minutes,
    latitude,
    longitude
)
SELECT
    owner.id,
    details.store_name,
    details.street_address || ', ' || details.city,
    details.street_address,
    details.postal_code,
    details.city,
    'Pulau Pinang',
    'Malaysia',
    details.phone_number,
    'Mon-Sun 8:00 AM-8:00 PM',
    'approved',
    details.description,
    details.category,
    details.delivery_fee,
    details.delivery_minutes,
    details.latitude,
    details.longitude
FROM (
    VALUES
        ('showcase-owner-penang-pantry', 'Penang Pantry Market', '18 Jalan Burma', 'George Town', '10050', '+6042294101', 'Everyday pantry staples and locally sourced produce for practical home cooking.', 'Groceries', 3.50, 30, 5.416400::numeric, 100.332700::numeric),
        ('showcase-owner-fresh-catch', 'Fresh Catch Corner', '27 Lebuh Carnarvon', 'George Town', '10100', '+6042618202', 'Fresh seafood portions and simple meal-ready ingredients for family dinners.', 'Seafood', 5.00, 35, 5.414100::numeric, 100.335400::numeric),
        ('showcase-owner-little-garden', 'Little Garden Grocer', '12 Jalan Sungai Dua', 'Gelugor', '11700', '+6046589303', 'Fresh vegetables, fruit and herbs selected for smaller households.', 'Produce', 2.50, 25, 5.354900::numeric, 100.300500::numeric)
) AS details(firebase_uid, store_name, street_address, city, postal_code, phone_number, description, category, delivery_fee, delivery_minutes, latitude, longitude)
JOIN business_owners owner ON owner.firebase_uid = details.firebase_uid
WHERE NOT EXISTS (
    SELECT 1 FROM stores existing WHERE existing.store_name = details.store_name
);

WITH catalogue(store_name, product_name, description, price, original_price, stock_quantity, category, subcategory, unit_label, brand, size_label, expiry_days) AS (
    VALUES
        ('Penang Pantry Market', 'Brown Rice Vermicelli', 'Quick-cooking rice noodles for soups and stir-fries.', 6.90, 7.90, 30, 'Pantry', 'Noodles', 'pack', 'Local Harvest', '400g', 180),
        ('Penang Pantry Market', 'Coconut Milk', 'Creamy coconut milk for curries and desserts.', 4.20, 4.80, 42, 'Pantry', 'Cooking Essentials', 'carton', 'Dapur Choice', '200ml', 120),
        ('Penang Pantry Market', 'Low-Sodium Soy Sauce', 'Everyday seasoning with reduced sodium.', 8.50, 9.50, 25, 'Pantry', 'Sauces', 'bottle', 'Good Table', '500ml', 240),
        ('Penang Pantry Market', 'Free Range Eggs', 'Locally sourced free range eggs.', 14.90, 16.50, 18, 'Dairy', 'Eggs', 'tray', 'Kampung Fresh', '10 eggs', 14),
        ('Fresh Catch Corner', 'Salmon Fillet', 'Boneless salmon portion, ready for the pan.', 21.90, 25.90, 12, 'Seafood', 'Fish', 'portion', 'Fresh Catch', '200g', 2),
        ('Fresh Catch Corner', 'Sea Prawn Pack', 'Cleaned medium prawns for stir-fries and noodles.', 18.50, 22.00, 15, 'Seafood', 'Shellfish', 'pack', 'Fresh Catch', '300g', 2),
        ('Fresh Catch Corner', 'White Fish Fillet', 'Mild white fish suitable for steaming.', 15.90, 18.90, 14, 'Seafood', 'Fish', 'portion', 'Fresh Catch', '250g', 2),
        ('Fresh Catch Corner', 'Fish Soup Bundle', 'Fish slices, ginger and spring onion for a quick soup.', 19.90, 23.50, 10, 'Seafood', 'Meal Kits', 'bundle', 'Fresh Catch', 'serves 2', 2),
        ('Little Garden Grocer', 'Baby Pak Choy', 'Tender leafy greens for quick cooking.', 4.50, 5.50, 28, 'Produce', 'Vegetables', 'pack', 'Little Garden', '250g', 4),
        ('Little Garden Grocer', 'Ripe Tomatoes', 'Ripe tomatoes for sauces, salads and soups.', 5.90, 7.20, 32, 'Produce', 'Vegetables', 'pack', 'Little Garden', '500g', 5),
        ('Little Garden Grocer', 'Banana Bunch', 'Naturally sweet local bananas.', 6.50, 7.50, 20, 'Produce', 'Fruits', 'bunch', 'Little Garden', 'about 800g', 4),
        ('Little Garden Grocer', 'Fresh Herb Trio', 'Coriander, spring onion and mint in one pack.', 5.20, 6.50, 16, 'Produce', 'Herbs & Aromatics', 'pack', 'Little Garden', '120g', 3)
)
INSERT INTO products (
    store_id,
    product_name,
    description,
    price,
    original_price,
    stock_quantity,
    category,
    subcategory,
    unit_label,
    brand,
    size_label,
    expiry_date,
    status
)
SELECT
    store.id,
    item.product_name,
    item.description,
    item.price,
    item.original_price,
    item.stock_quantity,
    item.category,
    item.subcategory,
    item.unit_label,
    item.brand,
    item.size_label,
    now() + make_interval(days => item.expiry_days),
    'active'
FROM catalogue item
JOIN stores store ON store.store_name = item.store_name
WHERE NOT EXISTS (
    SELECT 1
    FROM products existing
    WHERE existing.store_id = store.id AND existing.product_name = item.product_name
);

WITH recipe_data(title, summary, instructions, prep_time, cook_time, cuisine) AS (
    VALUES
        ('Steamed Ginger Fish', 'A light family dinner using fresh fish and simple aromatics.', 'Place fish on a heat-safe plate. Top with sliced ginger and steam until fully cooked. Finish with spring onion and a small amount of soy sauce.', 10, 15, 'Malaysian'),
        ('Quick Prawn Vermicelli', 'A fast noodle meal with prawns and leafy vegetables.', 'Soak the vermicelli. Stir-fry prawns until cooked, add vegetables and noodles, then season lightly with soy sauce.', 12, 12, 'Asian'),
        ('Tomato Egg Rice Bowl', 'A comforting meal made with common fridge ingredients.', 'Cook beaten eggs until softly set and remove. Simmer chopped tomatoes, return the eggs, season and serve over warm rice.', 8, 12, 'Chinese'),
        ('Banana Yogurt Cups', 'A five-minute breakfast or snack with no cooking needed.', 'Slice the banana into cups of yogurt. Add oats or nuts if available and serve immediately.', 5, 0, 'Western'),
        ('Pak Choy Coconut Noodles', 'Creamy vegetable noodles for an easy weeknight meal.', 'Simmer coconut milk with a little water and seasoning. Add noodles and pak choy, then cook until the greens are tender.', 10, 15, 'Asian'),
        ('Fresh Herb Omelette', 'A flexible breakfast that makes good use of leftover herbs.', 'Chop the herbs and mix with beaten eggs. Cook gently in a lightly oiled pan until set, then fold and serve.', 7, 8, 'Malaysian')
), author AS (
    SELECT id FROM users ORDER BY date_joined LIMIT 1
)
INSERT INTO recipes (
    user_id,
    title,
    summary,
    instructions,
    prep_time,
    cook_time,
    servings,
    cuisine,
    difficulty,
    is_published
)
SELECT author.id, recipe.title, recipe.summary, recipe.instructions, recipe.prep_time,
       recipe.cook_time, 2, recipe.cuisine, 'easy', true
FROM recipe_data recipe
CROSS JOIN author
WHERE NOT EXISTS (SELECT 1 FROM recipes existing WHERE existing.title = recipe.title);

INSERT INTO administrators (firebase_uid, name, email, access_level)
VALUES
    ('showcase-admin-support', 'Nadia Support', 'showcase.admin.support@example.com', 'administrator'),
    ('showcase-admin-marketplace', 'Wei Jian Marketplace', 'showcase.admin.marketplace@example.com', 'administrator'),
    ('showcase-admin-community', 'Aisha Community', 'showcase.admin.community@example.com', 'administrator')
ON CONFLICT (email) DO NOTHING;

COMMIT;
