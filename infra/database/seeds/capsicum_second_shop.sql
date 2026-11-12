-- Optional local demo seller for comparing the same ingredient across shops.
-- Re-running this seed does not duplicate or reset the shop or its stock.
BEGIN;
DO $$
DECLARE
    owner_id UUID;
    shop_id UUID;
    source_image TEXT;
    location_lat NUMERIC;
    location_lon NUMERIC;
BEGIN
    SELECT image_url INTO source_image FROM products
    WHERE lower(product_name) = 'capsicum' ORDER BY id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Add the first capsicum product before applying this demo seed.';
    END IF;

    SELECT id INTO owner_id FROM business_owners
    WHERE firebase_uid='ecochef-demo-capsicum-seller';
    IF owner_id IS NULL THEN
        INSERT INTO business_owners (name, email, firebase_uid, business_name)
        VALUES ('Eco Fresh Demo Seller', 'capsicum-seller@ecochef.example',
                'ecochef-demo-capsicum-seller', 'Eco Fresh Produce')
        RETURNING id INTO owner_id;
    END IF;

    SELECT id INTO shop_id FROM stores WHERE business_owner_id=owner_id;
    IF shop_id IS NULL THEN
        SELECT latitude, longitude INTO location_lat, location_lon FROM addresses
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY is_default DESC, id LIMIT 1;
        INSERT INTO stores (
            business_owner_id, store_name, store_address, status, description,
            category, delivery_fee, estimated_delivery_minutes, latitude, longitude,
            operating_hours, operating_hours_schedule
        ) VALUES (
            owner_id, 'Eco Fresh Produce', 'Demo shop location, Penang, Malaysia',
            'approved', 'Demo produce shop for comparing ingredients across marketplace shops.',
            'Produce', 2.50, 30,
            COALESCE(location_lat, 5.4141) + 0.005,
            COALESCE(location_lon, 100.3288) + 0.005,
            'Daily, 00:00–23:59 (demo)',
            (SELECT jsonb_object_agg(day, jsonb_build_object('open','00:00','close','23:59','closed',false))
             FROM unnest(ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']) day)
        ) RETURNING id INTO shop_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM products WHERE store_id=shop_id AND lower(product_name)='capsicum') THEN
        INSERT INTO products (
            store_id, product_name, description, price, stock_quantity,
            category, subcategory, unit_label, size_label, image_url, status
        ) VALUES (
            shop_id, 'Capsicum', 'Fresh capsicum, sold per piece.', 1.40, 40,
            'Produce', 'Vegetables', '1 pc', '1 pc', source_image, 'active'
        );
    END IF;
END $$;
COMMIT;
