-- +goose Up
-- Milestone 12: appointment_number is deliberately NOT unique.
--
-- Revision of the M5 decision: reschedules reuse the parent's
-- appointment_number (history chains resolve by shared number), so a unique
-- index breaks reschedule by design — Nest even drops such an index in
-- onModuleInit. The double-booking guarantee lives in
-- appointments_no_double_book_idx (partial, status-filtered), not here.

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_appointment_number_key;
CREATE INDEX IF NOT EXISTS appointments_number_idx ON appointments (appointment_number);

-- +goose Down
-- Cannot restore uniqueness: reschedule chains share numbers by design.
SELECT 1;
