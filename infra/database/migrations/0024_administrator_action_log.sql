BEGIN;

CREATE TABLE administrator_action_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    administrator_id UUID NOT NULL REFERENCES administrators(id),
    area VARCHAR(40) NOT NULL,
    action_type VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id UUID NOT NULL,
    entity_label VARCHAR(160) NOT NULL,
    summary TEXT NOT NULL,
    before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    undone_at TIMESTAMPTZ,
    undone_by_administrator_id UUID REFERENCES administrators(id),
    reverses_action_id UUID REFERENCES administrator_action_logs(id),
    CONSTRAINT administrator_action_log_area_check CHECK (
        area IN ('moderation', 'recipes', 'users', 'vendors', 'products', 'orders', 'promotions', 'administrators')
    )
);

CREATE INDEX administrator_action_logs_area_created_idx
    ON administrator_action_logs (area, created_at DESC);
CREATE INDEX administrator_action_logs_actor_created_idx
    ON administrator_action_logs (administrator_id, created_at DESC);
CREATE INDEX administrator_action_logs_entity_created_idx
    ON administrator_action_logs (entity_type, entity_id, created_at DESC);

INSERT INTO schema_migrations (version)
VALUES ('0024_administrator_action_log')
ON CONFLICT (version) DO NOTHING;

COMMIT;
