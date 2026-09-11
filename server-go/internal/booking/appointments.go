package booking

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/concurrent"
)

// BookInput is the normalized booking intake (DTO mapped in http.go).
type BookInput struct {
	FirstName, LastName, DateOfBirth, Gender, MaritalStatus, Occupation string
	PresentComplaint, ReasonForVisit, ComplaintBrief                    string
	DoctorID, Specialization, ConsultationType, AppointmentFor          string
	ScheduledStartLocal, Timezone                                       string
	RequestedDurationMinutes                                            int
	ConfirmAppointment                                                  bool
	Allergies, MedicalConditions                                        []string
	AllergiesSet, MedicalSet                                            bool
	fallbackReason                                                      string
}

// Book creates an appointment. Manual mode requires doctor_id (PENDING).
// Auto mode with a doctor_id prefers that doctor and falls back to the
// matcher; without one it matches directly. CONFIRMED marks auto-matched.
func (s *Service) Book(ctx context.Context, patientID string, in BookInput) (map[string]any, error) {
	if !in.ConfirmAppointment {
		return nil, auth.BadRequest("Please confirm appointment to continue")
	}
	if s.BookingMode == "manual" {
		if strings.TrimSpace(in.DoctorID) == "" {
			return nil, auth.BadRequest("doctor_id is required in manual booking mode")
		}
		return s.bookManual(ctx, patientID, in, in.DoctorID, StatusPending)
	}
	if strings.TrimSpace(in.DoctorID) != "" {
		// An explicitly requested doctor surfaces its own conflicts (409)
		// instead of silently matching someone else; other failures fall
		// back to the matcher (auto spirit).
		if _, err := s.resolveSlot(ctx, in.DoctorID, in.ScheduledStartLocal, in.Timezone, in.RequestedDurationMinutes, pgtype.UUID{}); err != nil {
			if svcErr, ok := err.(*auth.Error); ok && svcErr.Status == 409 {
				return nil, err
			}
		} else if out, perr := s.bookManual(ctx, patientID, in, in.DoctorID, StatusPending); perr == nil {
			return out, nil
		} else if isUniqueViolation(perr) {
			return nil, auth.Conflict("Selected slot is already booked")
		} else if _, ok := perr.(*auth.Error); ok {
			return nil, perr
		}
	}
	return s.bookAuto(ctx, patientID, in)
}

func (s *Service) bookManual(ctx context.Context, patientID string, in BookInput, doctorID, status string) (map[string]any, error) {
	slot, err := s.resolveSlot(ctx, doctorID, in.ScheduledStartLocal, in.Timezone, in.RequestedDurationMinutes, pgtype.UUID{})
	if err != nil {
		return nil, err
	}
	return s.persist(ctx, patientID, in, doctorID, slot, status)
}

// persist validates time, checks patient double-booking, reconciles SELF
// intake, and inserts inside a transaction. 23505 on the partial unique
// index means a lost race → 409 (never leaks as 500).
func (s *Service) persist(ctx context.Context, patientID string, in BookInput, doctorID string, slot *SlotCheck, status string) (map[string]any, error) {
	start, err := LocalToUTC(in.ScheduledStartLocal, in.Timezone)
	if err != nil {
		return nil, auth.BadRequest(err.Error())
	}
	if !start.After(time.Now()) {
		return nil, auth.BadRequest("Cannot book a past timeslot")
	}
	end := start.Add(time.Duration(in.RequestedDurationMinutes) * time.Minute)
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	over, err := s.q().OverlappingPatientAppointments(ctx, gen.OverlappingPatientAppointmentsParams{
		PatientID: uid,
		NewStart:  pgtype.Timestamptz{Time: start, Valid: true},
		NewEnd:    pgtype.Timestamptz{Time: end, Valid: true},
		ExcludeID: pgtype.UUID{},
	})
	if err != nil {
		return nil, err
	}
	if len(over) > 0 {
		return nil, auth.Conflict("You already have an appointment in this time slot")
	}
	apptFor := in.AppointmentFor
	if apptFor == "" {
		apptFor = "SELF"
	}
	var created gen.Appointment
	err = s.WithTx(ctx, func(tx *Service) error {
		if apptFor == "SELF" {
			if rerr := tx.ReconcileSelfBooking(ctx, patientID, Intake{
				FirstName: in.FirstName, LastName: in.LastName,
				DateOfBirth: in.DateOfBirth, Gender: in.Gender,
				MaritalStatus: in.MaritalStatus, Occupation: in.Occupation,
				Timezone:  in.Timezone,
				Allergies: in.Allergies, MedicalConditions: in.MedicalConditions,
				AllergiesSet: in.AllergiesSet, MedicalSet: in.MedicalSet,
			}); rerr != nil {
				return rerr
			}
		}
		_ = uid
		var did pgtype.UUID
		_ = did.Scan(doctorID)
		doc, derr := tx.q().GetActiveDoctorByID(ctx, did)
		if derr != nil {
			return auth.NotFound("Doctor not found")
		}
		reason := in.PresentComplaint
		if reason == "" {
			reason = in.ReasonForVisit
		}
		var patientUUID pgtype.UUID
		_ = patientUUID.Scan(patientID)
		var doctorUUID pgtype.UUID
		doctorUUID.Valid = false
		if strings.TrimSpace(doctorID) != "" {
			_ = doctorUUID.Scan(doctorID)
		}
		snapshot, _ := jsonMarshal(map[string]any{
			"first_name": in.FirstName, "last_name": in.LastName,
			"date_of_birth": in.DateOfBirth, "gender": in.Gender,
			"marital_status": in.MaritalStatus, "occupation": in.Occupation,
			"present_complaint": in.PresentComplaint,
		})
		doctorSnap, _ := jsonMarshal(map[string]any{
			"doctor_id": doctorID, "first_name": doc.FirstName, "last_name": doc.LastName,
			"full_name": textOrNull(doc.FullName), "email": doc.Email,
			"specializations": strs(anyStrings(doc.Specializations)),
		})
		created, derr = tx.q().CreateAppointment(ctx, gen.CreateAppointmentParams{
			AppointmentNumber:   AppointmentNumber(start),
			PatientID:           patientUUID,
			DoctorID:            doctorUUID,
			ScheduledStartAtUtc: pgtype.Timestamptz{Time: start, Valid: true},
			ScheduledEndAtUtc:   pgtype.Timestamptz{Time: end, Valid: true},
			TimezoneSnapshot:    slot.Zone, Status: status, AppointmentFor: apptFor,
			ReasonForVisit: reason, ComplaintBrief: textOrEmpty(in.ComplaintBrief),
			MedicalConditions: orEmpty(in.MedicalConditions), Allergies: orEmpty(in.Allergies),
			BookingProfileSnapshot: snapshot, DoctorSnapshot: doctorSnap,
		})
		return derr
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, auth.Conflict("Selected slot is already booked or consultation already linked")
		}
		if _, ok := err.(*auth.Error); ok {
			return nil, err
		}
		return nil, err
	}
	out := appointmentJSON(created)
	s.emitCreated(ctx, created)
	return out, nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "SQLSTATE 23505")
}

