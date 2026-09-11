// Package patients implements the patient self-service module: profile,
// metrics, timezone, and profile pictures (ports users.service.ts patient
// paths). Admin-facing patient routes live in the admin module (M11).
package patients

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
)

// MaxUploadBytes mirrors the 5 MB FileFieldsInterceptor limit.
const MaxUploadBytes = 5 * 1024 * 1024

// Editable keys in Nest ValidationPipe order (unknown keys 400).
var editableKeys = map[string]bool{
	"first_name": true, "last_name": true, "middle_name": true,
	"phone_number": true, "date_of_birth": true, "gender": true,
	"marital_status": true, "occupation": true, "address": true,
	"profile_picture_url": true, "allergies": true,
	"previous_medical_conditions": true, "medical_flags": true,
}

var arrayKeys = map[string]bool{
	"allergies": true, "previous_medical_conditions": true, "medical_flags": true,
}

// Service owns patient self-service logic.
type Service struct {
	DB    *postgres.Pool
	Files files.Provider
}

func (s *Service) q() *gen.Queries { return gen.New(s.DB.Inner()) }

// --- JSON views -------------------------------------------------------------

// ProfileJSON is the full-document view (PatientProfileInterface shape).
func ProfileJSON(u gen.Patient) map[string]any {
	return map[string]any{
		"_id": u.ID.String(), "registration_no": u.RegistrationNo,
		"mrn": textOrNull(u.Mrn), "first_name": u.FirstName,
		"middle_name": textOrNull(u.MiddleName), "last_name": u.LastName,
		"email": u.Email, "phone_number": textOrNull(u.PhoneNumber),
		"gender": textOrNull(u.Gender), "marital_status": textOrNull(u.MaritalStatus),
		"occupation": textOrNull(u.Occupation), "address": textOrNull(u.Address),
		"profile_picture_url":         textOrNull(u.ProfilePictureUrl),
		"date_of_birth":               dateOrNull(u.DateOfBirth),
		"allergies":                   strs(u.Allergies),
		"previous_medical_conditions": strs(u.PreviousMedicalConditions),
		"medical_flags":               strs(u.MedicalFlags),
		"timezone":                    textOrNull(u.Timezone),
	}
}

// SummaryJSON is the header/card subset (was getUserSummary).
func SummaryJSON(u gen.Patient) map[string]any {
	return map[string]any{
		"_id": u.ID.String(), "registration_no": u.RegistrationNo,
		"mrn": textOrNull(u.Mrn), "first_name": u.FirstName,
		"last_name": u.LastName, "full_name": textOrNull(u.FullName),
		"email": u.Email, "phone_number": textOrNull(u.PhoneNumber),
		"verified":                    u.Verified,
		"profile_picture_url":         textOrNull(u.ProfilePictureUrl),
		"date_of_birth":               dateOrNull(u.DateOfBirth),
		"gender":                      textOrNull(u.Gender),
		"occupation":                  textOrNull(u.Occupation),
		"marital_status":              textOrNull(u.MaritalStatus),
		"timezone":                    textOrNull(u.Timezone),
		"allergies":                   strs(u.Allergies),
		"previous_medical_conditions": strs(u.PreviousMedicalConditions),
	}
}

func textOrNull(v pgtype.Text) any {
	if v.Valid {
		return v.String
	}
	return nil
}

func dateOrNull(v pgtype.Date) any {
	if v.Valid {
		return v.Time.Format("2006-01-02")
	}
	return nil
}

