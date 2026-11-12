BEGIN;

ALTER TABLE administrators
    ADD COLUMN can_undo_other_administrators BOOLEAN NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version)
VALUES ('0027_administrator_undo_permissions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
