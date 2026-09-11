-- Booking/scheduling queries (Milestone 12).

-- name: GetAvailabilityByDoctor :one
SELECT * FROM doctor_availability WHERE doctor_id = $1;

-- name: UpsertAvailability :one
INSERT INTO doctor_availability (doctor_id, timezone, weekly_slots, effective_from, effective_to)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (doctor_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    weekly_slots = EXCLUDED.weekly_slots,
    effective_from = EXCLUDED.effective_from,
    effective_to = EXCLUDED.effective_to,
    updated_at = now()
RETURNING *;

-- name: ListAvailabilitiesWithSlots :many
SELECT * FROM doctor_availability
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(weekly_slots) s
    WHERE COALESCE((s->>'is_active')::boolean, true) = true
);

-- name: CreateBlackout :one
INSERT INTO doctor_blackouts (
    doctor_id, start_at_utc, end_at_utc, reason, reccuring, timezone,
    day_of_week, start_time_minutes, end_time_minutes
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;

-- name: ListBlackoutsByDoctor :many
SELECT * FROM doctor_blackouts WHERE doctor_id = $1 ORDER BY start_at_utc;

-- name: ListOneTimeBlackoutsOverlap :many
SELECT * FROM doctor_blackouts
WHERE doctor_id = $1 AND reccuring = false
  AND start_at_utc < sqlc.arg(new_end)::timestamptz AND end_at_utc > sqlc.arg(new_start)::timestamptz;

-- name: ListRecurringBlackouts :many
SELECT * FROM doctor_blackouts WHERE doctor_id = $1 AND reccuring = true;

-- name: ListOverlappingRecurring :many
SELECT * FROM doctor_blackouts
WHERE doctor_id = $1 AND reccuring = true AND day_of_week = $2
  AND start_time_minutes < sqlc.arg(new_end_mins)::int AND end_time_minutes > sqlc.arg(new_start_mins)::int;

-- name: DeleteBlackout :execrows
DELETE FROM doctor_blackouts WHERE id = $1 AND doctor_id = $2;

-- name: GetActiveDoctorByID :one
SELECT * FROM doctors WHERE id = $1 AND active = true;

-- name: SearchDoctors :many
SELECT * FROM doctors
WHERE active = true
  AND ($1 = '' OR EXISTS (
      SELECT 1 FROM unnest(specializations) s WHERE lower(s) = lower($1)))
  AND ($2 = ''
    OR first_name ILIKE '%' || $2 || '%'
    OR last_name ILIKE '%' || $2 || '%'
    OR full_name ILIKE '%' || $2 || '%'
    OR email ILIKE '%' || $2 || '%')
ORDER BY created_at DESC;

-- name: CreateAppointment :one
INSERT INTO appointments (
    appointment_number, patient_id, doctor_id,
    scheduled_start_at_utc, scheduled_end_at_utc, timezone_snapshot,
    status, appointment_for, reason_for_visit, complaint_brief,
    medical_conditions, allergies, booking_profile_snapshot, doctor_snapshot,
    cancelled_by, cancelled_reason, rescheduled_from_appointment_id
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
) RETURNING *;

-- name: GetAppointmentByID :one
SELECT * FROM appointments WHERE id = $1;

-- name: GetLatestAppointmentByNumber :one
SELECT * FROM appointments WHERE appointment_number = $1 ORDER BY scheduled_start_at_utc DESC LIMIT 1;

-- name: ListPatientAppointments :many
SELECT a.* FROM appointments a
LEFT JOIN doctors d ON d.id = a.doctor_id
WHERE a.patient_id = $1
  AND ($2 = '' OR a.status = $2)
  AND ($3::timestamptz IS NULL OR a.scheduled_start_at_utc >= $3)
  AND ($4::timestamptz IS NULL OR a.scheduled_start_at_utc <= $4)
  AND ($5 = ''
    OR a.appointment_number ILIKE '%' || $5 || '%'
    OR d.first_name ILIKE '%' || $5 || '%'
    OR d.last_name ILIKE '%' || $5 || '%'
    OR d.full_name ILIKE '%' || $5 || '%')
ORDER BY (a.scheduled_start_at_utc < now()),
         abs(extract(epoch FROM (a.scheduled_start_at_utc - now())))
LIMIT $6 OFFSET $7;

-- name: CountPatientAppointments :one
SELECT count(*) FROM appointments a
LEFT JOIN doctors d ON d.id = a.doctor_id
WHERE a.patient_id = $1
  AND ($2 = '' OR a.status = $2)
  AND ($3::timestamptz IS NULL OR a.scheduled_start_at_utc >= $3)
  AND ($4::timestamptz IS NULL OR a.scheduled_start_at_utc <= $4)
  AND ($5 = ''
    OR a.appointment_number ILIKE '%' || $5 || '%'
    OR d.first_name ILIKE '%' || $5 || '%'
    OR d.last_name ILIKE '%' || $5 || '%'
    OR d.full_name ILIKE '%' || $5 || '%');

-- name: ListDoctorAppointments :many
SELECT * FROM appointments
WHERE doctor_id = $1
  AND ($2 = '' OR status = $2)
  AND ($3::timestamptz IS NULL OR scheduled_start_at_utc >= $3)
  AND ($4::timestamptz IS NULL OR scheduled_start_at_utc <= $4)
  AND ($5 = ''
    OR appointment_number ILIKE '%' || $5 || '%'
    OR booking_profile_snapshot->>'first_name' ILIKE '%' || $5 || '%'
    OR booking_profile_snapshot->>'last_name' ILIKE '%' || $5 || '%')
ORDER BY (scheduled_start_at_utc < now()),
         abs(extract(epoch FROM (scheduled_start_at_utc - now())))
LIMIT $6 OFFSET $7;

-- name: CountDoctorAppointments :one
SELECT count(*) FROM appointments
WHERE doctor_id = $1
  AND ($2 = '' OR status = $2)
  AND ($3::timestamptz IS NULL OR scheduled_start_at_utc >= $3)
  AND ($4::timestamptz IS NULL OR scheduled_start_at_utc <= $4)
  AND ($5 = ''
    OR appointment_number ILIKE '%' || $5 || '%'
    OR booking_profile_snapshot->>'first_name' ILIKE '%' || $5 || '%'
    OR booking_profile_snapshot->>'last_name' ILIKE '%' || $5 || '%');

-- name: OverlappingDoctorAppointments :many
SELECT * FROM appointments
WHERE doctor_id = $1 AND status IN ('PENDING', 'CONFIRMED')
  AND scheduled_start_at_utc < sqlc.arg(new_end)::timestamptz AND scheduled_end_at_utc > sqlc.arg(new_start)::timestamptz
  AND (sqlc.arg(exclude_id)::uuid IS NULL OR id != sqlc.arg(exclude_id)::uuid);

-- name: OverlappingPatientAppointments :many
SELECT * FROM appointments
WHERE patient_id = $1 AND status IN ('PENDING', 'CONFIRMED')
  AND scheduled_start_at_utc < sqlc.arg(new_end)::timestamptz AND scheduled_end_at_utc > sqlc.arg(new_start)::timestamptz
  AND (sqlc.arg(exclude_id)::uuid IS NULL OR id != sqlc.arg(exclude_id)::uuid);

-- name: UpdateAppointmentStatus :one
UPDATE appointments SET status = $2, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: CancelAppointment :one
UPDATE appointments SET status = 'CANCELED',
    cancelled_by = $2, cancelled_reason = $3, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: MarkAppointmentRescheduled :one
UPDATE appointments SET status = 'RESCHEDULED',
    cancelled_by = $2, cancelled_reason = $3, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: RescheduleChain :many
SELECT * FROM appointments
WHERE appointment_number = $1 OR rescheduled_from_appointment_id = $2
ORDER BY created_at DESC;

-- name: GetConsultationByAppointment :one
SELECT * FROM consultations WHERE appointment_id = $1;

-- name: GetConsultationRefsByAppointments :many
SELECT appointment_id, reference FROM consultations WHERE appointment_id = ANY($1::uuid[]);

-- name: GetAppointmentsByIDs :many
SELECT * FROM appointments WHERE id = ANY($1::uuid[]);

-- name: MarkConsultationRescheduled :exec
UPDATE consultations SET status = 'RESCHEDULED', updated_at = now()
WHERE appointment_id = $1;

-- name: CreateNotification :exec
INSERT INTO notifications (
    recipient_id, recipient_type, type, category, title, body, data,
    appointment_id, consultation_id, actor_id, actor_type, deep_link, event_key
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
) ON CONFLICT (event_key) DO NOTHING;

-- name: DoctorRangeAppointments :many
SELECT * FROM appointments
WHERE doctor_id = $1 AND status IN ('PENDING', 'CONFIRMED')
  AND scheduled_start_at_utc >= $2 AND scheduled_start_at_utc < $3
ORDER BY scheduled_start_at_utc ASC;

-- name: PatientRangeAppointments :many
SELECT * FROM appointments
WHERE patient_id = $1
  AND scheduled_start_at_utc >= $2 AND scheduled_start_at_utc < $3
ORDER BY scheduled_start_at_utc ASC;

-- name: RangeBlackoutsOverlap :many
SELECT * FROM doctor_blackouts
WHERE doctor_id = $1 AND reccuring = false
  AND start_at_utc < sqlc.arg(new_end)::timestamptz AND end_at_utc > sqlc.arg(new_start)::timestamptz;

-- Bulk conflict fetches (optimization): one round trip per conflict type
-- across many doctors instead of three queries per doctor. Grouped in
-- memory by doctor_id, preserving candidate order for short-circuit scans.

-- name: OverlappingDoctorAppointmentsBulk :many
SELECT * FROM appointments
WHERE doctor_id = ANY(sqlc.arg(doctor_ids)::uuid[])
  AND status IN ('PENDING', 'CONFIRMED')
  AND scheduled_start_at_utc < sqlc.arg(new_end)::timestamptz
  AND scheduled_end_at_utc > sqlc.arg(new_start)::timestamptz;

-- name: ListOneTimeBlackoutsBulk :many
SELECT * FROM doctor_blackouts
WHERE doctor_id = ANY(sqlc.arg(doctor_ids)::uuid[])
  AND reccuring = false
  AND start_at_utc < sqlc.arg(new_end)::timestamptz
  AND end_at_utc > sqlc.arg(new_start)::timestamptz;

-- name: ListRecurringBlackoutsBulk :many
SELECT * FROM doctor_blackouts
WHERE doctor_id = ANY(sqlc.arg(doctor_ids)::uuid[])
  AND reccuring = true;
