package booking

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/jackc/pgx/v5"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
)

// Durations the API accepts (DTO-restricted, Nest parity).
var allowedDurations = map[int]bool{15: true, 30: true, 45: true, 60: true}

// Appointment statuses (contract union; transitions enforced by canTransition).
const (
	StatusPending     = "PENDING"
	StatusConfirmed   = "CONFIRMED"
	StatusActive      = "ACTIVE"
	StatusCompleted   = "COMPLETED"
	StatusCanceled    = "CANCELED"
	StatusNoShow      = "NO_SHOW"
	StatusFailed      = "FAILED"
	StatusForfeited   = "FORFEITED"
	StatusRescheduled = "RESCHEDULED"
)

// canTransition mirrors the Nest map (COMPLETED reachable only via the
// complete endpoint below, which writes it directly).
var canTransition = map[string][]string{
	StatusPending:   {StatusConfirmed, StatusCanceled},
	StatusConfirmed: {StatusCompleted, StatusCanceled},
}

func canGo(from, to string) bool {
	for _, t := range canTransition[from] {
		if t == to {
			return true
		}
	}
	return false
}

// Service owns scheduling logic.
type Service struct {
	DB          *postgres.Pool
	BookingMode string // manual | auto (default auto)
	queries     *gen.Queries
}

func (s *Service) q() *gen.Queries {
	if s.queries != nil {
		return s.queries
	}
	return gen.New(s.DB.Inner())
}

// WithTx runs fn with all queries bound to one transaction (multi-step
// booking flows commit atomically; races still resolve on the partial
// unique index inside).
func (s *Service) WithTx(ctx context.Context, fn func(tx *Service) error) error {
	return postgres.RunTx(ctx, s.DB, func(tx pgx.Tx) error {
		return fn(&Service{DB: s.DB, BookingMode: s.BookingMode, queries: gen.New(tx)})
	})
}

// --- JSON shaping -----------------------------------------------------------

func appointmentJSON(a gen.Appointment) map[string]any {
	return map[string]any{
		"_id": a.ID.String(), "appointment_number": a.AppointmentNumber,
		"patient_id": uuidOrNull(a.PatientID), "doctor_id": uuidOrNull(a.DoctorID),
		"scheduled_start_at_utc":          isoOrNull(a.ScheduledStartAtUtc),
		"scheduled_end_at_utc":            isoOrNull(a.ScheduledEndAtUtc),
		"timezone_snapshot":               a.TimezoneSnapshot,
		"status":                          a.Status,
		"appointment_for":                 a.AppointmentFor,
		"reason_for_visit":                a.ReasonForVisit,
		"complaint_brief":                 textOrNull(a.ComplaintBrief),
		"Medical_conditions":              strs(a.MedicalConditions),
		"allergies":                       strs(a.Allergies),
		"booking_profile_snapshot":        jsonBytes(a.BookingProfileSnapshot),
		"doctor_snapshot":                 jsonBytes(a.DoctorSnapshot),
		"cancelled_by":                    textOrNull(a.CancelledBy),
		"cancelled_reason":                textOrNull(a.CancelledReason),
		"rescheduled_from_appointment_id": uuidOrNull(a.RescheduledFromAppointmentID),
		"daily_room_name":                 textOrNull(a.DailyRoomName),
		"daily_room_url":                  textOrNull(a.DailyRoomUrl),
		"daily_room_expires_at":           isoOrNull(a.DailyRoomExpiresAt),
		"daily_recording_id":              textOrNull(a.DailyRecordingID),
		"video_started_at":                isoOrNull(a.VideoStartedAt),
		"video_ended_at":                  isoOrNull(a.VideoEndedAt),
	}
}

func uuidOrNull(v pgtype.UUID) any {
	if v.Valid {
		u := v.Bytes
		return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", u[0:4], u[4:6], u[6:8], u[8:10], u[10:16])
	}
	return nil
}

func isoOrNull(v pgtype.Timestamptz) any {
	if v.Valid {
		return v.Time.UTC().Format(time.RFC3339Nano)
	}
	return nil
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

func anyStrings(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case pgtype.Array[string]:
		return t.Elements
	}
	return nil
}

// AppointmentNumber mints APT-YYYYMMDD-#### from the start instant (UTC).
func AppointmentNumber(start time.Time) string {
	return fmt.Sprintf("APT-%04d%02d%02d-%04d",
		start.Year(), int(start.Month()), start.Day(), 1000+rand.Intn(9000))
}

