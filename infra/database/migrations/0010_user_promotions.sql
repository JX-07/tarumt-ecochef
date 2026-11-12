BEGIN;

ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS code VARCHAR(30);
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS title VARCHAR(100);
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS description VARCHAR(300);
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'available';

UPDATE promo_codes SET
    code = COALESCE(code, 'PROMO-' || upper(left(id::text, 8))),
    title = COALESCE(title, 'EcoChef promotion'),
    description = COALESCE(description, 'A promotion available through EcoChef.');

ALTER TABLE promo_codes ALTER COLUMN code SET NOT NULL;
ALTER TABLE promo_codes ALTER COLUMN title SET NOT NULL;
ALTER TABLE promo_codes ALTER COLUMN description SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_code_uq ON promo_codes(code);

ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_audience_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_audience_check CHECK (audience IN ('available', 'new_account', 'gift'));

CREATE TABLE IF NOT EXISTS user_promo_codes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    redeemed_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, promo_code_id)
);

INSERT INTO promo_codes (code, title, description, discount_percent, discount_amount, status, start_date, end_date, usage_limit, audience)
VALUES
    ('VEGGIE20', 'Fresh vegetables', 'Save 20% on selected vegetables from participating vendors.', 20, NULL, 'active', now() - interval '1 day', now() + interval '90 days', 10000, 'available'),
    ('WELCOME10', 'Welcome offer', 'Get RM10 off your first marketplace order.', NULL, 10, 'active', now() - interval '1 day', now() + interval '365 days', 10000, 'new_account'),
    ('ECOFRIEND', 'A gift from EcoChef', 'You received this promo code as a thank-you for reducing food waste.', 10, NULL, 'active', now() - interval '1 day', now() + interval '120 days', 10000, 'gift')
ON CONFLICT (code) DO NOTHING;

INSERT INTO user_promo_codes (user_id, promo_code_id)
SELECT u.id, p.id FROM users u CROSS JOIN promo_codes p WHERE p.code = 'ECOFRIEND'
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('0010') ON CONFLICT (version) DO NOTHING;

COMMIT;
