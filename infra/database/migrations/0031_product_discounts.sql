BEGIN;

ALTER TABLE products
    ADD COLUMN discount JSONB;

UPDATE products AS product
SET addons = COALESCE((
    SELECT jsonb_agg(addon || jsonb_build_object(
        'selection_mode', 'single',
        'max_selections', 1
    ))
    FROM jsonb_array_elements(product.addons) AS addon
), '[]'::jsonb)
WHERE jsonb_array_length(product.addons) > 0;

INSERT INTO schema_migrations (version)
VALUES ('0031_product_discounts')
ON CONFLICT (version) DO NOTHING;

COMMIT;
