-- +goose Up
-- Milestone 5: clinical record (consultation + 11 child tables).
--
-- Intentional deviations from the Mongoose documents:
-- * The child-ID arrays on Consultation (medication_id[], diagnosis_id[],
--   ...) are dropped — they are derivable via consultation_id joins and
--   keeping both copies invites drift. Children own the FK with
--   ON DELETE CASCADE (explicit delete behavior; no soft deletes anywhere,
--   matching the product, which deletes records outright).
-- * consultations.reference stores the human-readable ID the API calls
--   consultation_id (a TEXT column named consultation_id would collide with
--   the FK convention used by every child table).
-- * Column consoltation_for keeps the contract misspelling (was consoltation_for).
-- * One-row-per-consultation stages (history_takings, physical_exams,
--   investigation_results, treatment_plans, diagnosis_forms) enforce
--   UNIQUE(consultation_id); services upsert.
-- * Status CHECKs are contract unions (frontend renders OPEN/IN_PROGRESS/
--   ADDENDED consultations, STOPPED/INACTIVE/PENDING medications).
-- * Legacy Investigation (name/file) is NOT a separate table — its role is
--   covered by investigation_lists; legacy Diagnosis maps to diagnoses.
-- * referrals.specialty has no CHECK (33-value taxonomy enforced app-side);
--   attachment_investigation_ids stays TEXT[] (was string[], may hold
--   non-UUID legacy ids).
-- * medications.start_date stays TEXT (was a string in the document).

CREATE TABLE consultations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID UNIQUE REFERENCES appointments (id) ON DELETE RESTRICT,
    reference TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL
        CONSTRAINT consultations_type_check CHECK (type IN ('CHAT', 'AUDIO', 'VIDEO', 'MEETADOCTOR', 'HOMESERVICE')),
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    consoltation_for TEXT NOT NULL
        CONSTRAINT consultations_for_check CHECK (consoltation_for IN ('SELF', 'OTHERS')),
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    session_number TEXT,
    parent_consultation_id TEXT,
    treatment_plan TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CONSTRAINT consultations_status_check CHECK (status IN (
            'PENDING', 'COMPLETED', 'CANCELED', 'ACTIVE', 'RESCHEDULED',
            'OPEN', 'IN_PROGRESS', 'ADDENDED')),
    meta JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER consultations_updated_at BEFORE UPDATE ON consultations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX consultations_patient_status_idx ON consultations (patient_id, status);
CREATE INDEX consultations_doctor_status_idx ON consultations (doctor_id, status);

