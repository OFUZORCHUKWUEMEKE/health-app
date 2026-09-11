-- app_meta key/value helpers (baseline table from 00001_baseline.sql).

-- name: GetMeta :one
SELECT key, value, updated_at FROM app_meta WHERE key = $1;

-- name: SetMeta :one
INSERT INTO app_meta (key, value, updated_at)
VALUES ($1, $2, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
RETURNING key, value, updated_at;

-- name: ListMeta :many
SELECT key, value, updated_at FROM app_meta ORDER BY key;
