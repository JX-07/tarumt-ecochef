BEGIN;

ALTER TABLE administrators
    ADD COLUMN can_invite_administrators BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN invited_by UUID REFERENCES administrators(id),
    ADD COLUMN invitation_sent_at TIMESTAMPTZ;

INSERT INTO schema_migrations (version)
VALUES ('0026_administrator_invitation_permissions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
