BEGIN;

CREATE TABLE IF NOT EXISTS recipe_images (
    id UUID PRIMARY KEY,
    uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type VARCHAR(32) NOT NULL,
    image_data BYTEA NOT NULL,
    date_uploaded TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT recipe_images_content_type_check
        CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT recipe_images_size_check
        CHECK (octet_length(image_data) <= 8388608)
);

CREATE INDEX IF NOT EXISTS recipe_images_uploaded_by_idx
    ON recipe_images(uploaded_by, date_uploaded DESC);

INSERT INTO schema_migrations(version) VALUES ('0017_recipe_images')
ON CONFLICT (version) DO NOTHING;

COMMIT;
