BEGIN;

CREATE OR REPLACE FUNCTION enforce_global_account_identity_uniqueness()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Serialize checks for the normalized email to avoid cross-table race conditions.
    PERFORM pg_advisory_xact_lock(hashtext(lower(NEW.email)));

    IF EXISTS (
        SELECT 1 FROM users
        WHERE (lower(email) = lower(NEW.email) OR firebase_uid = NEW.firebase_uid)
          AND (TG_TABLE_NAME <> 'users' OR id <> NEW.id)
    ) OR EXISTS (
        SELECT 1 FROM business_owners
        WHERE (lower(email) = lower(NEW.email) OR firebase_uid = NEW.firebase_uid)
          AND (TG_TABLE_NAME <> 'business_owners' OR id <> NEW.id)
    ) OR EXISTS (
        SELECT 1 FROM administrators
        WHERE (lower(email) = lower(NEW.email) OR firebase_uid = NEW.firebase_uid)
          AND (TG_TABLE_NAME <> 'administrators' OR id <> NEW.id)
    ) THEN
        RAISE EXCEPTION 'An EcoChef account already uses this email or Firebase identity'
            USING ERRCODE = 'unique_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER users_global_account_identity_trigger
BEFORE INSERT OR UPDATE OF email, firebase_uid ON users
FOR EACH ROW EXECUTE FUNCTION enforce_global_account_identity_uniqueness();

CREATE TRIGGER business_owners_global_account_identity_trigger
BEFORE INSERT OR UPDATE OF email, firebase_uid ON business_owners
FOR EACH ROW EXECUTE FUNCTION enforce_global_account_identity_uniqueness();

CREATE TRIGGER administrators_global_account_identity_trigger
BEFORE INSERT OR UPDATE OF email, firebase_uid ON administrators
FOR EACH ROW EXECUTE FUNCTION enforce_global_account_identity_uniqueness();

INSERT INTO schema_migrations (version) VALUES ('0004_global_account_identity_uniqueness');

COMMIT;
