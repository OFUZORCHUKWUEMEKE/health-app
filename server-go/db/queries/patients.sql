-- Patient account queries.

-- name: GetPatientByEmail :one
SELECT * FROM patients WHERE email = $1;

-- name: GetPatientByID :one
SELECT * FROM patients WHERE id = $1;

-- name: CreatePatient :one
INSERT INTO patients (
    registration_no, mrn, first_name, last_name, middle_name, full_name,
    email, phone_number, password_hash, provider, verified, profile_picture_url,
    refresh_token_hash
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
) RETURNING *;

-- name: SetPatientRefreshHash :exec
UPDATE patients SET refresh_token_hash = $2 WHERE id = $1;

-- name: SetPatientPassword :exec
UPDATE patients SET password_hash = $2 WHERE id = $1;

-- name: SetPatientProviderVerified :exec
UPDATE patients SET provider = $2, verified = true WHERE id = $1;

-- Patient self-service queries (Milestone 9). COALESCE updates implement the
-- Nest $set allowlist: NULL params leave the column untouched (including
-- empty-string-to-NULL coercion done in the service), while an explicitly
-- empty array clears the list. Unknown keys are rejected in HTTP binding.

-- name: UpdatePatientProfile :one
UPDATE patients SET
    first_name = COALESCE($2, first_name),
    last_name = COALESCE($3, last_name),
    middle_name = COALESCE($4, middle_name),
    phone_number = COALESCE($5, phone_number),
    date_of_birth = COALESCE($6, date_of_birth),
    gender = COALESCE($7, gender),
    marital_status = COALESCE($8, marital_status),
    occupation = COALESCE($9, occupation),
    address = COALESCE($10, address),
    profile_picture_url = COALESCE($11, profile_picture_url),
    allergies = COALESCE($12, allergies),
    previous_medical_conditions = COALESCE($13, previous_medical_conditions),
    medical_flags = COALESCE($14, medical_flags),
    full_name = COALESCE($15, full_name),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: SetPatientTimezone :one
UPDATE patients SET timezone = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: SetPatientProfilePicture :one
UPDATE patients SET profile_picture_url = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: CountOpenConsultations :one
SELECT count(*) FROM consultations
WHERE patient_id = $1 AND status NOT IN ('COMPLETED', 'CANCELED');

-- name: CountMedsInOpenConsultations :one
SELECT count(*) FROM medications m
JOIN consultations c ON c.id = m.consultation_id
WHERE m.patient_id = $1 AND c.status NOT IN ('COMPLETED', 'CANCELED');

-- name: CountAssignedInvestigationsNoImages :one
SELECT count(*) FROM investigation_lists
WHERE patient_id = $1 AND assign_to_patient = true AND result_images = '{}';

-- name: CountUpcomingAppointments :one
SELECT count(*) FROM appointments
WHERE patient_id = $1 AND status IN ('PENDING', 'CONFIRMED')
  AND scheduled_start_at_utc >= now();

-- name: ReconcilePatientFromBooking :exec
UPDATE patients SET
    first_name = $2, last_name = $3, gender = $4, marital_status = $5,
    occupation = $6, timezone = $7, date_of_birth = $8, full_name = $9,
    allergies = $10, previous_medical_conditions = $11, updated_at = now()
WHERE id = $1;
