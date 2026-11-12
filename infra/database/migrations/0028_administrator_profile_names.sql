BEGIN;

ALTER TABLE administrators
    ADD COLUMN name VARCHAR(100);

UPDATE administrators
SET name = split_part(email, '@', 1)
WHERE name IS NULL;

ALTER TABLE administrators
    ALTER COLUMN name SET NOT NULL,
    ALTER COLUMN name SET DEFAULT 'Administrator';

INSERT INTO schema_migrations (version)
VALUES ('0028_administrator_profile_names')
ON CONFLICT (version) DO NOTHING;

COMMIT;
