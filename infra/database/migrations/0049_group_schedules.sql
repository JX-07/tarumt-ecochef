BEGIN;
ALTER TABLE meal_plan_recipes ADD COLUMN shared_group_id UUID REFERENCES user_groups(id) ON DELETE SET NULL;
CREATE INDEX meal_plan_recipes_group_idx ON meal_plan_recipes(shared_group_id) WHERE shared_group_id IS NOT NULL;
CREATE INDEX group_members_user_status_idx ON group_members(user_id,status);
INSERT INTO schema_migrations(version) VALUES ('0049') ON CONFLICT DO NOTHING;
COMMIT;
