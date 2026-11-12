BEGIN;

CREATE TABLE IF NOT EXISTS recipe_edit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    subjects TEXT[] NOT NULL
);

CREATE INDEX IF NOT EXISTS recipe_edit_logs_recipe_date_idx
    ON recipe_edit_logs(recipe_id, edited_at DESC);

INSERT INTO schema_migrations(version) VALUES ('0014_recipe_edit_history')
ON CONFLICT (version) DO NOTHING;

COMMIT;
