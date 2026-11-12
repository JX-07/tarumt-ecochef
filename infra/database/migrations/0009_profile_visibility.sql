BEGIN;

ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS profile_visibility VARCHAR(20) NOT NULL DEFAULT 'public';

ALTER TABLE user_preferences
    DROP CONSTRAINT IF EXISTS user_preferences_profile_visibility_check;

ALTER TABLE user_preferences
    ADD CONSTRAINT user_preferences_profile_visibility_check
    CHECK (profile_visibility IN ('public', 'friends_only', 'hidden'));

INSERT INTO schema_migrations (version) VALUES ('0009') ON CONFLICT (version) DO NOTHING;

COMMIT;
