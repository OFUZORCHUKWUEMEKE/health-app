// Package doctors implements the doctor self-service module plus
// admin-owned activation (ports doctors.service.ts paths). The patient list
// enrichment mirrors users.service.ts getPatientsWithSearch.
package doctors

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

// Editable keys (Nest UpdateDoctorProfileDto, 6 keys).
var editableKeys = map[string]bool{
	"first_name": true, "last_name": true, "phone_number": true,
	"profile_picture_url": true, "specializations": true, "license_no": true,
}

// Service owns doctor logic.
type Service struct {
	DB    *postgres.Pool
	Files files.Provider
}

func (s *Service) q() *gen.Queries { return gen.New(s.DB.Inner()) }

// --- JSON views -------------------------------------------------------------

// SummaryJSON is the GET /me subset (license_no excluded, Nest parity).
func SummaryJSON(d gen.Doctor) map[string]any {
	return map[string]any{
		"_id": d.ID.String(), "doctor_no": d.DoctorNo,
		"first_name": d.FirstName, "last_name": d.LastName,
		"full_name": textOrNull(d.FullName), "email": d.Email,
		"phone_number": textOrNull(d.PhoneNumber), "active": d.Active,
		"specializations":     strs(d.Specializations),
		"profile_picture_url": textOrNull(d.ProfilePictureUrl),
		"timezone":            textOrNull(d.Timezone),
	}
}

// ProfileJSON is the full document minus hashes and mrn (toJSON parity).
func ProfileJSON(d gen.Doctor) map[string]any {
	m := SummaryJSON(d)
	m["license_no"] = textOrNull(d.LicenseNo)
	return m
}

func textOrNull(v pgtype.Text) any {
	if v.Valid {
		return v.String
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

func (s *Service) get(ctx context.Context, doctorID string) (gen.Doctor, error) {
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return gen.Doctor{}, auth.NotFound("Doctor not found")
	}
	doc, err := s.q().GetDoctorByID(ctx, uid)
	if err != nil {
		return gen.Doctor{}, auth.NotFound("Doctor not found")
	}
	return doc, nil
}

// Summary returns the GET /me subset.
func (s *Service) Summary(ctx context.Context, doctorID string) (map[string]any, error) {
	doc, err := s.get(ctx, doctorID)
	if err != nil {
		return nil, err
	}
	return SummaryJSON(doc), nil
}

// Profile returns the full document.
func (s *Service) Profile(ctx context.Context, doctorID string) (map[string]any, error) {
	doc, err := s.get(ctx, doctorID)
	if err != nil {
		return nil, err
	}
	return ProfileJSON(doc), nil
}

// Metrics: open consultations, distinct consultations with unsent meds,
// distinct consultations with unsent investigation lists (legacy addend 0),
// upcoming appointments.
func (s *Service) Metrics(ctx context.Context, doctorID string) (map[string]any, error) {
	doc, err := s.get(ctx, doctorID)
	if err != nil {
		return nil, err
	}
	q := s.q()
	consultations, err := q.CountDoctorOpenConsultations(ctx, doc.ID)
	if err != nil {
		return nil, err
	}
	medications, err := q.CountConsultsWithUnsentMeds(ctx, doc.ID)
	if err != nil {
		return nil, err
	}
	investigations, err := q.CountConsultsWithUnsentLists(ctx, doc.ID)
	if err != nil {
		return nil, err
	}
	appointments, err := q.CountDoctorUpcomingAppointments(ctx, doc.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"consultations": consultations, "medications": medications,
		"investigations": investigations, "appointments": appointments,
	}, nil
}

// --- patch ------------------------------------------------------------------

// Patch is the decoded 6-key update. Nil scalar = untouched; nil slice =
// untouched; non-nil slice (even empty) = replace.
type Patch struct {
	FirstName, LastName, PhoneNumber, ProfilePictureURL, LicenseNo *string
	Specializations                                                []string
	specializationsTouched                                         bool
}

// DecodePatch validates JSON or multipart field maps. Multipart coerces
// single values to one-element arrays (shared semantics with patients).
func DecodePatch(body map[string]any, form urlValues) (*Patch, error) {
	p := &Patch{}
	if body != nil {
		for k, v := range body {
			if !editableKeys[k] {
				return nil, auth.BadRequest("property " + k + " should not exist")
			}
			if v == nil {
				continue
			}
			if k == "specializations" {
				raw, ok := v.([]any)
				if !ok {
					return nil, auth.BadRequest("specializations must be an array of strings")
				}
				list, err := stringList(raw)
				if err != nil {
					return nil, err
				}
				p.Specializations, p.specializationsTouched = list, true
				continue
			}
			str, ok := v.(string)
			if !ok {
				return nil, auth.BadRequest(k + " must be a string")
			}
			if strings.TrimSpace(str) == "" {
				continue
			}
			p.setScalar(k, strings.TrimSpace(str))
		}
		return p, nil
	}
	for k, vals := range form {
		if !editableKeys[k] {
			return nil, auth.BadRequest("property " + k + " should not exist")
		}
		if k == "specializations" {
			p.Specializations, p.specializationsTouched = toStringArray(vals), true
			continue
		}
		joined := strings.TrimSpace(strings.Join(vals, " "))
		if joined == "" {
			continue
		}
		p.setScalar(k, joined)
	}
	return p, nil
}

// urlValues mirrors multipart values without importing net/http here.
type urlValues map[string][]string

func stringList(raw []any) ([]string, error) {
	list := make([]string, 0, len(raw))
	for _, item := range raw {
		str, ok := item.(string)
		if !ok {
			return nil, auth.BadRequest("specializations must be an array of strings")
		}
		if strings.TrimSpace(str) != "" {
			list = append(list, strings.TrimSpace(str))
		}
	}
	return list, nil
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
				out, _ := stringList(parsed)
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
	case "phone_number":
		p.PhoneNumber = &v
	case "profile_picture_url":
		p.ProfilePictureURL = &v
	case "license_no":
		p.LicenseNo = &v
	}
}

