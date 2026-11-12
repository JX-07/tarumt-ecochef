BEGIN;

ALTER TABLE business_owners ADD COLUMN business_name VARCHAR(100);

ALTER TABLE stores
    ADD CONSTRAINT stores_status_check
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'suspended'));

INSERT INTO schema_migrations (version) VALUES ('0003_business_owner_portal_access');

COMMIT;
