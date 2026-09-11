// Package mrn implements MRN allocation: take-don't-check via the registry
// unique index. Insert first; unique violation means "someone else won", so
// retry with a fresh candidate (max 10, mirroring mrn.service.ts).
package mrn

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
)

const maxAttempts = 10

var alphabet = []rune("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")

// Generate reserves a C-XXXXXX MRN for ownerType (doctor|patient) and returns
// it. Claim it onto the account row with Claim after the row exists.
func Generate(ctx context.Context, q *gen.Queries, ownerType string) (string, error) {
	for i := 0; i < maxAttempts; i++ {
		candidate, err := candidate()
		if err != nil {
			return "", err
		}
		_, err = q.ReserveMRN(ctx, gen.ReserveMRNParams{Mrn: candidate, OwnerType: ownerType})
		if err == nil {
			return candidate, nil
		}
		if !isUniqueViolation(err) {
			return "", err
		}
	}
	return "", fmt.Errorf("mrn: failed to allocate a unique MRN after %d attempts", maxAttempts)
}

// Claim attaches a reserved MRN to its owner. Best-effort: never fails signup.
func Claim(ctx context.Context, q *gen.Queries, mrn, ownerID string) {
	uid, err := uuid.Parse(ownerID)
	if err != nil {
		return
	}
	_ = q.ClaimMRN(ctx, gen.ClaimMRNParams{
		Mrn:     mrn,
		OwnerID: pgtype.UUID{Bytes: uid, Valid: true},
	})
}

func candidate() (string, error) {
	var sb strings.Builder
	sb.WriteString("C-")
	for i := 0; i < 6; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		sb.WriteRune(alphabet[n.Int64()])
	}
	return sb.String(), nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return asPgError(err, &pgErr) && pgErr.Code == "23505"
}

func asPgError(err error, target **pgconn.PgError) bool {
	for err != nil {
		if e, ok := err.(*pgconn.PgError); ok {
			*target = e
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
