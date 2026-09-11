-- +goose Up
-- Milestone 5: accounts + MRN registry.
--
-- Intentional deviations from the Mongoose documents:
-- * UUID PKs (gen_random_uuid, builtin) instead of ObjectIds.
-- * PG UNIQUE allows multiple NULLs, so mrn/license_no need no sparse
--   indexes — the null-collision bug class from index-error-logger.ts cannot
--   occur. mrn_registry keeps the cross-type guarantee: allocation inserts
--   here first, unique violation means "someone else won" (see mrn.service).
-- * Emails are TEXT; lowercasing stays app-side (was lowercase:true).
-- * OTP rows have no TTL index in PG — otp_expires_at is indexed for a
--   sweeper job (domain milestone). Same for notification retention (00005).
-- * Admin refresh tokens stay stateless (no column), as in the Nest code.

-- StatementBegin/End keeps the function body (inner semicolons) as one
-- statement for the migration parser.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_no TEXT NOT NULL UNIQUE,
    mrn TEXT UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    middle_name TEXT,
    full_name TEXT,
    email TEXT NOT NULL UNIQUE,
    phone_number TEXT,
    password_hash TEXT,
    provider TEXT NOT NULL DEFAULT 'LOCAL'
        CONSTRAINT patients_provider_check CHECK (provider IN ('LOCAL', 'GOOGLE')),
    verified BOOLEAN NOT NULL DEFAULT false,
    date_of_birth DATE,
    gender TEXT,
    marital_status TEXT,
    occupation TEXT,
    address TEXT,
    timezone TEXT,
    profile_picture_url TEXT,
    allergies TEXT[] NOT NULL DEFAULT '{}',
    previous_medical_conditions TEXT[] NOT NULL DEFAULT '{}',
    medical_flags TEXT[] NOT NULL DEFAULT '{}',
    terms_accepted BOOLEAN NOT NULL DEFAULT false,
    terms_accepted_at TIMESTAMPTZ,
    refresh_token_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER patients_updated_at BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_no TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    full_name TEXT,
    email TEXT NOT NULL UNIQUE,
    phone_number TEXT,
    password_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    profile_picture_url TEXT,
    timezone TEXT,
    specializations TEXT[] NOT NULL DEFAULT '{}',
    license_no TEXT UNIQUE,
    mrn TEXT UNIQUE,
    refresh_token_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER doctors_updated_at BEFORE UPDATE ON doctors
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Doctor search by specialization among active doctors.
CREATE INDEX doctors_specializations_active_idx ON doctors USING GIN (specializations)
    WHERE active = true;

CREATE TABLE admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone_number TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'moderator'
        CONSTRAINT admins_role_check CHECK (role IN ('super_admin', 'moderator')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER admins_updated_at BEFORE UPDATE ON admins
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE pending_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    otp_hash TEXT NOT NULL,
    otp_expires_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    resend_count INTEGER NOT NULL DEFAULT 0,
    resend_window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cooldown_until TIMESTAMPTZ,
    verified BOOLEAN NOT NULL DEFAULT false,
    verified_at TIMESTAMPTZ,
    registration_token_jti TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER pending_registrations_updated_at BEFORE UPDATE ON pending_registrations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pending_registrations_expires_idx ON pending_registrations (otp_expires_at);

CREATE TABLE pending_password_resets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    otp_hash TEXT NOT NULL,
    otp_expires_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    resend_count INTEGER NOT NULL DEFAULT 0,
    resend_window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cooldown_until TIMESTAMPTZ,
    reset_token_jti TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER pending_password_resets_updated_at BEFORE UPDATE ON pending_password_resets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pending_password_resets_expires_idx ON pending_password_resets (otp_expires_at);

-- MRN allocation ledger. Rows are permanent, never recycled; owner_id stays
-- NULL between reservation and signup completion (orphans = failed signups).
CREATE TABLE mrn_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mrn TEXT NOT NULL UNIQUE,
    owner_type TEXT NOT NULL
        CONSTRAINT mrn_registry_owner_check CHECK (owner_type IN ('doctor', 'patient')),
    owner_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER mrn_registry_updated_at BEFORE UPDATE ON mrn_registry
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX mrn_registry_owner_idx ON mrn_registry (owner_type, owner_id);

-- +goose Down
DROP TABLE IF EXISTS mrn_registry;
DROP TABLE IF EXISTS pending_password_resets;
DROP TABLE IF EXISTS pending_registrations;
DROP TABLE IF EXISTS admins;
DROP TABLE IF EXISTS doctors;
DROP TABLE IF EXISTS patients;
DROP FUNCTION IF EXISTS set_updated_at();
