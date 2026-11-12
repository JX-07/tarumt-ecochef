BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS stores_one_per_business_account_idx
    ON stores (business_owner_id);

CREATE TABLE IF NOT EXISTS store_staff_memberships (
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    business_account_id UUID NOT NULL REFERENCES business_owners(id) ON DELETE CASCADE,
    assigned_role VARCHAR(60) NOT NULL DEFAULT 'Staff',
    can_edit_store BOOLEAN NOT NULL DEFAULT false,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, business_account_id),
    UNIQUE (business_account_id)
);

CREATE TABLE IF NOT EXISTS store_staff_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    invited_email VARCHAR(100) NOT NULL,
    assigned_role VARCHAR(60) NOT NULL DEFAULT 'Staff',
    can_edit_store BOOLEAN NOT NULL DEFAULT false,
    invited_by UUID NOT NULL REFERENCES business_owners(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    UNIQUE (store_id, invited_email)
);

CREATE INDEX IF NOT EXISTS store_staff_invitations_email_idx
    ON store_staff_invitations (lower(invited_email), status);

INSERT INTO schema_migrations (version) VALUES ('0022') ON CONFLICT (version) DO NOTHING;

COMMIT;