// bookAuto runs the 6-step matcher then persists CONFIRMED.
func (s *Service) bookAuto(ctx context.Context, patientID string, in BookInput) (map[string]any, error) {
	found, err := s.FindOptimal(ctx, in.ScheduledStartLocal, in.Timezone, in.RequestedDurationMinutes, in.Specialization)
	if err != nil {
		return nil, err
	}
	if ok, _ := found["found"].(bool); !ok {
		reason, _ := found["reason"].(string)
		if reason == "" {
			reason = "No available doctor found for the requested time slot. Please try a different time."
		}
		return nil, auth.BadRequest(reason)
	}
	doc := found["doctor"].(map[string]any)
	slot := found["slot"].(map[string]any)
	zone, _ := slot["timezone"].(string)
	return s.persist(ctx, patientID, in, doc["_id"].(string),
		&SlotCheck{Start: mustTime(slot["start_at_utc"]), End: mustTime(slot["end_at_utc"]), Zone: zone}, StatusConfirmed)
}

// AutoBook tries the requested doctor, then optimal, then the matcher.
func (s *Service) AutoBook(ctx context.Context, patientID string, in BookInput) (map[string]any, error) {
	if !in.ConfirmAppointment {
		return nil, auth.BadRequest("Please confirm appointment to continue")
	}
	if strings.TrimSpace(in.DoctorID) != "" {
		if _, err := s.resolveSlot(ctx, in.DoctorID, in.ScheduledStartLocal, in.Timezone, in.RequestedDurationMinutes, pgtype.UUID{}); err == nil {
			if out, perr := s.bookManual(ctx, patientID, in, in.DoctorID, StatusPending); perr == nil {
				return map[string]any{"booked": true, "fallback_used": false, "appointment": out}, nil
			} else if !isUniqueViolation(perr) {
				if _, ok := perr.(*auth.Error); ok {
					return nil, perr
				}
			}
		} else if svcErr, ok := err.(*auth.Error); ok && true {
			in.fallbackReason = svcErr.Message
		}
	}
	found, err := s.FindOptimal(ctx, in.ScheduledStartLocal, in.Timezone, in.RequestedDurationMinutes, in.Specialization)
	if err != nil {
		return nil, err
	}
	if ok, _ := found["found"].(bool); ok {
		doc := found["doctor"].(map[string]any)
		slot := found["slot"].(map[string]any)
		if out, perr := s.persist(ctx, patientID, in, doc["_id"].(string),
			&SlotCheck{Start: mustTime(slot["start_at_utc"]), End: mustTime(slot["end_at_utc"]), Zone: slot["timezone"].(string)}, StatusConfirmed); perr == nil {
			return map[string]any{
				"booked": true, "fallback_used": true,
				"fallback_reason": in.fallbackReason, "selected_doctor": doc["_id"], "appointment": out,
			}, nil
		}
	}
	return nil, auth.BadRequest(firstNonEmpty(in.fallbackReason,
		stringOr(found["reason"], "No available doctor found for the requested time slot")))
}

