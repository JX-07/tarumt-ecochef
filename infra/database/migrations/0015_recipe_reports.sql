BEGIN;
CREATE TABLE IF NOT EXISTS recipe_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(30) NOT NULL,
    date_reported TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (recipe_id, reporter_user_id)
);
CREATE INDEX IF NOT EXISTS recipe_reports_recipe_idx ON recipe_reports(recipe_id, date_reported DESC);
INSERT INTO schema_migrations(version) VALUES ('0015_recipe_reports') ON CONFLICT (version) DO NOTHING;
COMMIT;
