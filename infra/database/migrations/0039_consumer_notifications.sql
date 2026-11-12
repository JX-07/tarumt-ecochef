BEGIN;

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    sensor_alerts BOOLEAN NOT NULL DEFAULT true,
    ingredient_expiry BOOLEAN NOT NULL DEFAULT true,
    meal_reminders BOOLEAN NOT NULL DEFAULT true,
    payment_updates BOOLEAN NOT NULL DEFAULT true,
    delivery_updates BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(30) NOT NULL CHECK (category IN (
        'sensor_alert', 'ingredient_expiry', 'meal_reminder', 'payment', 'delivery'
    )),
    title VARCHAR(120) NOT NULL,
    message VARCHAR(500) NOT NULL,
    action_path VARCHAR(255),
    source_key VARCHAR(180) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    UNIQUE (user_id, source_key)
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
    ON notifications (user_id, created_at DESC)
    WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL AND dismissed_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('0039') ON CONFLICT (version) DO NOTHING;

COMMIT;
