package booking

import (
	"context"
	"time"

	"github.com/wizzyszn/Telemex/internal/concurrent"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/notify"
)

// notify.go persists notification rows at booking lifecycle transitions.
// It ports the appointment-notifications listener mapping (who gets told)
// with copy from internal/notify; the unique event_key index dedupes
// retries and double-emits (e.g. concurrent confirms).

func personOf(first, last, full string) *notify.Person {
	return &notify.Person{FirstName: first, LastName: last, FullName: full}
}

func doctorPerson(ctx context.Context, s *Service, id pgtype.UUID) *notify.Person {
	if !id.Valid {
		return nil
	}
	doc, err := s.q().GetDoctorByID(ctx, id)
	if err != nil {
		return nil
	}
	return personOf(doc.FirstName, doc.LastName, textOrNullStr(doc.FullName))
}

func patientPerson(ctx context.Context, s *Service, id pgtype.UUID) *notify.Person {
	if !id.Valid {
		return nil
	}
	user, err := s.q().GetPatientByID(ctx, id)
	if err != nil {
		return nil
	}
	return personOf(user.FirstName, user.LastName, textOrNullStr(user.FullName))
}

func textOrNullStr(v pgtype.Text) string {
	if v.Valid {
		return v.String
	}
	return ""
}

func whenOf(appt gen.Appointment) string {
	if appt.ScheduledStartAtUtc.Valid {
		zone := appt.TimezoneSnapshot
		if zone == "" {
			zone = "UTC"
		}
		return notify.FormatWhen(appt.ScheduledStartAtUtc.Time, zone, zone)
	}
	return ""
}

func (s *Service) storeMany(ctx context.Context, specs []notify.Spec) {
	if len(specs) == 0 {
		return
	}
	// Inserts are independent rows (dedupe by event_key): fan out bounded.
	_, _ = concurrent.Map(ctx, 4, specs, func(ctx context.Context, spec notify.Spec) (struct{}, error) {
		s.store(ctx, spec)
		return struct{}{}, nil
	})
}

func (s *Service) store(ctx context.Context, spec notify.Spec) {
	data, _ := jsonMarshal(spec.Data)
	_ = s.q().CreateNotification(ctx, gen.CreateNotificationParams{
		RecipientID: uuidOrNullPG(spec.RecipientID), RecipientType: spec.RecipientType,
		Type: spec.Type, Category: spec.Category, Title: spec.Title, Body: spec.Body,
		Data:           data,
		AppointmentID:  uuidOrNullPG(spec.AppointmentID),
		ConsultationID: uuidOrNullPG(spec.ConsultationID),
		ActorID:        uuidOrNullPG(spec.ActorID),
		ActorType:      textOrEmpty(spec.ActorType),
		DeepLink:       textOrEmpty(spec.DeepLink),
		EventKey:       spec.EventKey,
	})
}

func uuidOrNullPG(id string) pgtype.UUID {
	var uid pgtype.UUID
	if id == "" {
		return uid
	}
	_ = uid.Scan(id)
	return uid
}

func dataFacts(appt gen.Appointment) map[string]any {
	return map[string]any{
		"appointment_id":     appt.ID.String(),
		"appointment_number": appt.AppointmentNumber,
		"status":             appt.Status,
	}
}

func (s *Service) emitCreated(ctx context.Context, appt gen.Appointment) {
	var specs []notify.Spec
	patientID := ""
	if appt.PatientID.Valid {
		patientID = appt.PatientID.String()
	}
	doctorID := ""
	if appt.DoctorID.Valid {
		doctorID = appt.DoctorID.String()
	}
	when := whenOf(appt)
	pending := appt.Status == StatusPending
	doc := doctorPerson(ctx, s, appt.DoctorID)
	pat := patientPerson(ctx, s, appt.PatientID)
	if patientID != "" {
		specs = append(specs, notify.PatientAppointmentBooked(notify.AppointmentBookedArgs{
			PatientID: patientID, AppointmentID: appt.ID.String(),
			Doctor: doc, DoctorID: doctorID, When: when, Pending: pending,
			Data: dataFacts(appt),
		}))
	}
	if doctorID != "" {
		specs = append(specs, notify.DoctorAppointmentRequest(notify.DoctorAppointmentRequestArgs{
			DoctorID: doctorID, PatientID: patientID, AppointmentID: appt.ID.String(),
			Patient: pat, When: when, Pending: pending, Data: dataFacts(appt),
		}))
	}
	s.storeMany(ctx, specs)
}

