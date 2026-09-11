-- Notification feeds + reminder claiming (Milestone 15). Creation paths
-- (booking/consultation emits) already write with ON CONFLICT DO NOTHING on
-- the required event_key unique index — never sparse, never null.

-- name: ListNotifications :many
SELECT * FROM notifications
WHERE recipient_id = $1 AND recipient_type = $2
  AND ($3 = '' OR is_read = ($3 = 'read'))
  AND ($4 = '' OR category = $4)
  AND ($5 = '' OR type = $5)
ORDER BY created_at DESC LIMIT $6 OFFSET $7;

-- name: CountNotifications :one
SELECT count(*) FROM notifications
WHERE recipient_id = $1 AND recipient_type = $2
  AND ($3 = '' OR is_read = ($3 = 'read'))
  AND ($4 = '' OR category = $4)
  AND ($5 = '' OR type = $5);

-- name: CountUnread :one
SELECT count(*) FROM notifications
WHERE recipient_id = $1 AND recipient_type = $2 AND is_read = false;

-- name: MarkNotificationRead :one
UPDATE notifications SET is_read = true, read_at = now(), updated_at = now()
WHERE id = $1 AND recipient_id = $2 AND recipient_type = $3
RETURNING *;

-- name: MarkAllNotificationsRead :execrows
UPDATE notifications SET is_read = true, read_at = now(), updated_at = now()
WHERE recipient_id = $1 AND recipient_type = $2 AND is_read = false;

-- name: DeleteNotification :execrows
DELETE FROM notifications
WHERE id = $1 AND recipient_id = $2 AND recipient_type = $3;

-- name: ClaimReminder24H :many
UPDATE appointments SET reminder_24h_sent_at = now()
WHERE status = 'CONFIRMED' AND reminder_24h_sent_at IS NULL
  AND scheduled_start_at_utc > now()
  AND scheduled_start_at_utc <= now() + interval '24 hours'
RETURNING *;

-- name: ClaimReminder1H :many
UPDATE appointments SET reminder_1h_sent_at = now()
WHERE status = 'CONFIRMED' AND reminder_1h_sent_at IS NULL
  AND scheduled_start_at_utc > now()
  AND scheduled_start_at_utc <= now() + interval '1 hour'
RETURNING *;
