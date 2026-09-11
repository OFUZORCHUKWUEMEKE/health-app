-- Admin account queries.

-- name: GetAdminByEmail :one
SELECT * FROM admins WHERE email = $1;

-- name: GetAdminByID :one
SELECT * FROM admins WHERE id = $1;

-- name: CreateAdmin :one
INSERT INTO admins (
    first_name, last_name, email, phone_number, password_hash, role,
    refresh_token_hash
) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;

-- name: UpdateAdminOnBootstrap :one
UPDATE admins SET
    first_name = $2, last_name = $3, phone_number = $4,
    password_hash = $5, role = $6
WHERE email = $1 RETURNING *;

-- name: SetAdminRefreshHash :exec
UPDATE admins SET refresh_token_hash = $2 WHERE id = $1;

-- name: SetAdminPassword :exec
UPDATE admins SET password_hash = $2 WHERE id = $1;

-- Admin listing/reporting queries (Milestone 11). Patient listing reuses the
-- doctor-feed search queries (same 6-field + DOB matching).

-- name: ListDoctors :many
SELECT * FROM doctors ORDER BY created_at DESC LIMIT $1 OFFSET $2;

-- name: CountDoctors :one
SELECT count(*) FROM doctors;

-- name: CountConsultationsSince :one
SELECT count(*) FROM consultations
WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at < $2);

-- name: CountMedicationsSince :one
SELECT count(*) FROM medications
WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at < $2);

-- name: CountInvestigationsSince :one
SELECT count(*) FROM investigation_lists
WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at < $2);

-- name: CountAppointmentsSince :one
SELECT count(*) FROM appointments
WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at < $2);
