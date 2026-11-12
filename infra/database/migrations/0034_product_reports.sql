BEGIN;
CREATE TABLE IF NOT EXISTS product_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report_request VARCHAR(1000) NOT NULL,
    date_reported TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, reporter_user_id)
);
CREATE INDEX IF NOT EXISTS product_reports_product_idx ON product_reports(product_id, date_reported DESC);
INSERT INTO schema_migrations(version) VALUES ('0034_product_reports') ON CONFLICT (version) DO NOTHING;
COMMIT;
