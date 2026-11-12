BEGIN;

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS country VARCHAR(80),
    ADD COLUMN IF NOT EXISTS additional_location_details VARCHAR(255);

UPDATE stores SET country = 'Malaysia' WHERE country IS NULL;

INSERT INTO schema_migrations (version) VALUES ('0021') ON CONFLICT (version) DO NOTHING;

COMMIT;
