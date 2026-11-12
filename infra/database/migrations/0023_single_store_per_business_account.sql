BEGIN;

CREATE OR REPLACE FUNCTION enforce_single_store_per_business_account()
RETURNS TRIGGER AS $$
DECLARE
    account_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'stores' THEN
        account_id := NEW.business_owner_id;
        IF EXISTS (SELECT 1 FROM store_staff_memberships WHERE business_account_id = account_id) THEN
            RAISE EXCEPTION 'Business account already belongs to a store as staff.' USING ERRCODE = '23505';
        END IF;
    ELSE
        account_id := NEW.business_account_id;
        IF EXISTS (SELECT 1 FROM stores WHERE business_owner_id = account_id) THEN
            RAISE EXCEPTION 'Business account already owns a store.' USING ERRCODE = '23505';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stores_single_business_account_trigger ON stores;
CREATE TRIGGER stores_single_business_account_trigger
BEFORE INSERT OR UPDATE OF business_owner_id ON stores
FOR EACH ROW EXECUTE FUNCTION enforce_single_store_per_business_account();

DROP TRIGGER IF EXISTS staff_single_business_account_trigger ON store_staff_memberships;
CREATE TRIGGER staff_single_business_account_trigger
BEFORE INSERT OR UPDATE OF business_account_id ON store_staff_memberships
FOR EACH ROW EXECUTE FUNCTION enforce_single_store_per_business_account();

INSERT INTO schema_migrations (version) VALUES ('0023') ON CONFLICT (version) DO NOTHING;

COMMIT;
