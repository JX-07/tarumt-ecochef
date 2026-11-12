BEGIN;
ALTER TABLE stores
    ADD COLUMN slot_order_limit INTEGER NOT NULL DEFAULT 10 CHECK (slot_order_limit > 0),
    ADD COLUMN slot_item_limit INTEGER NOT NULL DEFAULT 100 CHECK (slot_item_limit > 0);
ALTER TABLE orders ADD COLUMN fulfilment_slot TIMESTAMPTZ;
UPDATE orders o SET fulfilment_slot = date_trunc('hour', COALESCE(d.estimated_arrival, o.order_date))
    + floor(extract(minute FROM COALESCE(d.estimated_arrival, o.order_date)) / 30) * interval '30 minutes'
FROM payments p JOIN deliveries d ON d.payment_id = p.id WHERE p.order_id = o.id;
UPDATE orders SET fulfilment_slot = date_trunc('hour', order_date)
    + floor(extract(minute FROM order_date) / 30) * interval '30 minutes' WHERE fulfilment_slot IS NULL;
CREATE INDEX orders_fulfilment_slot_idx ON orders(fulfilment_slot);
INSERT INTO schema_migrations(version) VALUES ('0043') ON CONFLICT DO NOTHING;
COMMIT;
