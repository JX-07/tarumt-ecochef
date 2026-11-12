BEGIN;

ALTER TABLE products
    ADD COLUMN addons JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE product_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by UUID NOT NULL REFERENCES business_owners(id) ON DELETE CASCADE,
    content_type VARCHAR(40) NOT NULL,
    image_data BYTEA NOT NULL,
    date_uploaded TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT product_images_content_type_check
        CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp'))
);

CREATE INDEX product_images_uploaded_by_idx
    ON product_images (uploaded_by, date_uploaded DESC);

INSERT INTO schema_migrations (version)
VALUES ('0030_product_images_and_addons')
ON CONFLICT (version) DO NOTHING;

COMMIT;
