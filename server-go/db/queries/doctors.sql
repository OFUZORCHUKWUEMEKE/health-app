-- Doctor account queries.

-- name: GetDoctorByEmail :one
SELECT * FROM doctors WHERE email = $1;

-- name: GetDoctorByID :one
SELECT * FROM doctors WHERE id = $1;

-- name: CreateDoctor :one
INSERT INTO doctors (
    doctor_no, first_name, last_name, full_name, email, phone_number,
    password_hash, active, profile_picture_url, specializations, license_no,
    mrn, refresh_token_hash
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
) RETURNING *;

-- name: SetDoctorRefreshHash :exec
UPDATE doctors SET refresh_token_hash = $2 WHERE id = $1;

-- name: SetDoctorPassword :exec
UPDATE doctors SET password_hash = $2 WHERE id = $1;

-- Doctor self-service queries (Milestone 10). COALESCE allowlist mirrors the
-- Nest DTO (6 keys); first/last take merged values for the NOT NULL columns.

-- name: UpdateDoctorProfile :one
UPDATE doctors SET
    first_name = COALESCE($2, first_name),
    last_name = COALESCE($3, last_name),
    phone_number = COALESCE($4, phone_number),
    profile_picture_url = COALESCE($5, profile_picture_url),
    specializations = COALESCE($6, specializations),
    license_no = COALESCE($7, license_no),
    full_name = COALESCE($8, full_name),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: SetDoctorTimezone :one
UPDATE doctors SET timezone = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: SetDoctorProfilePicture :one
UPDATE doctors SET profile_picture_url = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: SetDoctorActive :one
UPDATE doctors SET active = $2,
    refresh_token_hash = CASE WHEN $2 = false THEN NULL ELSE refresh_token_hash END,
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: ListPatientsForDoctor :many
SELECT * FROM patients
WHERE ($1 = ''
    OR first_name ILIKE '%' || $1 || '%'
    OR last_name ILIKE '%' || $1 || '%'
    OR full_name ILIKE '%' || $1 || '%'
    OR email ILIKE '%' || $1 || '%'
    OR phone_number ILIKE '%' || $1 || '%'
    OR registration_no ILIKE '%' || $1 || '%'
    OR ($4::date IS NOT NULL AND date_of_birth = $4))
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountPatientsForDoctor :one
SELECT count(*) FROM patients
WHERE ($1 = ''
    OR first_name ILIKE '%' || $1 || '%'
    OR last_name ILIKE '%' || $1 || '%'
    OR full_name ILIKE '%' || $1 || '%'
    OR email ILIKE '%' || $1 || '%'
    OR phone_number ILIKE '%' || $1 || '%'
    OR registration_no ILIKE '%' || $1 || '%'
    OR ($2::date IS NOT NULL AND date_of_birth = $2));

-- name: LatestConsultationIDs :many
SELECT patient_id::text AS patient_id, id::text AS consultation_id
FROM consultations
WHERE patient_id::text = ANY($1::text[])
ORDER BY created_at DESC;

-- name: DoctorConsultationPatientIDs :many
SELECT DISTINCT patient_id::text AS patient_id
FROM consultations
WHERE doctor_id = $1 AND patient_id::text = ANY($2::text[]);

-- name: CountDoctorOpenConsultations :one
SELECT count(*) FROM consultations
WHERE doctor_id = $1 AND status NOT IN ('COMPLETED', 'CANCELED');

-- name: CountConsultsWithUnsentMeds :one
SELECT count(DISTINCT consultation_id) FROM medications
WHERE doctor_id = $1 AND assign_to_patient IS DISTINCT FROM true;

-- name: CountConsultsWithUnsentLists :one
SELECT count(DISTINCT consultation_id) FROM investigation_lists
WHERE doctor_id = $1 AND assign_to_patient IS DISTINCT FROM true;

-- name: CountDoctorUpcomingAppointments :one
SELECT count(*) FROM appointments
WHERE doctor_id = $1 AND status IN ('PENDING', 'CONFIRMED')
  AND scheduled_start_at_utc >= now();

-- name: GetDoctorsByIDs :many
SELECT * FROM doctors WHERE id = ANY($1::uuid[]);

-- name: GetActiveDoctorsByIDs :many
SELECT * FROM doctors WHERE id = ANY($1::uuid[]) AND active = true;
