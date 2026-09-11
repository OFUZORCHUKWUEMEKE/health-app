// Package admin implements the admin management and reporting module:
// doctor creation, patient/doctor listings, patient detail, and system
// metrics (ports admin.service.ts). Admin login lives in the auth module;
// activation lives in the doctors module — both reused here, not rebuilt.
package admin

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/doctors"
	"github.com/wizzyszn/Telemex/internal/mrn"
	"github.com/wizzyszn/Telemex/internal/patients"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
)

// Service owns admin logic.
type Service struct {
	DB *postgres.Pool
}

func (s *Service) q() *gen.Queries { return gen.New(s.DB.Inner()) }

// --- create doctor ----------------------------------------------------------

// DoctorInput mirrors CreateDoctorDto (frontend-compatible names only).
type DoctorInput struct {
	FirstName, LastName, Email, PhoneNumber, Password string
}

// CreateDoctor registers a doctor with generated identifiers (doctor_no,
// MRN + claim, lowercased email, bcrypt-10 hash), exactly like the Nest
// admin flow. Duplicate email → 409 'Doctor already exists'.
func (s *Service) CreateDoctor(ctx context.Context, in DoctorInput) (map[string]any, error) {
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if _, err := s.q().GetDoctorByEmail(ctx, email); err == nil {
		return nil, auth.Conflict("Doctor already exists")
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return nil, err
	}
	mrnValue, err := mrn.Generate(ctx, s.q(), "doctor")
	if err != nil {
		return nil, err
	}
	var doc gen.Doctor
	for i := 0; i < 5; i++ {
		docNo, err := auth.DoctorNo()
		if err != nil {
			return nil, err
		}
		doc, err = s.q().CreateDoctor(ctx, gen.CreateDoctorParams{
			DoctorNo: docNo, FirstName: in.FirstName, LastName: in.LastName,
			FullName: text(in.FirstName + " " + in.LastName), Email: email,
			PhoneNumber: text(in.PhoneNumber), PasswordHash: hash, Active: true,
			Specializations: []string{}, Mrn: text(mrnValue),
			RefreshTokenHash: pgtype.Text{},
		})
		if err == nil {
			break
		}
		if !isUniqueViolation(err) || i == 4 {
			if isUniqueViolation(err) {
				return nil, auth.Conflict("Doctor already exists")
			}
			return nil, err
		}
	}
	mrn.Claim(ctx, s.q(), mrnValue, doc.ID.String())
	return doctors.ProfileJSON(doc), nil
}

func text(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func isUniqueViolation(err error) bool {
	type causer interface{ Error() string }
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "SQLSTATE 23505")
}

// --- listings ---------------------------------------------------------------

// ListPatients returns the admin patient feed. Unlike Nest (which silently
// ignores q/perPage), the Go backend honors the filters the frontend
// already sends: q searches 6 fields + birth-date, perPage aliases limit.
// Both pagination shapes are emitted because the frontend reads
// meta.lastPage ?? pagination.totalPages.
func (s *Service) ListPatients(ctx context.Context, q string, page, limit int) (map[string]any, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	query := strings.TrimSpace(q)
	dob := parseDOB(query)
	rows, err := s.q().ListPatientsForDoctor(ctx, gen.ListPatientsForDoctorParams{
		Column1: query, Limit: int32(limit), Offset: int32((page - 1) * limit), Column4: dob,
	})
	if err != nil {
		return nil, err
	}
	total, err := s.q().CountPatientsForDoctor(ctx, gen.CountPatientsForDoctorParams{
		Column1: query, Column2: dob,
	})
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, patients.ProfileJSON(r))
	}
	totalPages := 0
	if limit > 0 {
		totalPages = int((total + int64(limit) - 1) / int64(limit))
	}
	return map[string]any{
		"patients": out,
		"pagination": map[string]any{
			"total": total, "page": page, "limit": limit, "total_pages": totalPages,
		},
		"meta": map[string]any{
			"page": page, "perPage": limit, "total": total, "lastPage": totalPages,
		},
	}, nil
}

// PatientDetail returns one patient document (404 verbatim).
func (s *Service) PatientDetail(ctx context.Context, id string) (map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(id); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	user, err := s.q().GetPatientByID(ctx, uid)
	if err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	return patients.ProfileJSON(user), nil
}

