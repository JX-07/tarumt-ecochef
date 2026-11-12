BEGIN;

CREATE TABLE IF NOT EXISTS fridge_sensors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_code VARCHAR(80) NOT NULL UNIQUE,
    sensor_name VARCHAR(80) NOT NULL,
    fridge_name VARCHAR(80) NOT NULL,
    ingest_token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS fridge_sensors_user_idx
    ON fridge_sensors (user_id, created_at);

CREATE TABLE IF NOT EXISTS fridge_sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    sensor_id UUID NOT NULL REFERENCES fridge_sensors(id) ON DELETE CASCADE,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    mq3 DOUBLE PRECISION NOT NULL CHECK (mq3 >= 0),
    mq135 DOUBLE PRECISION NOT NULL CHECK (mq135 >= 0),
    mq136 DOUBLE PRECISION NOT NULL CHECK (mq136 >= 0),
    mq137 DOUBLE PRECISION NOT NULL CHECK (mq137 >= 0),
    temperature_c DOUBLE PRECISION NOT NULL CHECK (temperature_c BETWEEN -40 AND 80),
    humidity_percent DOUBLE PRECISION NOT NULL CHECK (humidity_percent BETWEEN 0 AND 100),
    freshness_status VARCHAR(20) NOT NULL DEFAULT 'unknown' CHECK (
        freshness_status IN ('excellent', 'good', 'acceptable', 'spoiled', 'unknown')
    ),
    confidence DOUBLE PRECISION CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    model_version VARCHAR(80)
);

CREATE INDEX IF NOT EXISTS fridge_sensor_readings_sensor_time_idx
    ON fridge_sensor_readings (sensor_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS user_push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(120) NOT NULL,
    expo_push_token VARCHAR(255) NOT NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('android', 'ios')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_id),
    UNIQUE (expo_push_token)
);

CREATE INDEX IF NOT EXISTS user_push_tokens_user_idx
    ON user_push_tokens (user_id);

INSERT INTO schema_migrations (version) VALUES ('0040') ON CONFLICT (version) DO NOTHING;

COMMIT;
