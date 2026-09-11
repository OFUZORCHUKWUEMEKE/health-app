-- OTP staging queries. Upserts keep one row per email (was
-- findOneAndUpdate in Mongoose); verified/jti fields enforce single use.

-- name: GetPendingRegistration :one
SELECT * FROM pending_registrations WHERE email = $1;

-- name: UpsertPendingRegistration :one
INSERT INTO pending_registrations (
    email, otp_hash, otp_expires_at, attempt_count, resend_count,
    resend_window_started_at, cooldown_until, verified, verified_at,
    registration_token_jti
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (email) DO UPDATE SET
    otp_hash = EXCLUDED.otp_hash,
    otp_expires_at = EXCLUDED.otp_expires_at,
    attempt_count = EXCLUDED.attempt_count,
    resend_count = EXCLUDED.resend_count,
    resend_window_started_at = EXCLUDED.resend_window_started_at,
    cooldown_until = EXCLUDED.cooldown_until,
    verified = EXCLUDED.verified,
    verified_at = EXCLUDED.verified_at,
    registration_token_jti = EXCLUDED.registration_token_jti
RETURNING *;

-- name: BumpRegistrationAttempts :exec
UPDATE pending_registrations SET attempt_count = attempt_count + 1 WHERE email = $1;

-- name: MarkRegistrationVerified :exec
UPDATE pending_registrations
SET verified = true, verified_at = now(), attempt_count = 0, registration_token_jti = $2
WHERE email = $1;

-- name: DeletePendingRegistration :exec
DELETE FROM pending_registrations WHERE email = $1;

-- name: GetPendingPasswordReset :one
SELECT * FROM pending_password_resets WHERE email = $1;

-- name: UpsertPendingPasswordReset :one
INSERT INTO pending_password_resets (
    email, otp_hash, otp_expires_at, attempt_count, resend_count,
    resend_window_started_at, cooldown_until, reset_token_jti
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (email) DO UPDATE SET
    otp_hash = EXCLUDED.otp_hash,
    otp_expires_at = EXCLUDED.otp_expires_at,
    attempt_count = EXCLUDED.attempt_count,
    resend_count = EXCLUDED.resend_count,
    resend_window_started_at = EXCLUDED.resend_window_started_at,
    cooldown_until = EXCLUDED.cooldown_until,
    reset_token_jti = EXCLUDED.reset_token_jti
RETURNING *;

-- name: BumpPasswordResetAttempts :exec
UPDATE pending_password_resets SET attempt_count = attempt_count + 1 WHERE email = $1;

-- name: MarkPasswordResetVerified :exec
UPDATE pending_password_resets
SET attempt_count = 0, reset_token_jti = $2
WHERE email = $1;

-- name: DeletePendingPasswordReset :exec
DELETE FROM pending_password_resets WHERE email = $1;
