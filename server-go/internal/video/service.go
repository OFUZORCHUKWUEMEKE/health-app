package video

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/notify"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
)

// Service owns the video flows. Daily is nil-able: token endpoints fail
// with 503 when unconfigured, while start/end (no Daily I/O) keep working.
type Service struct {
	DB    *postgres.Pool
	Daily Provider
}

func (s *Service) q() *gen.Queries { return gen.New(s.DB.Inner()) }

func Unavailable(msg string) *auth.Error { return &auth.Error{Status: 503, Message: msg} }
func Internal(msg string) *auth.Error    { return &auth.Error{Status: 500, Message: msg} }

var refAlphabet = []rune("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")

func reference() (string, error) {
	var sb strings.Builder
	sb.WriteString("VIDEO-")
	for i := 0; i < 10; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(refAlphabet))))
		if err != nil {
			return "", err
		}
		sb.WriteRune(refAlphabet[n.Int64()])
	}
	return sb.String(), nil
}

// DoctorToken creates (on first call) the Daily room and returns an owner
// token. Repeated calls reuse the room; only the first creation notifies
// the patient (the client polls this endpoint while the visit is open).
func (s *Service) DoctorToken(ctx context.Context, appointmentID, doctorID string) (map[string]any, error) {
	if s.Daily == nil {
		return nil, Unavailable("Video calling is not configured")
	}
	appt, err := s.loadAppointment(ctx, appointmentID)
	if err != nil {
		return nil, err
	}
	if !appt.DoctorID.Valid || appt.DoctorID.String() != doctorID {
		return nil, auth.Forbidden("This appointment does not belong to you")
	}
	if appt.Status != "CONFIRMED" {
		return nil, auth.BadRequest("Video is only available for confirmed appointments")
	}
	if err := assertWindow(appt); err != nil {
		return nil, err
	}
	cons, err := s.findOrCreateConsultation(ctx, appt)
	if err != nil {
		return nil, err
	}
	roomExisted := appt.DailyRoomName.Valid && strings.TrimSpace(appt.DailyRoomName.String) != ""
	if !roomExisted {
		room, rerr := s.createOrAdoptRoom(ctx, appt)
		if rerr != nil {
			return nil, rerr
		}
		appt.DailyRoomName = pgtype.Text{String: room.Name, Valid: true}
		appt.DailyRoomUrl = pgtype.Text{String: room.URL, Valid: true}
		appt.DailyRoomExpiresAt = pgtype.Timestamptz{Time: time.Unix(room.Exp, 0).UTC(), Valid: true}
	}
	if !roomExisted && appt.PatientID.Valid {
		s.emitRoomOpened(ctx, appt, cons.ID.String(), doctorID)
	}
	exp := appt.ScheduledEndAtUtc
	if appt.DailyRoomExpiresAt.Valid {
		exp = appt.DailyRoomExpiresAt
	}
	token, terr := s.Daily.CreateMeetingToken(ctx,
		appt.DailyRoomName.String, true,
		s.doctorDisplayName(ctx, appt.DoctorID), doctorID,
		exp.Time.Unix())
	if terr != nil {
		return nil, Internal("Failed to generate video token")
	}
	roomURL := ""
	if appt.DailyRoomUrl.Valid {
		roomURL = appt.DailyRoomUrl.String
	}
	return map[string]any{
		"appointmentId":  appt.ID.String(),
		"consultationId": cons.ID.String(),
		"role":           "doctor",
		"roomUrl":        roomURL,
		"token":          token,
		"expiresAt":      exp.Time.UTC().Format(time.RFC3339Nano),
	}, nil
}

