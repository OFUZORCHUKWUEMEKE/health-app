-- MRN registry queries. Allocation inserts first; unique violation means
-- "someone else won" (see mrn.service.ts take-don't-check pattern).

-- name: ReserveMRN :one
INSERT INTO mrn_registry (mrn, owner_type) VALUES ($1, $2) RETURNING *;

-- name: ClaimMRN :exec
UPDATE mrn_registry SET owner_id = $2 WHERE mrn = $1;
