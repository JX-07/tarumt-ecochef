BEGIN;

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_status_check;
ALTER TABLE stores
    ADD CONSTRAINT stores_status_check
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'suspended', 'revoked'));

CREATE TABLE store_strikes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    issued_by_administrator_id UUID NOT NULL REFERENCES administrators(id),
    reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 10 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    voided_at TIMESTAMPTZ,
    voided_by_administrator_id UUID REFERENCES administrators(id)
);

CREATE INDEX store_strikes_active_idx
    ON store_strikes (store_id, created_at DESC)
    WHERE voided_at IS NULL;

INSERT INTO schema_migrations (version)
VALUES ('0025_store_strikes_and_revocation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