// PatientToken returns a guest token for an existing room. The doctor must
// have called their endpoint first to create the room.
func (s *Service) PatientToken(ctx context.Context, appointmentID, patientID string) (map[string]any, error) {
	if s.Daily == nil {
		return nil, Unavailable("Video calling is not configured")
	}
	appt, err := s.loadAppointment(ctx, appointmentID)
	if err != nil {
		return nil, err
	}
	if !appt.PatientID.Valid || appt.PatientID.String() != patientID {
		return nil, auth.Forbidden("This appointment does not belong to you")
	}
	if appt.Status != "CONFIRMED" {
		return nil, auth.BadRequest("Video is only available for confirmed appointments")
	}
	if err := assertWindow(appt); err != nil {
		return nil, err
	}
	if !appt.DailyRoomName.Valid || strings.TrimSpace(appt.DailyRoomName.String) == "" {
		return nil, auth.BadRequest("Doctor hasn't opened the session yet. Please wait.")
	}
	exp := appt.ScheduledEndAtUtc
	if appt.DailyRoomExpiresAt.Valid {
		exp = appt.DailyRoomExpiresAt
	}
	token, terr := s.Daily.CreateMeetingToken(ctx,
		appt.DailyRoomName.String, false,
		s.patientDisplayName(ctx, appt.PatientID), patientID,
		exp.Time.Unix())
	if terr != nil {
		return nil, Internal("Failed to generate video token")
	}
	var consultationID any
	if cons, cerr := s.q().GetConsultationByAppointment(ctx, appt.ID); cerr == nil {
		consultationID = cons.ID.String()
	}
	roomURL := ""
	if appt.DailyRoomUrl.Valid {
		roomURL = appt.DailyRoomUrl.String
	}
	return map[string]any{
		"appointmentId":  appt.ID.String(),
		"consultationId": consultationID,
		"role":           "patient",
		"roomUrl":        roomURL,
		"token":          token,
		"expiresAt":      exp.Time.UTC().Format(time.RFC3339Nano),
	}, nil
}

// MarkStarted flips the linked consultation to ACTIVE. Terminal
// workspaces (COMPLETED/CANCELED) 409 instead of reopening.
func (s *Service) MarkStarted(ctx context.Context, appointmentID, doctorID string) (map[string]any, error) {
	appt, err := s.loadAppointment(ctx, appointmentID)
	if err != nil {
		return nil, err
	}
	if !appt.DoctorID.Valid || appt.DoctorID.String() != doctorID {
		return nil, auth.Forbidden("This appointment does not belong to you")
	}
	if appt.Status != "CONFIRMED" {
		return nil, auth.BadRequest("Video is only available for confirmed appointments")
	}
	if err := assertWindow(appt); err != nil {
		return nil, err
	}
	var activated bool
	err = s.DB.Inner().QueryRow(ctx, `UPDATE consultations SET status = 'ACTIVE', updated_at = now()
		WHERE appointment_id = $1 AND status NOT IN ('COMPLETED', 'CANCELED') RETURNING id`, appt.ID).Scan(new(string))
	// pgx returns the row error on Scan; fall through to disambiguate.
	if err == nil {
		activated = true
	}
	if !activated {
		existing, gerr := s.q().GetConsultationByAppointment(ctx, appt.ID)
		if gerr != nil {
			return nil, auth.BadRequest("No consultation exists for this appointment yet. Request a video token first.")
		}
		return nil, auth.Conflict(fmt.Sprintf("Consultation is already %s", existing.Status))
	}
	// Only the first join stamps the start; re-joins extend the span.
	_, _ = s.DB.Inner().Exec(ctx, `UPDATE appointments SET video_started_at = now()
		WHERE id = $1 AND video_started_at IS NULL`, appt.ID)
	return map[string]any{"message": "Session marked as active"}, nil
}