// ListDoctors returns all doctors, newest first.
func (s *Service) ListDoctors(ctx context.Context, page, limit int) (map[string]any, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.q().ListDoctors(ctx, gen.ListDoctorsParams{
		Limit: int32(limit), Offset: int32((page - 1) * limit),
	})
	if err != nil {
		return nil, err
	}
	total, err := s.q().CountDoctors(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, doctors.ProfileJSON(r))
	}
	totalPages := 0
	if limit > 0 {
		totalPages = int((total + int64(limit) - 1) / int64(limit))
	}
	return map[string]any{
		"doctors": out,
		"pagination": map[string]any{
			"total": total, "page": page, "limit": limit, "total_pages": totalPages,
		},
	}, nil
}

// --- metrics ----------------------------------------------------------------

// Metric is one {total, current, previous, change_percent, trend} tile.
type Metric struct {
	Total         int64   `json:"total"`
	Current       int64   `json:"current"`
	Previous      int64   `json:"previous"`
	ChangePercent float64 `json:"change_percent"`
	Trend         string  `json:"trend"`
}

func buildMetric(total, current, previous int64) Metric {
	var pct float64
	if previous > 0 {
		pct = math.Round(float64(current-previous)/float64(previous)*10000) / 100
	} else if current > 0 {
		pct = 100
	}
	trend := "stable"
	if pct > 0 {
		trend = "up"
	} else if pct < 0 {
		trend = "down"
	}
	return Metric{Total: total, Current: current, Previous: previous, ChangePercent: pct, Trend: trend}
}


// Metrics returns global tiles for consultations, medications,
// investigations (lists table — the legacy addend has no Go table), and
// appointments. Month windows use server-local time (Nest parity).
func (s *Service) Metrics(ctx context.Context) (map[string]any, error) {
	now := time.Now()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	prevStart := monthStart.AddDate(0, -1, 0)
	return s.metrics(ctx, s.q(), monthStart, prevStart)
}

func (s *Service) metrics(ctx context.Context, q *gen.Queries, monthStart, prevStart time.Time) (map[string]any, error) {
	zero := pgtype.Timestamptz{Time: time.Time{}, Valid: false}
	ms := pgtype.Timestamptz{Time: monthStart, Valid: true}
	ps := pgtype.Timestamptz{Time: prevStart, Valid: true}
	out := map[string]any{}
	type counter struct {
		total func() (int64, error)
		since func(pgtype.Timestamptz, pgtype.Timestamptz) (int64, error)
	}
	counters := map[string]counter{
		"consultations": {
			total: func() (int64, error) {
				return q.CountConsultationsSince(ctx, gen.CountConsultationsSinceParams{Column1: zero})
			},
			since: func(a, b pgtype.Timestamptz) (int64, error) {
				return q.CountConsultationsSince(ctx, gen.CountConsultationsSinceParams{Column1: a, Column2: b})
			},
		},
		"medications": {
			total: func() (int64, error) {
				return q.CountMedicationsSince(ctx, gen.CountMedicationsSinceParams{Column1: zero})
			},
			since: func(a, b pgtype.Timestamptz) (int64, error) {
				return q.CountMedicationsSince(ctx, gen.CountMedicationsSinceParams{Column1: a, Column2: b})
			},
		},
		"investigations": {
			total: func() (int64, error) {
				return q.CountInvestigationsSince(ctx, gen.CountInvestigationsSinceParams{Column1: zero})
			},
			since: func(a, b pgtype.Timestamptz) (int64, error) {
				return q.CountInvestigationsSince(ctx, gen.CountInvestigationsSinceParams{Column1: a, Column2: b})
			},
		},
		"appointments": {
			total: func() (int64, error) {
				return q.CountAppointmentsSince(ctx, gen.CountAppointmentsSinceParams{Column1: zero})
			},
			since: func(a, b pgtype.Timestamptz) (int64, error) {
				return q.CountAppointmentsSince(ctx, gen.CountAppointmentsSinceParams{Column1: a, Column2: b})
			},
		},
	}
	for _, key := range []string{"consultations", "medications", "investigations", "appointments"} {
		c := counters[key]
		t, err := c.total()
		if err != nil {
			return nil, err
		}
		cur, err := c.since(ms, pgtype.Timestamptz{})
		if err != nil {
			return nil, err
		}
		prev, err := c.since(ps, ms)
		if err != nil {
			return nil, err
		}
		out[key] = buildMetric(t, cur, prev)
	}
	return out, nil
}

func parseDOB(q string) pgtype.Date {
	q = strings.TrimSpace(q)
	if t, err := time.Parse("2006-01-02", q); err == nil {
		return pgtype.Date{Time: t, Valid: true}
	}
	if t, err := time.Parse(time.RFC3339, q); err == nil {
		return pgtype.Date{Time: time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), Valid: true}
	}
	return pgtype.Date{}
}