func mustTime(v any) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, v.(string))
	return t
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func stringOr(v any, fallback string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return fallback
}

// --- transitions ------------------------------------------------------------

func (s *Service) doctorOwns(ctx context.Context, doctorID, apptID string) (gen.Appointment, error) {
	var aid pgtype.UUID
	if err := aid.Scan(apptID); err != nil {
		return gen.Appointment{}, auth.BadRequest("Invalid appointment id")
	}
	appt, err := s.q().GetAppointmentByID(ctx, aid)
	if err != nil {
		return gen.Appointment{}, auth.NotFound("Appointment not found")
	}
	if !appt.DoctorID.Valid || appt.DoctorID.String() != doctorID {
		return gen.Appointment{}, auth.NotFound("Appointment not found")
	}
	return appt, nil
}

// AcceptDoctor confirms PENDING→CONFIRMED (accept and confirm share it).
func (s *Service) AcceptDoctor(ctx context.Context, doctorID, apptID string) (map[string]any, error) {
	appt, err := s.doctorOwns(ctx, doctorID, apptID)
	if err != nil {
		return nil, err
	}
	if !canGo(appt.Status, StatusConfirmed) {
		return nil, auth.BadRequest(fmt.Sprintf("Cannot transition appointment from %s to %s", appt.Status, StatusConfirmed))
	}
	updated, err := s.q().UpdateAppointmentStatus(ctx, gen.UpdateAppointmentStatusParams{ID: appt.ID, Status: StatusConfirmed})
	if err != nil {
		return nil, err
	}
	s.emitConfirmed(ctx, updated)
	return map[string]any{"message": "Appointment confirmed"}, nil
}

