BEGIN;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS brand VARCHAR(100),
    ADD COLUMN IF NOT EXISTS size_label VARCHAR(40);

INSERT INTO schema_migrations (version) VALUES ('0035_product_brand_and_size')
ON CONFLICT (version) DO NOTHING;

COMMIT;
