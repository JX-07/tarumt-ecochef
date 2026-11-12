-- Optional local-development marketplace data. Apply after migrations 0001-0018.
-- The script is idempotent by store/product/code name and does nothing when no
-- business-owner account exists yet.
DO $$
DECLARE
    owner_id UUID;
    green_store UUID;
    bakery_store UUID;
BEGIN
    SELECT id INTO owner_id FROM business_owners ORDER BY date_joined LIMIT 1;
    IF owner_id IS NULL THEN
        RAISE NOTICE 'Create a business-owner account before applying marketplace_demo.sql';
        RETURN;
    END IF;

    SELECT id INTO green_store FROM stores WHERE store_name = 'Green Harvest Farm' LIMIT 1;
    IF green_store IS NULL THEN
        INSERT INTO stores (
            business_owner_id, store_name, store_address, status, description,
            category, delivery_fee, estimated_delivery_minutes, latitude, longitude
        ) VALUES (
            owner_id, 'Green Harvest Farm', '12 Farmland Rd, Green Valley', 'approved',
            'Certified organic produce harvested fresh and available for same-day delivery.',
            'Organic', 2.50, 20, 3.139000, 101.686900
        ) RETURNING id INTO green_store;
    END IF;

    SELECT id INTO bakery_store FROM stores WHERE store_name = 'The Eco Bakery' LIMIT 1;
    IF bakery_store IS NULL THEN
        INSERT INTO stores (
            business_owner_id, store_name, store_address, status, description,
            category, delivery_fee, estimated_delivery_minutes, latitude, longitude
        ) VALUES (
            owner_id, 'The Eco Bakery', '8 Wheat Lane, Green Valley', 'approved',
            'Freshly baked sourdough and pastries made daily with surplus-conscious batches.',
            'Bakery', 2.50, 30, 3.145000, 101.695000
        ) RETURNING id INTO bakery_store;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM products WHERE store_id = green_store AND product_name = 'Organic Spinach') THEN
        INSERT INTO products (store_id, product_name, description, price, original_price, stock_quantity, category, unit_label, expiry_date)
        VALUES (green_store, 'Organic Spinach', 'Fresh organic spinach', 1.49, 2.99, 20, 'Vegetables', '1 bunch', now() + interval '2 days');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM products WHERE store_id = green_store AND product_name = 'Cherry Tomatoes') THEN
        INSERT INTO products (store_id, product_name, description, price, original_price, stock_quantity, category, unit_label, expiry_date)
        VALUES (green_store, 'Cherry Tomatoes', 'Sweet ripe tomatoes', 1.99, 3.50, 18, 'Vegetables', '250g pack', now() + interval '3 days');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM products WHERE store_id = green_store AND product_name = 'Red Bell Pepper') THEN
        INSERT INTO products (store_id, product_name, description, price, original_price, stock_quantity, category, unit_label, expiry_date)
        VALUES (green_store, 'Red Bell Pepper', 'Crisp red peppers', 0.99, 1.99, 24, 'Vegetables', '1 pc', now() + interval '5 days');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM products WHERE store_id = bakery_store AND product_name = 'Sourdough Loaf') THEN
        INSERT INTO products (store_id, product_name, description, price, original_price, stock_quantity, category, unit_label, expiry_date)
        VALUES (bakery_store, 'Sourdough Loaf', 'Naturally fermented sourdough', 2.50, 4.00, 12, 'Bread', 'Whole loaf', now() + interval '2 days');
    END IF;

    INSERT INTO promo_codes (
        code, title, description, discount_percent, status, start_date, end_date,
        usage_limit, audience, store_id, product_category, minimum_order_amount
    ) VALUES (
        'VEGGIE20', '20% off all vegetables', 'Save on vegetables from Green Harvest Farm.',
        20, 'active', now() - interval '1 day', now() + interval '90 days',
        10000, 'available', green_store, 'Vegetables', 0
    ) ON CONFLICT (code) DO UPDATE SET store_id = EXCLUDED.store_id,
        product_category = EXCLUDED.product_category, title = EXCLUDED.title,
        description = EXCLUDED.description;
END $$;
