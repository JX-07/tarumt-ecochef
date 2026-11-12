BEGIN;

ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS summary VARCHAR(300),
    ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS cuisine VARCHAR(50),
    ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20) NOT NULL DEFAULT 'easy',
    ADD COLUMN IF NOT EXISTS nutrition JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS allergen_tags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_difficulty_check;
ALTER TABLE recipes ADD CONSTRAINT recipes_difficulty_check
    CHECK (difficulty IN ('easy', 'medium', 'hard'));

CREATE TABLE IF NOT EXISTS recipe_favourites (
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date_added TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (recipe_id, user_id)
);

CREATE INDEX IF NOT EXISTS recipe_favourites_user_idx ON recipe_favourites(user_id);
CREATE INDEX IF NOT EXISTS recipes_published_created_idx ON recipes(is_published, date_created DESC);
CREATE INDEX IF NOT EXISTS recipes_dietary_tags_idx ON recipes USING GIN(dietary_tags);
CREATE INDEX IF NOT EXISTS recipes_allergen_tags_idx ON recipes USING GIN(allergen_tags);

INSERT INTO schema_migrations(version) VALUES ('0012_recipe_catalogue')
ON CONFLICT (version) DO NOTHING;

COMMIT;
