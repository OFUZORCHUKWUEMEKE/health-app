-- +goose Up
-- Milestone 5: scheduling (appointments, availability, blackouts).
--
-- Intentional deviations from the Mongoose documents:
-- * appointment_number is NOT NULL UNIQUE (was sparse+index, not unique).
--   Lookup-by-number is a required frontend flow, so generation (M7,
--   e.g. APT-20260326-XXXX) becomes mandatory, not optional.
-- * status CHECK is the union of Nest AppointmentStatus and the extra states
--   the frontend already renders (ACTIVE, NO_SHOW, FAILED, FORFEITED).
--   The double-booking guard keeps the exact Nest filter (PENDING,CONFIRMED).
-- * DB column medical_conditions maps to API Medical_conditions (capital M).
-- * doctor_snapshot JSONB is new: denormalized doctor display fields at
--   booking time, mirroring booking_profile_snapshot for stable history.
-- * provider_meta JSONB holds raw Daily.co responses (was scattered columns).
-- * Reminder claiming is a plain UPDATE ... WHERE sent_at IS NULL in PG —
--   the Mongo partialFilterExpression/$exists limitation does not apply.

CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_number TEXT NOT NULL UNIQUE,
    patient_id UUID REFERENCES patients (id) ON DELETE RESTRICT,
    doctor_id UUID REFERENCES doctors (id) ON DELETE RESTRICT,
    scheduled_start_at_utc TIMESTAMPTZ NOT NULL,
    scheduled_end_at_utc TIMESTAMPTZ NOT NULL,
    CONSTRAINT appointments_window_check CHECK (scheduled_end_at_utc > scheduled_start_at_utc),
    timezone_snapshot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CONSTRAINT appointments_status_check CHECK (status IN (
            'PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELED',
            'NO_SHOW', 'FAILED', 'FORFEITED', 'RESCHEDULED')),
    appointment_for TEXT NOT NULL DEFAULT 'SELF'
        CONSTRAINT appointments_for_check CHECK (appointment_for IN ('SELF', 'OTHERS')),
    reason_for_visit TEXT NOT NULL DEFAULT '',
    complaint_brief TEXT,
    medical_conditions TEXT[] NOT NULL DEFAULT '{}',
    allergies TEXT[] NOT NULL DEFAULT '{}',
    booking_profile_snapshot JSONB NOT NULL DEFAULT '{}',
    doctor_snapshot JSONB NOT NULL DEFAULT '{}',
    provider_meta JSONB NOT NULL DEFAULT '{}',
    cancelled_by TEXT
        CONSTRAINT appointments_cancelled_by_check CHECK (cancelled_by IN ('admin', 'doctor', 'patient')),
    cancelled_reason TEXT,
    rescheduled_from_appointment_id UUID REFERENCES appointments (id) ON DELETE RESTRICT,
    daily_room_name TEXT,
    daily_room_url TEXT,
    daily_room_expires_at TIMESTAMPTZ,
    daily_recording_id TEXT,
    video_started_at TIMESTAMPTZ,
    video_ended_at TIMESTAMPTZ,
    reminder_24h_sent_at TIMESTAMPTZ,
    reminder_1h_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Double-booking prevention: same doctor, same slot, active status.
CREATE UNIQUE INDEX appointments_no_double_book_idx ON appointments (doctor_id, scheduled_start_at_utc)
    WHERE doctor_id IS NOT NULL AND status IN ('PENDING', 'CONFIRMED');
CREATE INDEX appointments_doctor_schedule_idx ON appointments (doctor_id, scheduled_start_at_utc, status);
CREATE INDEX appointments_patient_schedule_idx ON appointments (patient_id, scheduled_start_at_utc);
CREATE INDEX appointments_patient_status_idx ON appointments (patient_id, status, scheduled_start_at_utc);
-- Reminder sweep (CONFIRMED in window, claim columns filtered at query time).
CREATE INDEX appointments_reminder_scan_idx ON appointments (status, scheduled_start_at_utc);

-- One availability document per doctor; slots are an opaque validated array
-- read/written as a unit (was an embedded sub-document).
CREATE TABLE doctor_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID NOT NULL UNIQUE REFERENCES doctors (id) ON DELETE CASCADE,
    timezone TEXT NOT NULL,
    weekly_slots JSONB NOT NULL DEFAULT '[]'
        CONSTRAINT doctor_availability_slots_json_check CHECK (jsonb_typeof(weekly_slots) = 'array'),
    effective_from DATE,
    effective_to DATE,
    CONSTRAINT doctor_availability_window_check CHECK (
        effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER doctor_availability_updated_at BEFORE UPDATE ON doctor_availability
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Column reccuring keeps the API-contract misspelling (was reccuring in
-- the Mongoose schema); recurring_rule_id was never persisted, not added.
CREATE TABLE doctor_blackouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID NOT NULL REFERENCES doctors (id) ON DELETE CASCADE,
    start_at_utc TIMESTAMPTZ NOT NULL,
    end_at_utc TIMESTAMPTZ NOT NULL,
    CONSTRAINT doctor_blackouts_window_check CHECK (end_at_utc > start_at_utc),
    reason TEXT NOT NULL DEFAULT '',
    reccuring BOOLEAN NOT NULL DEFAULT false,
    timezone TEXT,
    day_of_week SMALLINT
        CONSTRAINT doctor_blackouts_dow_check CHECK (day_of_week BETWEEN 0 AND 6),
    start_time_minutes INTEGER
        CONSTRAINT doctor_blackouts_start_min_check CHECK (start_time_minutes BETWEEN 0 AND 1439),
    end_time_minutes INTEGER
        CONSTRAINT doctor_blackouts_end_min_check CHECK (end_time_minutes BETWEEN 1 AND 1440),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER doctor_blackouts_updated_at BEFORE UPDATE ON doctor_blackouts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX doctor_blackouts_window_idx ON doctor_blackouts (doctor_id, start_at_utc, end_at_utc);
CREATE INDEX doctor_blackouts_recurring_idx ON doctor_blackouts
    (doctor_id, reccuring, day_of_week, start_time_minutes, end_time_minutes);

-- +goose Down
DROP TABLE IF EXISTS doctor_blackouts;
DROP TABLE IF EXISTS doctor_availability;
DROP TABLE IF EXISTS appointments;