func (s *Service) emitConfirmed(ctx context.Context, appt gen.Appointment) {
	var specs []notify.Spec
	patientID := ""
	if appt.PatientID.Valid {
		patientID = appt.PatientID.String()
	}
	doctorID := ""
	if appt.DoctorID.Valid {
		doctorID = appt.DoctorID.String()
	}
	if patientID == "" {
		return
	}
	specs = append(specs, notify.PatientAppointmentConfirmed(notify.AppointmentConfirmedArgs{
		PatientID: patientID, AppointmentID: appt.ID.String(),
		Doctor: doctorPerson(ctx, s, appt.DoctorID), DoctorID: doctorID,
		When: whenOf(appt), Data: dataFacts(appt),
	}))
	s.storeMany(ctx, specs)
}

func (s *Service) emitCancelled(ctx context.Context, appt gen.Appointment, by string) {
	var specs []notify.Spec
	patientID := ""
	if appt.PatientID.Valid {
		patientID = appt.PatientID.String()
	}
	doctorID := ""
	if appt.DoctorID.Valid {
		doctorID = appt.DoctorID.String()
	}
	when := whenOf(appt)
	// The OTHER party is told (Nest parity).
	if by == "doctor" && patientID != "" {
		specs = append(specs, notify.AppointmentCancelled(notify.AppointmentCancelledArgs{
			RecipientID: patientID, RecipientType: notify.RecipientPatient,
			AppointmentID: appt.ID.String(),
			Actor:         doctorPerson(ctx, s, appt.DoctorID), ActorID: doctorID,
			ActorType: notify.RecipientDoctor, When: when, Data: dataFacts(appt),
		}))
	}
	if by == "patient" && doctorID != "" {
		specs = append(specs, notify.AppointmentCancelled(notify.AppointmentCancelledArgs{
			RecipientID: doctorID, RecipientType: notify.RecipientDoctor,
			AppointmentID: appt.ID.String(),
			Actor:         patientPerson(ctx, s, appt.PatientID), ActorID: patientID,
			ActorType: notify.RecipientPatient, When: when, Data: dataFacts(appt),
		}))
	}
	s.storeMany(ctx, specs)
}

func (s *Service) emitRescheduled(ctx context.Context, old, successor gen.Appointment, actorRole, reason string, fallbackUsed bool) {
	var specs []notify.Spec
	_ = reason
	_ = fallbackUsed
	patientID := ""
	if successor.PatientID.Valid {
		patientID = successor.PatientID.String()
	}
	when := whenOf(successor)
	newID := successor.ID.String()
	oldDoctor, newDoctor := "", ""
	if old.DoctorID.Valid {
		oldDoctor = old.DoctorID.String()
	}
	if successor.DoctorID.Valid {
		newDoctor = successor.DoctorID.String()
	}
	actorType := notify.RecipientPatient
	var actor *notify.Person
	var actorID string
	if actorRole == "DOCTOR" {
		actorType = notify.RecipientDoctor
		actor = doctorPerson(ctx, s, successor.DoctorID)
		actorID = newDoctor
	} else {
		actor = patientPerson(ctx, s, successor.PatientID)
		actorID = patientID
	}
	// Counterparty learns the new time.
	if actorRole == "DOCTOR" && patientID != "" {
		specs = append(specs, notify.AppointmentRescheduled(notify.AppointmentRescheduledArgs{
			RecipientID: patientID, RecipientType: notify.RecipientPatient,
			NewAppointmentID: newID, Actor: actor, ActorID: actorID,
			ActorType: actorType, NewWhen: when, Data: dataFacts(successor),
		}))
	}
	if actorRole == "PATIENT" && newDoctor != "" {
		specs = append(specs, notify.AppointmentRescheduled(notify.AppointmentRescheduledArgs{
			RecipientID: newDoctor, RecipientType: notify.RecipientDoctor,
			NewAppointmentID: newID, Actor: actor, ActorID: actorID,
			ActorType: actorType, NewWhen: when, Data: dataFacts(successor),
		}))
	}
	// Reassignment tells both doctors.
	if newDoctor != "" && newDoctor != oldDoctor {
		if oldDoctor != "" {
			specs = append(specs, notify.DoctorAppointmentRemoved(notify.DoctorAppointmentRemovedArgs{
				DoctorID: oldDoctor, OldAppointmentID: old.ID.String(),
				When: whenOf(old), Data: dataFacts(successor),
			}))
		}
		specs = append(specs, notify.DoctorAppointmentAssigned(notify.DoctorAppointmentAssignedArgs{
			DoctorID: newDoctor, NewAppointmentID: newID,
			Patient: patientPerson(ctx, s, successor.PatientID), PatientID: patientID,
			When: when, Data: dataFacts(successor),
		}))
	}
	s.storeMany(ctx, specs)
}

var _ = time.Now