// MarkEnded records when the doctor left. The consultation intentionally
// stays ACTIVE — completing it is a separate explicit doctor action. The
// write is unconditional (first join to last leave), unlike the guarded
// claim on video_started_at.
func (s *Service) MarkEnded(ctx context.Context, appointmentID, doctorID string) (map[string]any, error) {
	appt, err := s.loadAppointment(ctx, appointmentID)
	if err != nil {
		return nil, err
	}
	if !appt.DoctorID.Valid || appt.DoctorID.String() != doctorID {
		return nil, auth.Forbidden("This appointment does not belong to you")
	}
	_, _ = s.DB.Inner().Exec(ctx, `UPDATE appointments SET video_ended_at = now(), updated_at = now() WHERE id = $1`, appt.ID)
	return map[string]any{"message": "Session end acknowledged"}, nil
}

// --- internals ------------------------------------------------------------

func (s *Service) loadAppointment(ctx context.Context, appointmentID string) (gen.Appointment, error) {
	var aid pgtype.UUID
	if err := aid.Scan(appointmentID); err != nil {
		return gen.Appointment{}, auth.BadRequest("Invalid appointment id")
	}
	appt, err := s.q().GetAppointmentByID(ctx, aid)
	if err != nil {
		return gen.Appointment{}, auth.BadRequest("Appointment not found")
	}
	return appt, nil
}

// assertWindow rejects joins before (start - grace) and after end. A
// consultation that runs past its slot is not cut off (the room outlives
// it by RoomOverrun), but new joins after end are refused.
func assertWindow(appt gen.Appointment) error {
	if !appt.ScheduledStartAtUtc.Valid || !appt.ScheduledEndAtUtc.Valid {
		return auth.BadRequest("Video is only available for confirmed appointments")
	}
	now := time.Now()
	start := appt.ScheduledStartAtUtc.Time
	end := appt.ScheduledEndAtUtc.Time
	if now.Before(start.Add(-EarlyJoinGrace)) {
		return auth.BadRequest(fmt.Sprintf("Video session can only be started at the scheduled time (%s).", start.UTC().Format(time.RFC3339Nano)))
	}
	if now.After(end) {
		return auth.BadRequest("This appointment window has already ended.")
	}
	return nil
}

func (s *Service) findOrCreateConsultation(ctx context.Context, appt gen.Appointment) (gen.Consultation, error) {
	if existing, err := s.q().GetConsultationByAppointment(ctx, appt.ID); err == nil {
		return existing, nil
	}
	forWho := "SELF"
	if appt.AppointmentFor == "OTHERS" {
		forWho = "OTHERS"
	}
	for i := 0; i < 5; i++ {
		ref, rerr := reference()
		if rerr != nil {
			return gen.Consultation{}, rerr
		}
		created, cerr := s.q().CreateConsultation(ctx, gen.CreateConsultationParams{
			AppointmentID: appt.ID, Reference: ref, Type: "VIDEO",
			PatientID: appt.PatientID, DoctorID: appt.DoctorID,
			ConsoltationFor: forWho, Title: "Video Consultation",
			SessionNumber: pgtype.Text{String: "1", Valid: true},
			Status:        "ACTIVE", Meta: []byte("{}"),
		})
		if cerr == nil {
			_, _ = s.DB.Inner().Exec(ctx, `UPDATE appointments SET consultation_id = $2, updated_at = now() WHERE id = $1`, appt.ID, created.ID)
			return created, nil
		}
		if !isUniqueViolation(cerr) {
			return gen.Consultation{}, cerr
		}
		if existing, err := s.q().GetConsultationByAppointment(ctx, appt.ID); err == nil {
			return existing, nil
		}
	}
	if existing, err := s.q().GetConsultationByAppointment(ctx, appt.ID); err == nil {
		return existing, nil
	}
	return gen.Consultation{}, Internal("Failed to create video room")
}

