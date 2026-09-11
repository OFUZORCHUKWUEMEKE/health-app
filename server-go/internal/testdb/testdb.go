// Package testdb is the integration-test helper for PostgreSQL (Milestone 4).
// Tests that need a live database call Setup; it connects to TEST_DATABASE_URL,
// runs migrations up, and truncates tables on cleanup. When no database is
// reachable the test is skipped, so unit runs stay green without Postgres.
package testdb

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/wizzyszn/Telemex/internal/platform/postgres"
)

// DatabaseURL returns the test database URL.
func DatabaseURL() string {
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	return "postgres://postgres@localhost:5433/telemex_test?sslmode=disable"
}

// Setup connects, migrates, and registers truncation cleanup.
// Extend the tables slice as Milestone 5+ adds domain tables.
func Setup(t *testing.T) *postgres.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	url := DatabaseURL()
	pool, err := postgres.Connect(ctx, url)
	if err != nil {
		t.Skipf("postgres unavailable at %s: %v", url, err)
	}
	if err := postgres.Up(ctx, url); err != nil {
		pool.Close()
		t.Fatalf("migrate up: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
	})
	return pool
}

// UniqueEmail mints an address no other test can collide with, so suites in
// different packages can share one test database while running in parallel.
func UniqueEmail(t *testing.T, local string) string {
	t.Helper()
	return strings.ReplaceAll(local, "@", "+") + "-" + uuidShort() + "@example.com"
}

// Track deletes every account/pending row for emails at test end. Scoped
// deletes (never a global wipe) keep parallel packages from nuking each
// other's fixtures. The MRN ledger is intentionally left alone (append-only).
func Track(t *testing.T, pool *postgres.Pool, emails ...string) {
	t.Helper()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// Domain rows first (FK order), then accounts. Scoped to the
		// test's emails so parallel packages never touch each other.
		_, _ = pool.Inner().Exec(ctx, `DELETE FROM appointments
			WHERE patient_id IN (SELECT id FROM patients WHERE email = ANY($1))
			   OR doctor_id IN (SELECT id FROM doctors WHERE email = ANY($1))`, emails)
		_, _ = pool.Inner().Exec(ctx, `DELETE FROM consultations
			WHERE patient_id IN (SELECT id FROM patients WHERE email = ANY($1))
			   OR doctor_id IN (SELECT id FROM doctors WHERE email = ANY($1))`, emails)
		_, _ = pool.Inner().Exec(ctx, `DELETE FROM notifications
			WHERE recipient_id IN (SELECT id FROM patients WHERE email = ANY($1))
			   OR recipient_id IN (SELECT id FROM doctors WHERE email = ANY($1))`, emails)
		for _, table := range []string{
			"pending_registrations", "pending_password_resets",
			"patients", "doctors", "admins",
		} {
			for _, email := range emails {
				_, _ = pool.Inner().Exec(ctx,
					"DELETE FROM "+table+" WHERE email = $1", email)
			}
		}
	})
}

func uuidShort() string {
	u, err := uuid.NewRandom()
	if err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return strings.ReplaceAll(u.String()[:8], "-", "")
}