func strs(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// --- reads ------------------------------------------------------------------

func (s *Service) get(ctx context.Context, userID string) (gen.Patient, error) {
	var uid pgtype.UUID
	if err := uid.Scan(userID); err != nil {
		return gen.Patient{}, auth.NotFound("Patient not found")
	}
	user, err := s.q().GetPatientByID(ctx, uid)
	if err != nil {
		return gen.Patient{}, auth.NotFound("Patient not found")
	}
	return user, nil
}

// Summary returns the header/card subset.
func (s *Service) Summary(ctx context.Context, userID string) (map[string]any, error) {
	user, err := s.get(ctx, userID)
	if err != nil {
		return nil, err
	}
	return SummaryJSON(user), nil
}

// Profile returns the full document.
func (s *Service) Profile(ctx context.Context, userID string) (map[string]any, error) {
	user, err := s.get(ctx, userID)
	if err != nil {
		return nil, err
	}
	return ProfileJSON(user), nil
}

// Metrics returns dashboard counts: open consultations, meds inside them,
// assigned investigations awaiting upload, and upcoming appointments.
// (Legacy Investigation rows have no Go table, so that addend is 0.)
func (s *Service) Metrics(ctx context.Context, userID string) (map[string]any, error) {
	user, err := s.get(ctx, userID)
	if err != nil {
		return nil, err
	}
	q := s.q()
	consultations, err := q.CountOpenConsultations(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	medications, err := q.CountMedsInOpenConsultations(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	investigations, err := q.CountAssignedInvestigationsNoImages(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	appointments, err := q.CountUpcomingAppointments(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"consultations": consultations, "medications": medications,
		"investigations": investigations, "appointments": appointments,
	}, nil
}

// --- patch decoding ---------------------------------------------------------

// Patch is the decoded allowlist update. Nil scalar = untouched;
// nil slice = untouched; non-nil slice (even empty) = replace.
type Patch struct {
	FirstName, LastName, MiddleName             *string
	PhoneNumber, Gender, MaritalStatus          *string
	Occupation, Address, ProfilePictureURL      *string
	DateOfBirth                                 *pgtype.Date
	Allergies, PreviousConditions, MedicalFlags []string
	arraysTouched                               map[string]bool
}

// DecodeJSONPatch validates a JSON body: unknown keys 400, arrays must be
// string arrays, blank strings become untouched (was emptyToUndefined).
func DecodeJSONPatch(body map[string]any) (*Patch, error) {
	p := &Patch{arraysTouched: map[string]bool{}}
	for k, v := range body {
		if !editableKeys[k] {
			return nil, auth.BadRequest("property " + k + " should not exist")
		}
		if v == nil {
			continue
		}
		if arrayKeys[k] {
			raw, ok := v.([]any)
			if !ok {
				return nil, auth.BadRequest(k + " must be an array of strings")
			}
			list := make([]string, 0, len(raw))
			for _, item := range raw {
				str, ok := item.(string)
				if !ok {
					return nil, auth.BadRequest(k + " must be an array of strings")
				}
				if strings.TrimSpace(str) != "" {
					list = append(list, strings.TrimSpace(str))
				}
			}
			p.setArray(k, list)
			continue
		}
		str, ok := v.(string)
		if !ok {
			return nil, auth.BadRequest(k + " must be a string")
		}
		if k == "date_of_birth" {
			d, err := parseDate(str)
			if err != nil {
				return nil, auth.BadRequest("date_of_birth must be a valid ISO date")
			}
			if d != nil {
				p.DateOfBirth = d
			}
			continue
		}
		if strings.TrimSpace(str) == "" {
			continue
		}
		p.setScalar(k, strings.TrimSpace(str))
	}
	return p, nil
}

// DecodeFormPatch validates multipart fields with Nest's toStringArray
// coercion: repeated parts pass through, a JSON-array string parses,
// ” clears the list, absent leaves untouched, never comma-split.
func DecodeFormPatch(form map[string][]string) (*Patch, error) {
	p := &Patch{arraysTouched: map[string]bool{}}
	for k, vals := range form {
		if !editableKeys[k] {
			return nil, auth.BadRequest("property " + k + " should not exist")
		}
		if arrayKeys[k] {
			p.setArray(k, toStringArray(vals))
			continue
		}
		joined := strings.TrimSpace(strings.Join(vals, " "))
		if k == "date_of_birth" {
			if joined == "" {
				continue
			}
			d, err := parseDate(joined)
			if err != nil {
				return nil, auth.BadRequest("date_of_birth must be a valid ISO date")
			}
			if d != nil {
				p.DateOfBirth = d
			}
			continue
		}
		if joined == "" {
			continue
		}
		p.setScalar(k, joined)
	}
	return p, nil
}

func toStringArray(vals []string) []string {
	if len(vals) == 1 {
		one := strings.TrimSpace(vals[0])
		if one == "" {
			return []string{}
		}
		if strings.HasPrefix(one, "[") {
			var parsed []any
			if err := json.Unmarshal([]byte(one), &parsed); err == nil {
				out := make([]string, 0, len(parsed))
				for _, item := range parsed {
					if str, ok := item.(string); ok && strings.TrimSpace(str) != "" {
						out = append(out, strings.TrimSpace(str))
					}
				}
				return out
			}
			return []string{one}
		}
		return []string{one}
	}
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			out = append(out, strings.TrimSpace(v))
		}
	}
	return out
}

func (p *Patch) setScalar(k, v string) {
	switch k {
	case "first_name":
		p.FirstName = &v
	case "last_name":
		p.LastName = &v
	case "middle_name":
		p.MiddleName = &v
	case "phone_number":
		p.PhoneNumber = &v
	case "gender":
		p.Gender = &v
	case "marital_status":
		p.MaritalStatus = &v
	case "occupation":
		p.Occupation = &v
	case "address":
		p.Address = &v
	case "profile_picture_url":
		p.ProfilePictureURL = &v
	}
}

func (p *Patch) setArray(k string, v []string) {
	p.arraysTouched[k] = true
	switch k {
	case "allergies":
		p.Allergies = v
	case "previous_medical_conditions":
		p.PreviousConditions = v
	case "medical_flags":
		p.MedicalFlags = v
	}
}

func parseDate(s string) (*pgtype.Date, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return &pgtype.Date{Time: t, Valid: true}, nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return &pgtype.Date{Time: time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), Valid: true}, nil
	}
	return nil, fmt.Errorf("bad date")
}

