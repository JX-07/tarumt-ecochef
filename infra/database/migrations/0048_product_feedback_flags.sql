BEGIN;
ALTER TABLE product_reviews ADD COLUMN removed_at TIMESTAMPTZ,
    ADD COLUMN removed_by_administrator_id UUID REFERENCES administrators(id);
CREATE TABLE product_feedback_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id UUID NOT NULL UNIQUE REFERENCES product_reviews(id),
    store_id UUID NOT NULL REFERENCES stores(id),
    author_id UUID NOT NULL REFERENCES business_owners(id),
    description VARCHAR(2000) NOT NULL CHECK(char_length(trim(description)) >= 10),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dismissed','removed')),
    resolution_note VARCHAR(1000), resolved_at TIMESTAMPTZ,
    moderator_id UUID REFERENCES administrators(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_feedback_flags_queue_idx ON product_feedback_flags(status,created_at);
INSERT INTO schema_migrations(version) VALUES ('0048') ON CONFLICT DO NOTHING;
COMMIT;
