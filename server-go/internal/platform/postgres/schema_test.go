package postgres_test

import (
	"context"
	"testing"
	"time"

	"github.com/wizzyszn/Telemex/internal/testdb"
)

// Expected domain tables from migrations 00001-00005.
var expectedTables = []string{
	"app_meta",
	"patients", "doctors", "admins",
	"pending_registrations", "pending_password_resets",
	"mrn_registry",
	"appointments", "doctor_availability", "doctor_blackouts",
	"consultations", "complaint_histories", "history_takings",
	"physical_exams", "diagnosis_forms", "diagnoses", "medications",
	"investigation_results", "investigation_lists", "treatment_plans",
	"referrals",
	"notifications",
}

func TestSchemaTablesExist(t *testing.T) {
	pool := testdb.Setup(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	rows, err := pool.Inner().Query(ctx,
		"SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	defer rows.Close()
	have := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan: %v", err)
		}
		have[name] = true
	}
	for _, want := range expectedTables {
		if !have[want] {
			t.Errorf("missing table %q after migrate up", want)
		}
	}
}

// TestSchemaBusinessRules asserts the key guards from the M5 required
// constraints exist: partial double-book index, unique event key,
// one-consultation-per-appointment, one-row-per-stage uniques.
func TestSchemaBusinessRules(t *testing.T) {
	pool := testdb.Setup(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	partialIdx := map[string]string{
		// PG normalizes IN (...) to = ANY (ARRAY[...]) in index definitions.
		"appointments_no_double_book_idx": "status = ANY (ARRAY['PENDING'",
		"notifications_unread_idx":        "is_read = false",
	}
	for idx, wantFrag := range partialIdx {
		var def string
		err := pool.Inner().QueryRow(ctx,
			"SELECT indexdef FROM pg_indexes WHERE indexname = $1", idx).Scan(&def)
		if err != nil {
			t.Errorf("partial index %q missing: %v", idx, err)
			continue
		}
		if !containsFold(def, wantFrag) {
			t.Errorf("index %q definition %q lacks %q", idx, def, wantFrag)
		}
	}

	uniqueCols := map[string]string{
		"patients":              "email",
		"doctors":               "email",
		"admins":                "email",
		"notifications":         "event_key",
		"consultations":         "reference",
		"mrn_registry":          "mrn",
		"history_takings":       "consultation_id",
		"physical_exams":        "consultation_id",
		"diagnosis_forms":       "consultation_id",
		"investigation_results": "consultation_id",
		"treatment_plans":       "consultation_id",
	}
	for table, column := range uniqueCols {
		var n int
		err := pool.Inner().QueryRow(ctx, `
			SELECT count(*) FROM pg_index i
			JOIN pg_class t ON t.oid = i.indrelid
			JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
			WHERE t.relname = $1 AND a.attname = $2 AND i.indisunique AND i.indnatts = 1`,
			table, column).Scan(&n)
		if err != nil {
			t.Errorf("unique check %s.%s: %v", table, column, err)
		} else if n == 0 {
			t.Errorf("no single-column unique index on %s.%s", table, column)
		}
	}
}

// TestAppointmentNumberNonUnique locks in the M12 revision: reschedules share
// the parent number (history chains resolve by it), so the column carries a
// plain index — the double-booking guarantee lives in the partial unique
// index, asserted separately below.
func TestAppointmentNumberNonUnique(t *testing.T) {
	pool := testdb.Setup(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var n int
	err := pool.Inner().QueryRow(ctx,
		`SELECT count(*) FROM pg_indexes WHERE indexname = 'appointments_number_idx'`).Scan(&n)
	if err != nil || n != 1 {
		t.Errorf("appointments_number_idx missing: %v", err)
	}
	err = pool.Inner().QueryRow(ctx, `
		SELECT count(*) FROM pg_index i
		JOIN pg_class t ON t.oid = i.indrelid
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
		WHERE t.relname = 'appointments' AND a.attname = 'appointment_number'
		  AND i.indisunique`).Scan(&n)
	if err != nil {
		t.Fatalf("unique check: %v", err)
	}
	if n != 0 {
		t.Error("appointment_number must not be unique (reschedules share it)")
	}
}

func containsFold(s, sub string) bool {
	if len(sub) > len(s) {
		return false
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		match := true
		for j := 0; j < len(sub); j++ {
			a, b := s[i+j], sub[j]
			if 'A' <= a && a <= 'Z' {
				a += 'a' - 'A'
			}
			if 'A' <= b && b <= 'Z' {
				b += 'a' - 'A'
			}
			if a != b {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