// --- medical reconciliation -------------------------------------------------

// unionMerge case-insensitively unions incoming into current, keeping first
// occurrence (stored order and casing win; never removes).
func unionMerge(current, incoming []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range current {
		k := strings.ToLower(strings.TrimSpace(v))
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, v)
	}
	for _, v := range incoming {
		v = strings.TrimSpace(v)
		k := strings.ToLower(v)
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, v)
	}
	return out
}

// setIfChanged mirrors the scalar rule: blank or case-insensitively equal
// means untouched.
func setIfChanged(stored, incoming string) (string, bool) {
	incoming = strings.TrimSpace(incoming)
	if incoming == "" || strings.EqualFold(stored, incoming) {
		return stored, false
	}
	return incoming, true
}

// ReconcileSelfBooking merges SELF intake into the patient profile (additive
// only; removal happens solely via PATCH /patients/me/profile).
func (s *Service) ReconcileSelfBooking(ctx context.Context, patientID string, in Intake) error {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return err
	}
	user, err := s.q().GetPatientByID(ctx, uid)
	if err != nil {
		return err
	}
	first, last := user.FirstName, user.LastName
	changed := false
	if v, ok := setIfChanged(first, in.FirstName); ok {
		first, changed = v, true
	}
	if v, ok := setIfChanged(last, in.LastName); ok {
		last, changed = v, true
	}
	full := strings.Join(strings.Fields(strings.TrimSpace(first+" "+last)), " ")
	gender, gOK := setIfChanged(strValT(user.Gender), in.Gender)
	marital, mOK := setIfChanged(strValT(user.MaritalStatus), in.MaritalStatus)
	occupation, oOK := setIfChanged(strValT(user.Occupation), in.Occupation)
	tz, tOK := setIfChanged(strValT(user.Timezone), in.Timezone)
	dob, dOK := user.DateOfBirth, false
	if in.DateOfBirth != "" {
		if parsed, perr := time.Parse("2006-01-02", in.DateOfBirth); perr == nil {
			cur := ""
			if user.DateOfBirth.Valid {
				cur = user.DateOfBirth.Time.Format("2006-01-02")
			}
			if cur != in.DateOfBirth {
				dob, dOK = pgtype.Date{Time: parsed, Valid: true}, true
			}
		}
	}
	allergies, meds := user.Allergies, user.PreviousMedicalConditions
	aOK, mOK2 := false, false
	if in.AllergiesSet {
		if merged := unionMerge(strSlice(allergies), in.Allergies); !equalFold(merged, strSlice(allergies)) {
			allergies, aOK = toStringSlice(merged), true
		}
	}
	if in.MedicalSet {
		if merged := unionMerge(strSlice(meds), in.MedicalConditions); !equalFold(merged, strSlice(meds)) {
			meds, mOK2 = toStringSlice(merged), true
		}
	}
	if !(changed || gOK || mOK || oOK || tOK || dOK || aOK || mOK2) {
		return nil
	}
	return s.q().ReconcilePatientFromBooking(ctx, gen.ReconcilePatientFromBookingParams{
		ID: uid, FirstName: first, LastName: last,
		Gender: textOrEmpty(gender), MaritalStatus: textOrEmpty(marital),
		Occupation: textOrEmpty(occupation), Timezone: textOrEmpty(tz),
		DateOfBirth: dob, FullName: textOrEmpty(full),
		Allergies: allergies, PreviousMedicalConditions: meds,
	})
}

func strValT(v pgtype.Text) string {
	if v.Valid {
		return v.String
	}
	return ""
}

func textOrEmpty(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func strSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case pgtype.Array[string]:
		return t.Elements
	}
	return nil
}

func toStringSlice(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

func equalFold(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	aa, bb := append([]string{}, a...), append([]string{}, b...)
	for i := range aa {
		aa[i] = strings.ToLower(aa[i])
	}
	for i := range bb {
		bb[i] = strings.ToLower(bb[i])
	}
	sortStrings(aa)
	sortStrings(bb)
	for i := range aa {
		if aa[i] != bb[i] {
			return false
		}
	}
	return true
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// Intake is the normalized booking intake (DTO mapped in http.go).
type Intake struct {
	FirstName, LastName, DateOfBirth, Gender, MaritalStatus, Occupation string
	Timezone                                                            string
	Allergies, MedicalConditions                                        []string
	AllergiesSet, MedicalSet                                            bool
}

func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

func jsonBytes(raw []byte) any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return map[string]any{}
	}
	return v
}