// Apply writes the patch; full_name recomputes from merged first+last
// (Nest used payload-only values; merged is identical for full saves).
func (s *Service) Apply(ctx context.Context, doctorID string, p *Patch) (map[string]any, error) {
	doc, err := s.get(ctx, doctorID)
	if err != nil {
		return nil, err
	}
	first, last := strOr(p.FirstName, doc.FirstName), strOr(p.LastName, doc.LastName)
	full := strings.Join(strings.Fields(strings.TrimSpace(first+" "+last)), " ")
	params := gen.UpdateDoctorProfileParams{
		ID: doc.ID, FirstName: first, LastName: last,
		PhoneNumber: textOrNullPG(p.PhoneNumber), ProfilePictureUrl: textOrNullPG(p.ProfilePictureURL),
		LicenseNo: textOrNullPG(p.LicenseNo),
	}
	if p.specializationsTouched {
		params.Specializations = p.Specializations
	}
	if full != "" {
		params.FullName = pgtype.Text{String: full, Valid: true}
	}
	updated, err := s.q().UpdateDoctorProfile(ctx, params)
	if err != nil {
		return nil, err
	}
	return ProfileJSON(updated), nil
}

func strOr(s *string, fallback string) string {
	if s != nil {
		return *s
	}
	return fallback
}

