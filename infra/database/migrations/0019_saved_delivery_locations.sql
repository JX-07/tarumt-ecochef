BEGIN;

ALTER TABLE addresses
    ADD COLUMN IF NOT EXISTS label VARCHAR(50),
    ADD COLUMN IF NOT EXISTS address_type VARCHAR(20) NOT NULL DEFAULT 'saved',
    ADD COLUMN IF NOT EXISTS delivery_note VARCHAR(280);

ALTER TABLE addresses DROP CONSTRAINT IF EXISTS addresses_address_type_check;
ALTER TABLE addresses ADD CONSTRAINT addresses_address_type_check
    CHECK (address_type IN ('saved', 'home', 'work', 'school'));

INSERT INTO schema_migrations (version) VALUES ('0019') ON CONFLICT (version) DO NOTHING;

COMMIT;
