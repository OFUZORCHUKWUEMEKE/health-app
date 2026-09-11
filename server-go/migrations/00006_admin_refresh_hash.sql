-- +goose Up
-- Milestone 7: admin refresh-token storage.
--
-- Intentional fix (not a copy): Nest never persisted admin refresh hashes,
-- so admin refresh always 403'd. The Go backend stores the hash so admin
-- sessions rotate like every other role (frontend-compatible choice).

ALTER TABLE admins ADD COLUMN refresh_token_hash TEXT;

-- +goose Down
ALTER TABLE admins DROP COLUMN IF EXISTS refresh_token_hash;
