BEGIN;

ALTER TABLE administrators
    DROP COLUMN can_invite_administrators,
    DROP COLUMN can_undo_other_administrators;

INSERT INTO schema_migrations (version)
VALUES ('0029_remove_delegated_administrator_permissions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
