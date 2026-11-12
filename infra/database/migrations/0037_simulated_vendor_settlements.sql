BEGIN;

ALTER TABLE payment_vendor_allocations
    ALTER COLUMN stripe_account_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS settlement_method VARCHAR(30) NOT NULL DEFAULT 'simulated';

UPDATE payment_vendor_allocations
SET settlement_method = CASE
    WHEN stripe_transfer_id IS NOT NULL THEN 'stripe_transfer'
    ELSE 'simulated'
END;

INSERT INTO schema_migrations (version) VALUES ('0037') ON CONFLICT (version) DO NOTHING;

COMMIT;