// CancelDoctor moves PENDING/CONFIRMED→CANCELED with doctor attribution.
func (s *Service) CancelDoctor(ctx context.Context, doctorID, apptID, reason string) (map[string]any, error) {
	appt, err := s.doctorOwns(ctx, doctorID, apptID)
	if err != nil {
		return nil, err
	}
	if appt.Status != StatusPending && appt.Status != StatusConfirmed {
		return nil, auth.BadRequest("Only pending or confirmed appointments can be cancelled")
	}
	if strings.TrimSpace(reason) == "" {
		reason = "Cancelled by doctor"
	}
	updated, err := s.q().CancelAppointment(ctx, gen.CancelAppointmentParams{
		ID: appt.ID, CancelledBy: pgtype.Text{String: "doctor", Valid: true},
		CancelledReason: pgtype.Text{String: reason, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	s.emitCancelled(ctx, updated, "doctor")
	return map[string]any{"message": "Appointment cancelled"}, nil
}

// CancelPatient cancels with patient attribution and scoping.
func (s *Service) CancelPatient(ctx context.Context, patientID, apptID, reason string) (map[string]any, error) {
	var aid pgtype.UUID
	if err := aid.Scan(apptID); err != nil {
		return nil, auth.BadRequest("Invalid appointment id")
	}
	appt, err := s.q().GetAppointmentByID(ctx, aid)
	if err != nil {
		return nil, auth.NotFound("Appointment not found")
	}
	if !appt.PatientID.Valid || appt.PatientID.String() != patientID {
		return nil, auth.NotFound("Appointment not found")
	}
	if appt.Status != StatusPending && appt.Status != StatusConfirmed {
		return nil, auth.BadRequest("Only pending or confirmed appointments can be cancelled")
	}
	if strings.TrimSpace(reason) == "" {
		reason = "Cancelled by patient"
	}
	updated, err := s.q().CancelAppointment(ctx, gen.CancelAppointmentParams{
		ID: appt.ID, CancelledBy: pgtype.Text{String: "patient", Valid: true},
		CancelledReason: pgtype.Text{String: reason, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	s.emitCancelled(ctx, updated, "patient")
	return map[string]any{"message": "Appointment cancelled"}, nil
}

// CompleteDoctor writes CONFIRMED→COMPLETED (frontend-required route).
func (s *Service) CompleteDoctor(ctx context.Context, doctorID, apptID string) (map[string]any, error) {
	appt, err := s.doctorOwns(ctx, doctorID, apptID)
	if err != nil {
		return nil, err
	}
	if appt.Status != StatusConfirmed {
		return nil, auth.BadRequest(fmt.Sprintf("Cannot transition appointment from %s to %s", appt.Status, StatusCompleted))
	}
	if _, err := s.q().UpdateAppointmentStatus(ctx, gen.UpdateAppointmentStatusParams{ID: appt.ID, Status: StatusCompleted}); err != nil {
		return nil, err
	}
	return map[string]any{"message": "Appointment completed"}, nil
}

// NoShowDoctor records a missed appointment.
func (s *Service) NoShowDoctor(ctx context.Context, doctorID, apptID string) (map[string]any, error) {
	appt, err := s.doctorOwns(ctx, doctorID, apptID)
	if err != nil {
		return nil, err
	}
	if appt.Status != StatusPending && appt.Status != StatusConfirmed {
		return nil, auth.BadRequest(fmt.Sprintf("Cannot transition appointment from %s to %s", appt.Status, StatusNoShow))
	}
	if _, err := s.q().UpdateAppointmentStatus(ctx, gen.UpdateAppointmentStatusParams{ID: appt.ID, Status: StatusNoShow}); err != nil {
		return nil, err
	}
	return map[string]any{"message": "Appointment marked as no-show"}, nil
}

// --- reschedule -------------------------------------------------------------

// RescheduleInput mirrors the reschedule DTOs.
type RescheduleInput struct {
	ScheduledStartLocal, Timezone   string
	RequestedDurationMinutes        int
	Reason, RequestedSpecialization string
}

// Reschedule creates the successor appointment (reusing the number) and
// retires the original, with fallback tiers when the original doctor cannot
// take the new slot.
func (s *Service) Reschedule(ctx context.Context, appt gen.Appointment, actorRole string, in RescheduleInput) (map[string]any, error) {
	if appt.Status != StatusPending && appt.Status != StatusConfirmed {
		return nil, auth.BadRequest("Only pending or confirmed appointments can be rescheduled")
	}
	start, err := LocalToUTC(in.ScheduledStartLocal, in.Timezone)
	if err != nil {
		return nil, auth.BadRequest(err.Error())
	}
	if !start.After(time.Now()) {
		return nil, auth.BadRequest("Cannot reschedule to a past timeslot")
	}
	end := start.Add(time.Duration(in.RequestedDurationMinutes) * time.Minute)
	if start.Equal(appt.ScheduledStartAtUtc.Time) {
		return nil, auth.BadRequest("New timeslot must be different from current timeslot")
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" {
		reason = "Rescheduled by " + strings.ToLower(actorRole)
	}
	origDoctor := ""
	if appt.DoctorID.Valid {
		origDoctor = appt.DoctorID.String()
	}
	// Try the original doctor first (excluding the appointment itself).
	newDoctor, newZone, fallbackUsed, fallbackReason := origDoctor, appt.TimezoneSnapshot, false, ""
	if origDoctor != "" {
		if _, rerr := s.resolveSlot(ctx, origDoctor, in.ScheduledStartLocal, in.Timezone, in.RequestedDurationMinutes, appt.ID); rerr != nil {
			fallbackUsed = true
			found, ferr := s.FindOptimal(ctx, in.ScheduledStartLocal, in.Timezone, in.RequestedDurationMinutes, in.RequestedSpecialization)
			if ferr != nil {
				return nil, ferr
			}
			if ok, _ := found["found"].(bool); ok {
				doc := found["doctor"].(map[string]any)
				slot := found["slot"].(map[string]any)
				newDoctor, newZone = doc["_id"].(string), slot["timezone"].(string)
				fallbackReason = "Original doctor unavailable; reassigned"
			} else {
				fallbackReason = "No doctor currently available; appointment created as pending for later matching"
			}
		}
	}
	status := StatusConfirmed
	if fallbackUsed && newDoctor == origDoctor {
		// No reassignment found: keep the original doctor pending.
		status = StatusPending
	}
	var successor gen.Appointment
	err = s.WithTx(ctx, func(tx *Service) error {
		var patientUUID pgtype.UUID
		patientUUID = appt.PatientID
		var doctorUUID pgtype.UUID
		if newDoctor != "" {
			_ = doctorUUID.Scan(newDoctor)
		}
		number := appt.AppointmentNumber
		if number == "" {
			number = AppointmentNumber(start)
		}
		var err error
		successor, err = tx.q().CreateAppointment(ctx, gen.CreateAppointmentParams{
			AppointmentNumber: number, PatientID: patientUUID, DoctorID: doctorUUID,
			ScheduledStartAtUtc: pgtype.Timestamptz{Time: start, Valid: true},
			ScheduledEndAtUtc:   pgtype.Timestamptz{Time: end, Valid: true},
			TimezoneSnapshot:    newZone, Status: status, AppointmentFor: appt.AppointmentFor,
			ReasonForVisit: appt.ReasonForVisit, ComplaintBrief: appt.ComplaintBrief,
			MedicalConditions: anyStrings(appt.MedicalConditions), Allergies: anyStrings(appt.Allergies),
			BookingProfileSnapshot: appt.BookingProfileSnapshot, DoctorSnapshot: appt.DoctorSnapshot,
			RescheduledFromAppointmentID: uuidPG(appt.ID.String()),
		})
		if err != nil {
			if isUniqueViolation(err) {
				return auth.Conflict("Selected slot is already booked")
			}
			return err
		}
		if _, err := tx.q().MarkAppointmentRescheduled(ctx, gen.MarkAppointmentRescheduledParams{
			ID: appt.ID, CancelledBy: pgtype.Text{String: strings.ToLower(actorRole), Valid: true},
			CancelledReason: pgtype.Text{String: reason, Valid: true},
		}); err != nil {
			return err
		}
		_ = tx.q().MarkConsultationRescheduled(ctx, appt.ID)
		return nil
	})
	if err != nil {
		if _, ok := err.(*auth.Error); ok {
			return nil, err
		}
		return nil, err
	}
	s.emitRescheduled(ctx, appt, successor, actorRole, reason, fallbackUsed)
	return map[string]any{
		"old_appointment_id": appt.ID.String(), "fallback_used": fallbackUsed,
		"fallback_reason":            fallbackReason,
		"awaiting_doctor_assignment": status == StatusPending && fallbackUsed,
		"new_appointment":            appointmentJSON(successor),
	}, nil
}

// orEmpty coerces nil lists to {} (NOT NULL columns reject explicit NULL).
func orEmpty(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

func uuidPG(id string) pgtype.UUID {
	var uid pgtype.UUID
	_ = uid.Scan(id)
	return uid
}

// --- listings ---------------------------------------------------------------

func statusFilter(status string) (string, bool) {
	if status == StatusCompleted {
		return "", true // explicit COMPLETED forces empty (Nest parity)
	}
	return status, false
}

// ListPatient returns closest-future-first appointments + pagination.
func (s *Service) ListPatient(ctx context.Context, patientID, status string, from, to *time.Time, q string, page, perPage int) (map[string]any, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 20
	}
	if perPage > 100 {
		perPage = 100
	}
	status, forceEmpty := statusFilter(strings.ToUpper(strings.TrimSpace(status)))
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	items := []map[string]any{}
	var total int64
	if !forceEmpty {
		rows, err := s.q().ListPatientAppointments(ctx, gen.ListPatientAppointmentsParams{
			PatientID: uid, Column2: status,
			Column3: timeOrNull(from), Column4: timeOrNull(to), Column5: strings.TrimSpace(q),
			Limit: int32(perPage), Offset: int32((page - 1) * perPage),
		})
		if err != nil {
			return nil, err
		}
		total, err = s.q().CountPatientAppointments(ctx, gen.CountPatientAppointmentsParams{
			PatientID: uid, Column2: status,
			Column3: timeOrNull(from), Column4: timeOrNull(to), Column5: strings.TrimSpace(q),
		})
		if err != nil {
			return nil, err
		}
		doctorsByID := s.doctorsByIDs(ctx, rows)
		refsByAppt := s.consultationRefsByAppointments(ctx, rows)
		for _, r := range rows {
			item := appointmentJSON(r)
			if d, ok := doctorsByID[r.DoctorID.String()]; ok {
				item["doctor"] = doctorProjection(d)
			}
			item["consultation_id"] = refsByAppt[r.ID.String()]
			items = append(items, item)
		}
	}
	return paged(items, total, page, perPage), nil
}

// ListDoctor mirrors ListPatient without counterparty population (Nest parity).
func (s *Service) ListDoctor(ctx context.Context, doctorID, status string, from, to *time.Time, q string, page, perPage int) (map[string]any, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 20
	}
	if perPage > 100 {
		perPage = 100
	}
	status, forceEmpty := statusFilter(strings.ToUpper(strings.TrimSpace(status)))
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	items := []map[string]any{}
	var total int64
	if !forceEmpty {
		rows, err := s.q().ListDoctorAppointments(ctx, gen.ListDoctorAppointmentsParams{
			DoctorID: uid, Column2: status,
			Column3: timeOrNull(from), Column4: timeOrNull(to), Column5: strings.TrimSpace(q),
			Limit: int32(perPage), Offset: int32((page - 1) * perPage),
		})
		if err != nil {
			return nil, err
		}
		if status == "" {
			// Omitted status excludes RESCHEDULED/COMPLETED (Nest default).
			filtered := rows[:0]
			for _, r := range rows {
				if r.Status != StatusRescheduled && r.Status != StatusCompleted {
					filtered = append(filtered, r)
				}
			}
			rows = filtered
		}
		total, err = s.q().CountDoctorAppointments(ctx, gen.CountDoctorAppointmentsParams{
			DoctorID: uid, Column2: status,
			Column3: timeOrNull(from), Column4: timeOrNull(to), Column5: strings.TrimSpace(q),
		})
		if err != nil {
			return nil, err
		}
		refsByAppt := s.consultationRefsByAppointments(ctx, rows)
		for _, r := range rows {
			item := appointmentJSON(r)
			item["consultation_id"] = refsByAppt[r.ID.String()]
			items = append(items, item)
		}
	}
	return paged(items, total, page, perPage), nil
}

func timeOrNull(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func paged(items []map[string]any, total int64, page, perPage int) map[string]any {
	pages := 0
	if perPage > 0 {
		pages = int((total + int64(perPage) - 1) / int64(perPage))
	}
	return map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page": page, "perPage": perPage, "total": total, "totalPages": pages,
		},
	}
}

// doctorsByIDs batch-loads counterparty doctors in one query (Nest
// populate parity without N+1).
func (s *Service) doctorsByIDs(ctx context.Context, rows []gen.Appointment) map[string]gen.Doctor {
	seen := map[string]bool{}
	var ids []pgtype.UUID
	for _, r := range rows {
		if r.DoctorID.Valid && !seen[r.DoctorID.String()] {
			seen[r.DoctorID.String()] = true
			ids = append(ids, r.DoctorID)
		}
	}
	out := map[string]gen.Doctor{}
	if len(ids) == 0 {
		return out
	}
	found, err := s.q().GetDoctorsByIDs(ctx, ids)
	if err != nil {
		return out
	}
	for _, d := range found {
		out[d.ID.String()] = d
	}
	return out
}

func doctorProjection(d gen.Doctor) map[string]any {
	return map[string]any{
		"_id": d.ID.String(), "first_name": d.FirstName, "last_name": d.LastName,
		"full_name": textOrNull(d.FullName), "email": d.Email,
		"specializations":     strs(anyStrings(d.Specializations)),
		"profile_picture_url": textOrNull(d.ProfilePictureUrl),
	}
}

func (s *Service) consultationRef(ctx context.Context, apptID pgtype.UUID) any {
	c, err := s.q().GetConsultationByAppointment(ctx, apptID)
	if err != nil {
		return nil
	}
	return c.Reference
}

// consultationRefsByAppointments batch-loads consultation references for a
// page of appointments in one query (list paths must not N+1).
func (s *Service) consultationRefsByAppointments(ctx context.Context, rows []gen.Appointment) map[string]any {
	out := map[string]any{}
	if len(rows) == 0 {
		return out
	}
	ids := make([]pgtype.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	found, err := s.q().GetConsultationRefsByAppointments(ctx, ids)
	if err != nil {
		return out
	}
	for _, f := range found {
		out[f.AppointmentID.String()] = f.Reference
	}
	return out
}

// DetailPatient enriches with doctor + consultation + history.
func (s *Service) DetailPatient(ctx context.Context, patientID, apptID string) (map[string]any, error) {
	var aid pgtype.UUID
	if err := aid.Scan(apptID); err != nil {
		return nil, auth.BadRequest("Invalid appointment id")
	}
	appt, err := s.q().GetAppointmentByID(ctx, aid)
	if err != nil {
		return nil, auth.NotFound("Appointment not found")
	}
	if !appt.PatientID.Valid || appt.PatientID.String() != patientID {
		return nil, auth.NotFound("Appointment not found")
	}
	return s.detail(ctx, appt)
}

// DetailDoctor enriches with patient + consultation + history.
func (s *Service) DetailDoctor(ctx context.Context, doctorID, apptID string) (map[string]any, error) {
	appt, err := s.doctorOwns(ctx, doctorID, apptID)
	if err != nil {
		return nil, err
	}
	return s.detail(ctx, appt)
}

func (s *Service) detail(ctx context.Context, appt gen.Appointment) (map[string]any, error) {
	item := appointmentJSON(appt)
	// Three independent lookups: fan out, merge after.
	var docOut map[string]any
	var patOut map[string]any
	var consOut map[string]any
	var consRef any
	_ = concurrent.Do(ctx,
		func(ctx context.Context) error {
			if appt.DoctorID.Valid {
				if doc, err := s.q().GetDoctorByID(ctx, appt.DoctorID); err == nil {
					docOut = doctorProjection(doc)
				}
			}
			return nil
		},
		func(ctx context.Context) error {
			if appt.PatientID.Valid {
				if user, err := s.q().GetPatientByID(ctx, appt.PatientID); err == nil {
					patOut = map[string]any{
						"_id": user.ID.String(), "first_name": user.FirstName,
						"last_name": user.LastName, "email": user.Email,
					}
				}
			}
			return nil
		},
		func(ctx context.Context) error {
			if c, err := s.q().GetConsultationByAppointment(ctx, appt.ID); err == nil {
				consOut = map[string]any{
					"_id": c.ID.String(), "reference": c.Reference, "type": c.Type,
					"title": c.Title, "status": c.Status,
				}
				consRef = c.Reference
			}
			return nil
		},
	)
	if docOut != nil {
		item["doctor"] = docOut
	}
	if patOut != nil {
		item["patient"] = patOut
	}
	if consOut != nil {
		item["consultation"] = consOut
		item["consultation_id"] = consRef
	}
	item["rescheduled_history"] = s.history(ctx, appt)
	return item, nil
}

func (s *Service) history(ctx context.Context, appt gen.Appointment) []map[string]any {
	chain, err := s.q().RescheduleChain(ctx, gen.RescheduleChainParams{
		AppointmentNumber: appt.AppointmentNumber, RescheduledFromAppointmentID: appt.ID,
	})
	if err != nil {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(chain))
	for _, r := range chain {
		if r.ID == appt.ID {
			continue
		}
		out = append(out, appointmentJSON(r))
	}
	return out
}

// ByNumber trims input, takes the latest by start, 404s when empty.
func (s *Service) ByNumber(ctx context.Context, number string) (map[string]any, error) {
	number = strings.TrimSpace(number)
	if number == "" {
		return nil, auth.BadRequest("Appointment number is required")
	}
	appt, err := s.q().GetLatestAppointmentByNumber(ctx, number)
	if err != nil {
		return nil, auth.NotFound("Appointment not found")
	}
	return s.detail(ctx, appt)
}

// Approved returns CONFIRMED-only items grouped by ISO week (desc).
func (s *Service) Approved(ctx context.Context, ownerID, role string, week, year int) (map[string]any, error) {
	var from, to *time.Time
	if week > 0 {
		y := year
		if y == 0 {
			y = time.Now().UTC().Year()
		}
		start := ISOWeekStart(y, week)
		end := start.Add(7 * 24 * time.Hour)
		from, to = &start, &end
	}
	var raw map[string]any
	var err error
	if role == "patient" {
		raw, err = s.ListPatient(ctx, ownerID, StatusConfirmed, from, to, "", 1, 100)
	} else {
		raw, err = s.ListDoctor(ctx, ownerID, StatusConfirmed, from, to, "", 1, 100)
	}
	if err != nil {
		return nil, err
	}
	items := raw["items"].([]map[string]any)
	groups := map[string][]map[string]any{}
	for _, it := range items {
		startStr, _ := it["scheduled_start_at_utc"].(string)
		start, _ := time.Parse(time.RFC3339Nano, startStr)
		y, w := start.UTC().ISOWeek()
		key := fmt.Sprintf("%d-W%d", y, w)
		groups[key] = append(groups[key], it)
	}
	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] > keys[j] })
	out := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		var y, w int
		fmt.Sscanf(k, "%d-W%d", &y, &w)
		ws := ISOWeekStart(y, w)
		out = append(out, map[string]any{
			"week": w, "year": y,
			"start_at_utc": ws.Format(time.RFC3339Nano),
			"end_at_utc":   ws.Add(7 * 24 * time.Hour).Format(time.RFC3339Nano),
			"items":        groups[k],
		})
	}
	total := 0
	for _, g := range groups {
		total += len(g)
	}
	return map[string]any{
		"filter": map[string]any{"status": StatusConfirmed, "weekly": week, "year": year},
		"total":  total, "groups": out,
	}, nil
}

// All returns the unpaginated feed (RESCHEDULED excluded, start desc).
func (s *Service) All(ctx context.Context, ownerID, role string) ([]map[string]any, error) {
	var raw map[string]any
	var err error
	if role == "patient" {
		raw, err = s.ListPatient(ctx, ownerID, "", nil, nil, "", 1, 10000)
	} else {
		raw, err = s.ListDoctor(ctx, ownerID, "", nil, nil, "", 1, 10000)
	}
	if err != nil {
		return nil, err
	}
	return raw["items"].([]map[string]any), nil
}

// --- schedules --------------------------------------------------------------

// DoctorSchedule returns PENDING/CONFIRMED appointments + blackouts for an
// ISO week, or everything unscoped without one.
func (s *Service) DoctorSchedule(ctx context.Context, doctorID string, week, year int) (map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	if week <= 0 {
		// Unscoped: all non-retired appointments regardless of range.
		all, err := s.ListDoctor(ctx, doctorID, "", nil, nil, "", 1, 10000)
		if err != nil {
			return nil, err
		}
		blackouts, err := s.q().ListBlackoutsByDoctor(ctx, uid)
		if err != nil {
			return nil, err
		}
		items := all["items"].([]map[string]any)
		bitems := make([]map[string]any, 0, len(blackouts))
		for _, b := range blackouts {
			bitems = append(bitems, blackoutJSON(b))
		}
		// Keep only active statuses (ListDoctor already excludes RESCHEDULED/
		// COMPLETED when unfiltered).
		kept := items[:0]
		for _, it := range items {
			if it["status"] == StatusPending || it["status"] == StatusConfirmed {
				kept = append(kept, it)
			}
		}
		return map[string]any{"appointments": kept, "blackouts": bitems}, nil
	}
	y := year
	if y == 0 {
		y = time.Now().UTC().Year()
	}
	start := ISOWeekStart(y, week)
	end := start.Add(7 * 24 * time.Hour)
	appts, err := s.q().DoctorRangeAppointments(ctx, gen.DoctorRangeAppointmentsParams{
		DoctorID:              uid,
		ScheduledStartAtUtc:   pgtype.Timestamptz{Time: start, Valid: true},
		ScheduledStartAtUtc_2: pgtype.Timestamptz{Time: end, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(appts))
	for _, r := range appts {
		item := appointmentJSON(r)
		if r.PatientID.Valid {
			if user, err := s.q().GetPatientByID(ctx, r.PatientID); err == nil {
				item["patient"] = map[string]any{
					"_id": user.ID.String(), "first_name": user.FirstName,
					"last_name": user.LastName,
					"full_name": textOrNull(user.FullName), "email": user.Email,
					"profile_picture_url": textOrNull(user.ProfilePictureUrl),
				}
			}
		}
		if c, err := s.q().GetConsultationByAppointment(ctx, r.ID); err == nil {
			item["consultation"] = map[string]any{
				"reference": c.Reference, "type": c.Type,
				"title": c.Title, "status": c.Status,
			}
		}
		items = append(items, item)
	}
	blackouts, err := s.q().RangeBlackoutsOverlap(ctx, gen.RangeBlackoutsOverlapParams{
		DoctorID: uid,
		NewStart: pgtype.Timestamptz{Time: start, Valid: true},
		NewEnd:   pgtype.Timestamptz{Time: end, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	rec, err := s.q().ListRecurringBlackouts(ctx, uid)
	if err != nil {
		return nil, err
	}
	zone := "UTC"
	if avail, err := s.q().GetAvailabilityByDoctor(ctx, uid); err == nil && avail.Timezone != "" {
		zone = avail.Timezone
	}
	bitems := make([]map[string]any, 0, len(blackouts)+len(rec))
	for _, b := range blackouts {
		bitems = append(bitems, blackoutJSON(b))
	}
	bitems = append(bitems, expandRecurring(rec, start, end, zone)...)
	return map[string]any{
		"week": week, "year": y,
		"start_at_utc": start.Format(time.RFC3339Nano),
		"end_at_utc":   end.Format(time.RFC3339Nano),
		"timezone":     zone,
		"appointments": items, "blackouts": bitems,
	}, nil
}

// expandRecurring materializes recurring rules into week occurrences.
func expandRecurring(rows []gen.DoctorBlackout, start, end time.Time, zone string) []map[string]any {
	out := []map[string]any{}
	for _, r := range rows {
		if !r.DayOfWeek.Valid || !r.StartTimeMinutes.Valid || !r.EndTimeMinutes.Valid {
			continue
		}
		day := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
		for !day.After(end.Add(-time.Second)) {
			parts := ZonedClock(day, zone)
			if parts.DayOfWeek == int(r.DayOfWeek.Int16) {
				dateStr := parts.ISODate
				sUTC, err1 := DateAndTimeToUTC(dateStr, MinutesToHHMM(int(r.StartTimeMinutes.Int32)), zone)
				eUTC, err2 := DateAndTimeToUTC(dateStr, MinutesToHHMM(int(r.EndTimeMinutes.Int32)), zone)
				if err1 == nil && err2 == nil && !sUTC.Before(start) && eUTC.Before(end.Add(time.Second)) {
					m := blackoutJSON(r)
					m["start_at_utc"] = sUTC.Format(time.RFC3339Nano)
					m["end_at_utc"] = eUTC.Format(time.RFC3339Nano)
					out = append(out, m)
				}
			}
			day = day.Add(24 * time.Hour)
		}
	}
	return out
}

// PatientSchedule returns the patient's appointments for a week, or all.
func (s *Service) PatientSchedule(ctx context.Context, patientID string, week, year int) (map[string]any, error) {
	if week <= 0 {
		raw, err := s.ListPatient(ctx, patientID, "", nil, nil, "", 1, 10000)
		if err != nil {
			return nil, err
		}
		return map[string]any{"appointments": raw["items"]}, nil
	}
	y := year
	if y == 0 {
		y = time.Now().UTC().Year()
	}
	start := ISOWeekStart(y, week)
	end := start.Add(7 * 24 * time.Hour)
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	appts, err := s.q().PatientRangeAppointments(ctx, gen.PatientRangeAppointmentsParams{
		PatientID:             uid,
		ScheduledStartAtUtc:   pgtype.Timestamptz{Time: start, Valid: true},
		ScheduledStartAtUtc_2: pgtype.Timestamptz{Time: end, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(appts))
	for _, r := range appts {
		item := appointmentJSON(r)
		if r.DoctorID.Valid {
			if doc, err := s.q().GetDoctorByID(ctx, r.DoctorID); err == nil {
				item["doctor"] = doctorProjection(doc)
			}
		}
		items = append(items, item)
	}
	return map[string]any{
		"week": week, "year": y,
		"start_at_utc": start.Format(time.RFC3339Nano),
		"end_at_utc":   end.Format(time.RFC3339Nano),
		"appointments": items,
	}, nil
}

var _ = math.MaxInt

// GetForReschedule loads and scopes an appointment for reschedule callers.
func (s *Service) GetForReschedule(ctx context.Context, ownerID, role, apptID string) (gen.Appointment, error) {
	var aid pgtype.UUID
	if err := aid.Scan(apptID); err != nil {
		return gen.Appointment{}, auth.BadRequest("Invalid appointment id")
	}
	appt, err := s.q().GetAppointmentByID(ctx, aid)
	if err != nil {
		return gen.Appointment{}, auth.NotFound("Appointment not found")
	}
	if role == "patient" {
		if !appt.PatientID.Valid || appt.PatientID.String() != ownerID {
			return gen.Appointment{}, auth.NotFound("Appointment not found")
		}
		return appt, nil
	}
	return s.doctorOwns(ctx, ownerID, apptID)
}

// PatientFeed is the booking-side alias of the doctor patient feed.
func (s *Service) PatientFeed(ctx context.Context, doctorID, q string) ([]map[string]any, error) {
	rows, err := s.q().ListPatientsForDoctor(ctx, gen.ListPatientsForDoctorParams{
		Column1: strings.TrimSpace(q), Limit: 100, Offset: 0, Column4: pgtype.Date{},
	})
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, map[string]any{
			"_id": r.ID.String(), "first_name": r.FirstName, "last_name": r.LastName,
			"email": r.Email, "registration_no": r.RegistrationNo,
		})
	}
	return out, nil
}
