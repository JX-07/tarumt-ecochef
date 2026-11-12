BEGIN;

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS description VARCHAR(500),
    ADD COLUMN IF NOT EXISTS category VARCHAR(50),
    ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    ADD COLUMN IF NOT EXISTS estimated_delivery_minutes INTEGER CHECK (estimated_delivery_minutes > 0);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS image_url TEXT,
    ADD COLUMN IF NOT EXISTS category VARCHAR(50),
    ADD COLUMN IF NOT EXISTS unit_label VARCHAR(40),
    ADD COLUMN IF NOT EXISTS original_price NUMERIC(10, 2) CHECK (original_price >= 0),
    ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE products ADD CONSTRAINT products_status_check
    CHECK (status IN ('active', 'hidden', 'sold_out'));

ALTER TABLE addresses
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6);

ALTER TABLE promo_codes
    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS product_category VARCHAR(50),
    ADD COLUMN IF NOT EXISTS minimum_order_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (minimum_order_amount >= 0),
    ADD COLUMN IF NOT EXISTS free_delivery BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS promotion_type VARCHAR(20) NOT NULL DEFAULT 'discount';

DO $$
DECLARE value_constraint TEXT;
BEGIN
    SELECT conname INTO value_constraint
    FROM pg_constraint
    WHERE conrelid = 'promo_codes'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%discount_percent%'
      AND pg_get_constraintdef(oid) LIKE '%discount_amount%'
    LIMIT 1;
    IF value_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE promo_codes DROP CONSTRAINT %I', value_constraint);
    END IF;
END $$;

ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_discount_value_check CHECK (
    (promotion_type = 'free_delivery' AND free_delivery = true)
    OR (promotion_type = 'discount' AND ((discount_percent IS NULL) <> (discount_amount IS NULL)))
);

ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_promotion_type_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_promotion_type_check
    CHECK (promotion_type IN ('discount', 'free_delivery'));

ALTER TABLE carts ADD COLUMN IF NOT EXISTS promo_code_id UUID REFERENCES promo_codes(id);

CREATE INDEX IF NOT EXISTS products_marketplace_idx
    ON products (store_id, status, category, expiry_date);
CREATE INDEX IF NOT EXISTS stores_marketplace_idx
    ON stores (status, category, store_name);
CREATE INDEX IF NOT EXISTS carts_active_user_idx ON carts (user_id);

INSERT INTO schema_migrations (version) VALUES ('0018') ON CONFLICT (version) DO NOTHING;

COMMIT;