CREATE TABLE complaint_histories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL REFERENCES consultations (id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    past_medical_history TEXT NOT NULL,
    medication TEXT,
    allergy TEXT,
    family TEXT,
    travel TEXT,
    occupation TEXT,
    social TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER complaint_histories_updated_at BEFORE UPDATE ON complaint_histories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX complaint_histories_consultation_idx ON complaint_histories (consultation_id);

CREATE TABLE history_takings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL UNIQUE REFERENCES consultations (id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    present_complaint TEXT NOT NULL,
    history_of_presenting_complaint TEXT,
    past_medical_surgical_history TEXT,
    medication_history TEXT,
    allergy_history TEXT[] NOT NULL DEFAULT '{}',
    family_history TEXT,
    travel_history TEXT,
    occupation TEXT,
    social_history TEXT,
    obstetric_gynaecological_history TEXT,
    others TEXT,
    status TEXT NOT NULL DEFAULT 'INCOMPLETE'
        CONSTRAINT history_takings_status_check CHECK (status IN ('COMPLETED', 'INCOMPLETE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER history_takings_updated_at BEFORE UPDATE ON history_takings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX history_takings_patient_idx ON history_takings (patient_id);

CREATE TABLE physical_exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL UNIQUE REFERENCES consultations (id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    general_physical TEXT,
    nervous_system TEXT,
    respiratory_system TEXT,
    cardiovascular_system TEXT,
    gastrointestinal_system TEXT,
    genitourinary_system TEXT,
    musculoskeletal_system TEXT,
    ent TEXT,
    obstetric_gynaecological TEXT,
    others TEXT,
    status TEXT NOT NULL DEFAULT 'INCOMPLETE'
        CONSTRAINT physical_exams_status_check CHECK (status IN ('COMPLETED', 'INCOMPLETE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER physical_exams_updated_at BEFORE UPDATE ON physical_exams
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE diagnosis_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL UNIQUE REFERENCES consultations (id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    provisional_diagnosis TEXT[] NOT NULL DEFAULT '{}',
    final_diagnosis TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'INCOMPLETE'
        CONSTRAINT diagnosis_forms_status_check CHECK (status IN ('COMPLETED', 'INCOMPLETE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER diagnosis_forms_updated_at BEFORE UPDATE ON diagnosis_forms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE diagnoses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL REFERENCES consultations (id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'INCOMPLETE'
        CONSTRAINT diagnoses_status_check CHECK (status IN ('COMPLETED', 'INCOMPLETE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER diagnoses_updated_at BEFORE UPDATE ON diagnoses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX diagnoses_consultation_idx ON diagnoses (consultation_id);

CREATE TABLE medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL REFERENCES consultations (id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    formulary TEXT NOT NULL
        CONSTRAINT medications_formulary_check CHECK (formulary IN ('TABLET', 'CAPSULE', 'SYRUP', 'INJECTION')),
    medication TEXT NOT NULL,
    dose NUMERIC NOT NULL CONSTRAINT medications_dose_check CHECK (dose >= 0),
    unit TEXT NOT NULL
        CONSTRAINT medications_unit_check CHECK (unit IN (
            'MILLIGRAM', 'MICROGRAM', 'PUFFS', 'TAB', 'CAB', 'MLS', 'LITRE')),
    interval TEXT NOT NULL
        CONSTRAINT medications_interval_check CHECK (interval IN ('DAILY', 'WEEKLY', 'MONTHLY', 'AS_NEEDED')),
    duration NUMERIC NOT NULL CONSTRAINT medications_duration_check CHECK (duration >= 0),
    duration_unit TEXT NOT NULL
        CONSTRAINT medications_duration_unit_check CHECK (duration_unit IN ('MINUTE', 'HOUR', 'DAY', 'MONTH')),
    order_instruction TEXT,
    start_date TEXT,
    assign_to_patient BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CONSTRAINT medications_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'PENDING', 'STOPPED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER medications_updated_at BEFORE UPDATE ON medications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX medications_consultation_patient_idx ON medications (consultation_id, patient_id);
CREATE INDEX medications_patient_status_idx ON medications (patient_id, status);
CREATE INDEX medications_doctor_assigned_idx ON medications (doctor_id, assign_to_patient);

CREATE TABLE investigation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL UNIQUE REFERENCES consultations (id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    blood_test TEXT,
    microbiology TEXT,
    radiology TEXT,
    cardiovascular TEXT,
    procedures TEXT,
    others TEXT,
    status TEXT NOT NULL DEFAULT 'INCOMPLETE'
        CONSTRAINT investigation_results_status_check CHECK (status IN ('COMPLETED', 'INCOMPLETE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER investigation_results_updated_at BEFORE UPDATE ON investigation_results
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE investigation_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL REFERENCES consultations (id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    category TEXT,
    test_requested TEXT,
    priority TEXT NOT NULL DEFAULT 'Routine',
    specimen TEXT NOT NULL DEFAULT '-',
    assign_to_patient BOOLEAN NOT NULL DEFAULT false,
    result_images TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER investigation_lists_updated_at BEFORE UPDATE ON investigation_lists
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX investigation_lists_consultation_idx ON investigation_lists (consultation_id);
CREATE INDEX investigation_lists_patient_assigned_idx ON investigation_lists (patient_id, assign_to_patient);
CREATE INDEX investigation_lists_doctor_assigned_idx ON investigation_lists (doctor_id, assign_to_patient);

CREATE TABLE treatment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL UNIQUE REFERENCES consultations (id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    treatment_plan_details TEXT,
    status TEXT NOT NULL DEFAULT 'INCOMPLETE'
        CONSTRAINT treatment_plans_status_check CHECK (status IN ('COMPLETED', 'INCOMPLETE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER treatment_plans_updated_at BEFORE UPDATE ON treatment_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL REFERENCES consultations (id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    referred_doctor_name TEXT,
    specialist_name TEXT NOT NULL,
    specialty TEXT,
    hospital TEXT NOT NULL,
    hospital_address TEXT[] NOT NULL DEFAULT '{}',
    attachment_investigation_ids TEXT[] NOT NULL DEFAULT '{}',
    referral_details TEXT NOT NULL,
    assign_to_patient BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER referrals_updated_at BEFORE UPDATE ON referrals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX referrals_consultation_assigned_idx ON referrals (consultation_id, assign_to_patient);
CREATE INDEX referrals_patient_assigned_idx ON referrals (patient_id, assign_to_patient);
CREATE INDEX referrals_doctor_assigned_idx ON referrals (doctor_id, assign_to_patient);

-- +goose Down
DROP TABLE IF EXISTS referrals;
DROP TABLE IF EXISTS treatment_plans;
DROP TABLE IF EXISTS investigation_lists;
DROP TABLE IF EXISTS investigation_results;
DROP TABLE IF EXISTS medications;
DROP TABLE IF EXISTS diagnoses;
DROP TABLE IF EXISTS diagnosis_forms;
DROP TABLE IF EXISTS physical_exams;
DROP TABLE IF EXISTS history_takings;
DROP TABLE IF EXISTS complaint_histories;
DROP TABLE IF EXISTS consultations;
