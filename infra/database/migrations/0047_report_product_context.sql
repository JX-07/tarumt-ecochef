BEGIN;
-- Keep the selected product name as evidence if the listing later changes.
ALTER TABLE content_reports
    ADD COLUMN product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    ADD COLUMN product_name VARCHAR(100);
CREATE INDEX content_reports_product_idx ON content_reports(product_id) WHERE product_id IS NOT NULL;
INSERT INTO schema_migrations(version) VALUES ('0047') ON CONFLICT DO NOTHING;
COMMIT;
