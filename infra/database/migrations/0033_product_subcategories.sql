BEGIN;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS subcategory VARCHAR(80);

UPDATE products
SET subcategory = category,
    category = CASE
        WHEN lower(category) IN ('fruits', 'vegetables', 'herbs & aromatics', 'mushrooms') THEN 'Produce'
        WHEN lower(category) IN ('bread', 'pastries', 'cakes') THEN 'Bakery'
        WHEN lower(category) IN ('biscuits & cookies', 'chips & crisps', 'chocolate & candy', 'nuts & seeds') THEN 'Snacks & Confectionery'
        WHEN lower(category) IN ('water', 'waters', 'carbonated beverages', 'sports & energy drinks', 'juices', 'tea & coffee') THEN 'Beverages'
        WHEN lower(category) IN ('milk', 'cheese', 'yoghurt', 'butter & cream', 'plant-based alternatives') THEN 'Dairy'
        ELSE category
    END
WHERE subcategory IS NULL AND lower(category) IN (
    'fruits', 'vegetables', 'herbs & aromatics', 'mushrooms',
    'bread', 'pastries', 'cakes', 'biscuits & cookies', 'chips & crisps', 'chocolate & candy', 'nuts & seeds',
    'water', 'waters', 'carbonated beverages', 'sports & energy drinks', 'juices', 'tea & coffee',
    'milk', 'cheese', 'yoghurt', 'butter & cream', 'plant-based alternatives'
);

CREATE INDEX IF NOT EXISTS products_store_category_subcategory_idx
    ON products (store_id, category, subcategory);

INSERT INTO schema_migrations (version)
VALUES ('0033_product_subcategories')
ON CONFLICT (version) DO NOTHING;

COMMIT;
