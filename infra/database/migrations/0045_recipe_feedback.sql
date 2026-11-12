BEGIN;

ALTER TABLE recipe_feedback
    ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    -- Preserve legacy text privately until its author resubmits after a verified action.
    -- Historical schedule rows have no action-created timestamp, so cannot establish
    -- whether scheduling preceded an older review.
    ADD COLUMN eligibility_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN removed_at TIMESTAMPTZ,
    ADD COLUMN removed_by_administrator_id UUID REFERENCES administrators(id);

CREATE TABLE recipe_review_eligibility (
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_action VARCHAR(20) NOT NULL CHECK (first_action IN ('cook_now', 'schedule_later')),
    last_action_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (recipe_id, user_id)
);

-- Preserve eligibility earned by existing server-recorded scheduling activity.
INSERT INTO recipe_review_eligibility (recipe_id, user_id, first_action)
SELECT DISTINCT entry.recipe_id, plan.user_id, 'schedule_later'
FROM meal_plan_recipes entry JOIN meal_plans plan ON plan.id = entry.meal_plan_id
ON CONFLICT DO NOTHING;

CREATE TABLE recipe_feedback_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id UUID NOT NULL UNIQUE REFERENCES recipe_feedback(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id),
    description VARCHAR(2000) NOT NULL CHECK (char_length(trim(description)) >= 10),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'removed')),
    resolution_note VARCHAR(2000),
    resolved_at TIMESTAMPTZ,
    moderator_id UUID REFERENCES administrators(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'pending' AND resolved_at IS NULL AND moderator_id IS NULL)
        OR (status <> 'pending' AND resolved_at IS NOT NULL AND moderator_id IS NOT NULL))
);
CREATE INDEX recipe_feedback_flags_pending_idx ON recipe_feedback_flags(created_at) WHERE status = 'pending';

INSERT INTO schema_migrations(version) VALUES ('0045') ON CONFLICT DO NOTHING;
COMMIT;
