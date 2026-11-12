BEGIN;

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS stripe_transfers_status VARCHAR(30) NOT NULL DEFAULT 'not_requested',
    ADD COLUMN IF NOT EXISTS stripe_onboarding_complete_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS stores_stripe_account_id_idx
    ON stores (stripe_account_id) WHERE stripe_account_id IS NOT NULL;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS stripe_charge_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS stripe_invoice_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS stripe_hosted_invoice_url TEXT,
    ADD COLUMN IF NOT EXISTS stripe_invoice_pdf_url TEXT,
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(500),
    ADD COLUMN IF NOT EXISTS inventory_released_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_checkout_session_id_idx
    ON payments (stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_payment_intent_id_idx
    ON payments (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    store_id UUID NOT NULL REFERENCES stores(id),
    product_name VARCHAR(100) NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    line_total NUMERIC(10, 2) NOT NULL CHECK (line_total >= 0),
    discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    net_amount NUMERIC(10, 2) NOT NULL CHECK (net_amount >= 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_store_idx ON order_items (store_id, order_id);

-- Preserve existing development orders before reports switch to immutable snapshots.
INSERT INTO order_items
  (order_id, product_id, store_id, product_name, unit_price, quantity,
   line_total, discount_amount, net_amount)
SELECT o.id, p.id, p.store_id, p.product_name, p.price, ci.quantity,
       ROUND(p.price * ci.quantity, 2), 0, ROUND(p.price * ci.quantity, 2)
FROM orders o
JOIN cart_items ci ON ci.cart_id = o.cart_id
JOIN products p ON p.id = ci.product_id
WHERE NOT EXISTS (SELECT 1 FROM order_items snapshot WHERE snapshot.order_id = o.id);

CREATE TABLE IF NOT EXISTS payment_vendor_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id),
    stripe_account_id VARCHAR(255) NOT NULL,
    gross_amount NUMERIC(10, 2) NOT NULL CHECK (gross_amount >= 0),
    platform_fee_amount NUMERIC(10, 2) NOT NULL CHECK (platform_fee_amount >= 0),
    transfer_amount NUMERIC(10, 2) NOT NULL CHECK (transfer_amount >= 0),
    stripe_transfer_id VARCHAR(255),
    stripe_transfer_reversal_id VARCHAR(255),
    reversed_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (reversed_amount >= 0),
    transfer_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    transferred_at TIMESTAMPTZ,
    reversed_at TIMESTAMPTZ,
    UNIQUE (payment_id, store_id)
);

CREATE INDEX IF NOT EXISTS payment_vendor_allocations_payment_idx
    ON payment_vendor_allocations (payment_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    event_id VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('0036') ON CONFLICT (version) DO NOTHING;

COMMIT;
