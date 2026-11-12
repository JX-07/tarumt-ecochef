BEGIN;

ALTER TABLE users ADD COLUMN firebase_uid VARCHAR(128);
ALTER TABLE business_owners ADD COLUMN firebase_uid VARCHAR(128);
ALTER TABLE administrators ADD COLUMN firebase_uid VARCHAR(128);

ALTER TABLE users DROP COLUMN password_hash;
ALTER TABLE business_owners DROP COLUMN password_hash;
ALTER TABLE administrators DROP COLUMN password_hash;

ALTER TABLE users ALTER COLUMN firebase_uid SET NOT NULL;
ALTER TABLE business_owners ALTER COLUMN firebase_uid SET NOT NULL;
ALTER TABLE administrators ALTER COLUMN firebase_uid SET NOT NULL;

ALTER TABLE users ADD CONSTRAINT users_firebase_uid_uq UNIQUE (firebase_uid);
ALTER TABLE business_owners ADD CONSTRAINT business_owners_firebase_uid_uq UNIQUE (firebase_uid);
ALTER TABLE administrators ADD CONSTRAINT administrators_firebase_uid_uq UNIQUE (firebase_uid);

INSERT INTO schema_migrations (version) VALUES ('0002_adopt_firebase_identity');

COMMIT;
