BEGIN;

CREATE TABLE sensor_provisioning_devices (
    device_code VARCHAR(80) PRIMARY KEY,
    claim_secret_hash CHAR(64) NOT NULL UNIQUE,
    setup_code_hash CHAR(64) NOT NULL UNIQUE,
    ble_name VARCHAR(80) NOT NULL,
    hardware_version VARCHAR(40) NOT NULL DEFAULT 'ecochef-enose-v1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    claimed_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    claimed_sensor_id UUID UNIQUE REFERENCES fridge_sensors(id) ON DELETE SET NULL
);

CREATE INDEX sensor_provisioning_devices_claimed_user_idx
    ON sensor_provisioning_devices (claimed_user_id)
    WHERE claimed_user_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES ('0051') ON CONFLICT DO NOTHING;

COMMIT;
