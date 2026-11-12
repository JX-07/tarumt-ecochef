BEGIN;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500);

CREATE TABLE IF NOT EXISTS store_favourites (
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, user_id)
);

CREATE TABLE IF NOT EXISTS store_holiday_closures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    whole_day BOOLEAN NOT NULL DEFAULT true,
    opens_at TIME,
    closes_at TIME,
    reason VARCHAR(300) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on),
    CHECK (whole_day OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at))
);

ALTER TABLE user_promo_codes
    ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reward_message VARCHAR(300),
    ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK (category IN (
    'sensor_alert', 'ingredient_expiry', 'meal_reminder', 'payment', 'delivery', 'order', 'promotion'
));

INSERT INTO schema_migrations (version) VALUES ('0041') ON CONFLICT (version) DO NOTHING;

COMMIT;
