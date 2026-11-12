BEGIN;

ALTER TABLE users ADD COLUMN terms_version VARCHAR(40);
ALTER TABLE users ADD COLUMN terms_accepted_at TIMESTAMPTZ;
ALTER TABLE business_owners ADD COLUMN terms_version VARCHAR(40);
ALTER TABLE business_owners ADD COLUMN terms_accepted_at TIMESTAMPTZ;

INSERT INTO schema_migrations (version) VALUES ('0032_terms_acceptance');

COMMIT;
