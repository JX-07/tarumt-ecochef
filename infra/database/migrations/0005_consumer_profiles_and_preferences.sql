BEGIN;

CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cuisine_preferences TEXT[] NOT NULL DEFAULT '{}',
    dietary_restrictions TEXT[] NOT NULL DEFAULT '{}',
    allergies TEXT[] NOT NULL DEFAULT '{}',
    preferred_units VARCHAR(10) NOT NULL DEFAULT 'metric',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_preferences_units_check CHECK (preferred_units IN ('metric', 'imperial'))
);

CREATE TABLE account_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    scheduled_for TIMESTAMPTZ NOT NULL,
    cancelled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT account_deletion_schedule_check CHECK (scheduled_for >= requested_at)
);

CREATE INDEX addresses_user_default_idx ON addresses(user_id, is_default);
CREATE INDEX account_deletion_requests_user_idx ON account_deletion_requests(user_id, requested_at DESC);

INSERT INTO schema_migrations (version) VALUES ('0005_consumer_profiles_and_preferences');

COMMIT;