// Apply writes the patch: lists REPLACE outright (authoritative edit —
// booking intake merges, this route never does), full_name recomputed from
// the merged names.
func (s *Service) Apply(ctx context.Context, userID string, p *Patch) (map[string]any, error) {
	user, err := s.get(ctx, userID)
	if err != nil {
		return nil, err
	}
	first, last, middle := deref(p.FirstName, user.FirstName), deref(p.LastName, user.LastName), deref(p.MiddleName, strVal(user.MiddleName))
	full := strings.TrimSpace(strings.Join([]string{first, middle, last}, " "))
	full = strings.Join(strings.Fields(full), " ")
	params := gen.UpdatePatientProfileParams{
		ID:        user.ID,
		FirstName: first, LastName: last, // NOT NULL: merged values (blank means untouched, stored value satisfies the constraint)
		MiddleName: textOrNullPG(p.MiddleName), PhoneNumber: textOrNullPG(p.PhoneNumber),
		Gender: textOrNullPG(p.Gender), MaritalStatus: textOrNullPG(p.MaritalStatus),
		Occupation: textOrNullPG(p.Occupation), Address: textOrNullPG(p.Address),
		ProfilePictureUrl: textOrNullPG(p.ProfilePictureURL),
	}
	if p.DateOfBirth != nil {
		params.DateOfBirth = *p.DateOfBirth
	}
	if p.arraysTouched["allergies"] {
		params.Allergies = p.Allergies
	}
	if p.arraysTouched["previous_medical_conditions"] {
		params.PreviousMedicalConditions = p.PreviousConditions
	}
	if p.arraysTouched["medical_flags"] {
		params.MedicalFlags = p.MedicalFlags
	}
	if full != "" {
		params.FullName = pgtype.Text{String: full, Valid: true}
	}
	updated, err := s.q().UpdatePatientProfile(ctx, params)
	if err != nil {
		return nil, err
	}
	return ProfileJSON(updated), nil
}

func deref(s *string, fallback string) string {
	if s != nil {
		return *s
	}
	return fallback
}

func strVal(v pgtype.Text) string {
	if v.Valid {
		return v.String
	}
	return ""
}

func textOrNullPG(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

// --- timezone / picture -----------------------------------------------------

// UpdateTimezone validates IANA (Nest message verbatim) and persists.
func (s *Service) UpdateTimezone(ctx context.Context, userID, zone string) (map[string]any, error) {
	if _, err := time.LoadLocation(strings.TrimSpace(zone)); err != nil || strings.TrimSpace(zone) == "" {
		return nil, auth.BadRequest(`timezone must be a valid IANA timezone (e.g. "Africa/Lagos", "America/Edmonton")`)
	}
	user, err := s.get(ctx, userID)
	if err != nil {
		return nil, err
	}
	updated, err := s.q().SetPatientTimezone(ctx, gen.SetPatientTimezoneParams{
		ID: user.ID, Timezone: pgtype.Text{String: strings.TrimSpace(zone), Valid: true},
	})
	if err != nil {
		return nil, err
	}
	return ProfileJSON(updated), nil
}

// SetPictureURL persists a client-supplied picture URL.
func (s *Service) SetPictureURL(ctx context.Context, userID, url string) (map[string]any, error) {
	user, err := s.get(ctx, userID)
	if err != nil {
		return nil, err
	}
	updated, err := s.q().SetPatientProfilePicture(ctx, gen.SetPatientProfilePictureParams{
		ID: user.ID, ProfilePictureUrl: pgtype.Text{String: url, Valid: url != ""},
	})
	if err != nil {
		return nil, err
	}
	return ProfileJSON(updated), nil
}

// UploadPicture stores bytes via the file provider and persists the URL.
// Disabled provider → controlled 503; other failures → 500 (Nest parity).
func (s *Service) UploadPicture(ctx context.Context, userID string, data []byte, contentType string) (map[string]any, error) {
	if _, err := s.get(ctx, userID); err != nil {
		return nil, err
	}
	url, err := s.Files.UploadProfileImage(ctx, data, contentType, "patients", userID)
	if err != nil {
		if files.IsNotConfigured(err) {
			return nil, &auth.Error{Status: 503, Message: err.Error()}
		}
		return nil, &auth.Error{Status: 500, Message: "Failed to upload image to Cloudinary"}
	}
	return s.SetPictureURL(ctx, userID, url)
}