func textOrNullPG(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

// --- timezone / picture -----------------------------------------------------

func (s *Service) UpdateTimezone(ctx context.Context, doctorID, zone string) (map[string]any, error) {
	if _, err := time.LoadLocation(strings.TrimSpace(zone)); err != nil || strings.TrimSpace(zone) == "" {
		return nil, auth.BadRequest(`timezone must be a valid IANA timezone (e.g. "Africa/Lagos", "America/Edmonton")`)
	}
	doc, err := s.get(ctx, doctorID)
	if err != nil {
		return nil, err
	}
	updated, err := s.q().SetDoctorTimezone(ctx, gen.SetDoctorTimezoneParams{
		ID: doc.ID, Timezone: pgtype.Text{String: strings.TrimSpace(zone), Valid: true},
	})
	if err != nil {
		return nil, err
	}
	return ProfileJSON(updated), nil
}

func (s *Service) SetPictureURL(ctx context.Context, doctorID, url string) (map[string]any, error) {
	doc, err := s.get(ctx, doctorID)
	if err != nil {
		return nil, err
	}
	updated, err := s.q().SetDoctorProfilePicture(ctx, gen.SetDoctorProfilePictureParams{
		ID: doc.ID, ProfilePictureUrl: pgtype.Text{String: url, Valid: url != ""},
	})
	if err != nil {
		return nil, err
	}
	return ProfileJSON(updated), nil
}

func (s *Service) UploadPicture(ctx context.Context, doctorID string, data []byte, contentType string) (map[string]any, error) {
	if _, err := s.get(ctx, doctorID); err != nil {
		return nil, err
	}
	url, err := s.Files.UploadProfileImage(ctx, data, contentType, "doctors", doctorID)
	if err != nil {
		if files.IsNotConfigured(err) {
			return nil, &auth.Error{Status: 503, Message: err.Error()}
		}
		return nil, &auth.Error{Status: 500, Message: "Failed to upload image to Cloudinary"}
	}
	return s.SetPictureURL(ctx, doctorID, url)
}

// --- activation (admin-owned) -----------------------------------------------

// SetActive flips the flag; deactivation also nulls the refresh hash,
// logging all sessions out (Nest parity). 404 message verbatim.
func (s *Service) SetActive(ctx context.Context, id string, active bool) (map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(id); err != nil {
		return nil, auth.NotFound(fmt.Sprintf("Doctor with ID %s not found", id))
	}
	doc, err := s.q().SetDoctorActive(ctx, gen.SetDoctorActiveParams{ID: uid, Active: active})
	if err != nil {
		return nil, auth.NotFound(fmt.Sprintf("Doctor with ID %s not found", id))
	}
	_ = doc
	fresh, err := s.q().GetDoctorByID(ctx, uid)
	if err != nil {
		return nil, auth.NotFound(fmt.Sprintf("Doctor with ID %s not found", id))
	}
	return ProfileJSON(fresh), nil
}

// --- patient list -----------------------------------------------------------

// PatientList returns the doctor's patient feed: text/DOB search, newest
// first, page/limit, each row enriched with the latest consultation id (by
// anyone) and whether this doctor has ever consulted them.
func (s *Service) PatientList(ctx context.Context, doctorID, q string, page, limit int) (map[string]any, error) {
	if _, err := s.get(ctx, doctorID); err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
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
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID.String())
	}
	latest := map[string]string{}
	if len(ids) > 0 {
		latestRows, err := s.q().LatestConsultationIDs(ctx, ids)
		if err != nil {
			return nil, err
		}
		for _, lr := range latestRows {
			if _, ok := latest[lr.PatientID]; !ok {
				latest[lr.PatientID] = lr.ConsultationID
			}
		}
	}
	withDoctor := map[string]bool{}
	if len(ids) > 0 {
		var did pgtype.UUID
		_ = did.Scan(doctorID)
		mine, err := s.q().DoctorConsultationPatientIDs(ctx, gen.DoctorConsultationPatientIDsParams{
			DoctorID: did, Column2: ids,
		})
		if err != nil {
			return nil, err
		}
		for _, pid := range mine {
			withDoctor[pid] = true
		}
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		item := patientRowJSON(r)
		pid := r.ID.String()
		consultationID, ok := latest[pid]
		if !ok {
			item["consultation_id"] = nil
		} else {
			item["consultation_id"] = consultationID
		}
		item["has_consultation_with_doctor"] = withDoctor[pid]
		out = append(out, item)
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
	}, nil
}

func patientRowJSON(p gen.Patient) map[string]any {
	return map[string]any{
		"_id": p.ID.String(), "first_name": p.FirstName,
		"middle_name": textOrNull(p.MiddleName), "last_name": p.LastName,
		"full_name": textOrNull(p.FullName), "email": p.Email,
		"phone_number":    textOrNull(p.PhoneNumber),
		"registration_no": p.RegistrationNo, "mrn": textOrNull(p.Mrn),
		"gender": textOrNull(p.Gender), "date_of_birth": dateOrNull(p.DateOfBirth),
		"marital_status": textOrNull(p.MaritalStatus), "occupation": textOrNull(p.Occupation),
		"address":             textOrNull(p.Address),
		"profile_picture_url": textOrNull(p.ProfilePictureUrl),
		"verified":            p.Verified,
	}
}

func dateOrNull(v pgtype.Date) any {
	if v.Valid {
		return v.Time.Format("2006-01-02")
	}
	return nil
}

// parseDOB treats a date-shaped query as a birth-date filter (Nest parity:
// new Date(query) valid → day match). Anything else disables the clause.
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
