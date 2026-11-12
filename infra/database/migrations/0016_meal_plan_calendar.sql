BEGIN;

ALTER TABLE meal_plan_recipes DROP CONSTRAINT IF EXISTS meal_plan_recipes_pkey;
ALTER TABLE meal_plan_recipes ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
UPDATE meal_plan_recipes SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE meal_plan_recipes ALTER COLUMN id SET NOT NULL;
ALTER TABLE meal_plan_recipes ADD PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS meal_plan_recipes_slot_idx
    ON meal_plan_recipes(meal_plan_id, recipe_id, scheduled_date, meal_slot);
CREATE INDEX IF NOT EXISTS meal_plan_recipes_calendar_idx
    ON meal_plan_recipes(meal_plan_id, scheduled_date, meal_slot);

INSERT INTO schema_migrations(version) VALUES ('0016_meal_plan_calendar')
ON CONFLICT (version) DO NOTHING;

COMMIT;