func (s *Service) createOrAdoptRoom(ctx context.Context, appt gen.Appointment) (Room, error) {
	nbf := appt.ScheduledStartAtUtc.Time.Add(-EarlyJoinGrace).Unix()
	exp := appt.ScheduledEndAtUtc.Time.Add(RoomOverrun).Unix()
	name := "consultation-" + appt.ID.String()
	room, err := s.Daily.CreateRoom(ctx, name, nbf, exp)
	if err == nil {
		s.persistRoom(ctx, appt.ID, room, exp)
		return room, nil
	}
	// Deterministic names collide when a previous attempt created the room
	// on Daily before persisting it. Adopt by lookup — never by matching
	// Daily's error prose, which is documented as unstable.
	if se, ok := err.(*StatusError); ok && se.Status == httpStatusBadRequest {
		if adopted, gerr := s.Daily.GetRoom(ctx, name); gerr == nil {
			adoptExp := exp
			if adopted.Exp != 0 {
				adoptExp = adopted.Exp
			}
			adopted.Exp = adoptExp
			s.persistRoom(ctx, appt.ID, adopted, adoptExp)
			return adopted, nil
		}
	}
	return Room{}, Internal("Failed to create video room")
}

func (s *Service) persistRoom(ctx context.Context, id pgtype.UUID, room Room, exp int64) {
	_, _ = s.DB.Inner().Exec(ctx, `UPDATE appointments
		SET daily_room_name = $2, daily_room_url = $3, daily_room_expires_at = $4, updated_at = now()
		WHERE id = $1`, id, room.Name, room.URL, time.Unix(exp, 0).UTC())
}

func (s *Service) emitRoomOpened(ctx context.Context, appt gen.Appointment, consultationID, doctorID string) {
	patientID := appt.PatientID.String()
	spec := notify.VideoRoomOpened(notify.VideoRoomOpenedArgs{
		PatientID: patientID, AppointmentID: appt.ID.String(),
		ConsultationID: consultationID,
		Doctor:         s.doctorPerson(ctx, appt.DoctorID), DoctorID: doctorID,
		Data: map[string]any{"appointment_id": appt.ID.String()},
	})
	data, _ := json.Marshal(spec.Data)
	_ = s.q().CreateNotification(ctx, gen.CreateNotificationParams{
		RecipientID: appt.PatientID, RecipientType: spec.RecipientType,
		Type: spec.Type, Category: spec.Category, Title: spec.Title, Body: spec.Body,
		Data: data, AppointmentID: appt.ID,
		ConsultationID: uuidOrNil(consultationID),
		ActorID:        uuidOrNil(doctorID), ActorType: textOrEmpty(spec.ActorType),
		DeepLink: textOrEmpty(spec.DeepLink), EventKey: spec.EventKey,
	})
}

func (s *Service) doctorPerson(ctx context.Context, id pgtype.UUID) *notify.Person {
	if !id.Valid {
		return nil
	}
	doc, err := s.q().GetDoctorByID(ctx, id)
	if err != nil {
		return nil
	}
	full := ""
	if doc.FullName.Valid {
		full = doc.FullName.String
	}
	return &notify.Person{FirstName: doc.FirstName, LastName: doc.LastName, FullName: full}
}

func (s *Service) doctorDisplayName(ctx context.Context, id pgtype.UUID) string {
	if p := s.doctorPerson(ctx, id); p != nil {
		if name := notify.PersonName(p, ""); name != "" {
			return name
		}
	}
	return "Doctor"
}

func (s *Service) patientDisplayName(ctx context.Context, id pgtype.UUID) string {
	if !id.Valid {
		return "Patient"
	}
	u, err := s.q().GetPatientByID(ctx, id)
	if err != nil {
		return "Patient"
	}
	full := ""
	if u.FullName.Valid {
		full = u.FullName.String
	}
	if name := notify.PersonName(&notify.Person{FirstName: u.FirstName, LastName: u.LastName, FullName: full}, ""); name != "" {
		return name
	}
	return "Patient"
}

func uuidOrNil(id string) pgtype.UUID {
	var v pgtype.UUID
	if id == "" {
		return v
	}
	_ = v.Scan(id)
	return v
}

func textOrEmpty(str string) pgtype.Text {
	if str == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: str, Valid: true}
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "SQLSTATE 23505")
}

const httpStatusBadRequest = 400
