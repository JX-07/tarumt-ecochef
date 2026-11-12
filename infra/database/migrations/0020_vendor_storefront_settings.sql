BEGIN;

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS street_address VARCHAR(255),
    ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20),
    ADD COLUMN IF NOT EXISTS city VARCHAR(80),
    ADD COLUMN IF NOT EXISTS state VARCHAR(80),
    ADD COLUMN IF NOT EXISTS contact_email VARCHAR(100),
    ADD COLUMN IF NOT EXISTS helpline_phones TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS icon_url TEXT,
    ADD COLUMN IF NOT EXISTS operating_hours_schedule JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE stores SET street_address = store_address WHERE street_address IS NULL;

INSERT INTO schema_migrations (version) VALUES ('0020') ON CONFLICT (version) DO NOTHING;
COMMIT;
