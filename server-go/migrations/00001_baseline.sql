-- +goose Up
-- M4 baseline: proves the migration chain works on an empty database.
-- Domain tables (patients, doctors, appointments, consultations, ...) land
-- with Milestone 5. app_meta is a permanent key/value shelf for
-- seed markers and future operational flags.
CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS app_meta;
