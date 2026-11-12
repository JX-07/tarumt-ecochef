BEGIN;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS inventory_deducted_at TIMESTAMPTZ;

-- Checkouts created before this migration reserved inventory before payment.
-- Record those deductions so legacy failures can still restore them once.
UPDATE payments
SET inventory_deducted_at = COALESCE(paid_at, payment_date)
WHERE inventory_released_at IS NULL
  AND inventory_deducted_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('0038') ON CONFLICT (version) DO NOTHING;

COMMIT;
