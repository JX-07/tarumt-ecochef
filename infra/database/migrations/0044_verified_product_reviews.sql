BEGIN;

-- Legacy store_reviews are deliberately retained but are not included in the
-- new aggregate: they cannot prove which purchased product was reviewed.
CREATE TABLE product_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    product_id UUID NOT NULL REFERENCES products(id),
    store_id UUID NOT NULL REFERENCES stores(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment VARCHAR(2000),
    date_submitted TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, product_id)
);
CREATE INDEX product_reviews_store_idx ON product_reviews(store_id, date_submitted DESC);
CREATE INDEX product_reviews_product_idx ON product_reviews(product_id, date_submitted DESC);

INSERT INTO schema_migrations(version) VALUES ('0044') ON CONFLICT DO NOTHING;
COMMIT;
