BEGIN;
ALTER TABLE meal_plan_recipes ADD COLUMN IF NOT EXISTS scheduled_time TIME;
INSERT INTO schema_migrations(version) VALUES ('0013_recipe_authoring_and_schedule') ON CONFLICT (version) DO NOTHING;
COMMIT;
