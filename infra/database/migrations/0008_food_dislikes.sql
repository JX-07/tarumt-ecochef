BEGIN;

ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS food_dislikes TEXT[] NOT NULL DEFAULT '{}';

INSERT INTO schema_migrations (version)
VALUES ('0008')
ON CONFLICT (version) DO NOTHING;

COMMIT;
