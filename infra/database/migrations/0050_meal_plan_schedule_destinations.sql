BEGIN;

DROP INDEX IF EXISTS meal_plan_recipes_slot_idx;

CREATE UNIQUE INDEX meal_plan_recipes_private_slot_idx
    ON meal_plan_recipes (meal_plan_id, recipe_id, scheduled_date, meal_slot)
    WHERE shared_group_id IS NULL;

CREATE UNIQUE INDEX meal_plan_recipes_group_slot_idx
    ON meal_plan_recipes (meal_plan_id, recipe_id, scheduled_date, meal_slot, shared_group_id)
    WHERE shared_group_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES ('0050') ON CONFLICT DO NOTHING;

COMMIT;
