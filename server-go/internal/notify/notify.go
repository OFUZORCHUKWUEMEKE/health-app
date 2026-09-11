// Package notify holds notification copy as pure functions — no DI, no I/O.
// It ports notification-templates.ts verbatim so copy stays identical across
// backends.
//
// THE PHI RULE: title and body carry names, times and counts ONLY. Never a
// drug name, test name, diagnosis, or referral reason. This text is stored
// and feeds email and push later, so anything written here should be assumed
// to leave the system and land on a lock screen. Detail lives behind the
// deep link, inside the authenticated app.
package notify

import (
	"fmt"
	"strings"
	"time"
)

// Recipient types (lowercase wire values).
const (
	RecipientPatient = "patient"
	RecipientDoctor  = "doctor"
)

// Categories.
const (
	CategoryAppointment  = "APPOINTMENT"
	CategoryConsultation = "CONSULTATION"
	CategoryClinical     = "CLINICAL"
	CategoryVideo        = "VIDEO"
	CategoryReminder     = "REMINDER"
)

// Notification types (stable — never reuse a value; history keeps old ones).
const (
	TypeAppointmentBooked          = "APPOINTMENT_BOOKED"
	TypeAppointmentRequestReceived = "APPOINTMENT_REQUEST_RECEIVED"
	TypeAppointmentConfirmed       = "APPOINTMENT_CONFIRMED"
	TypeAppointmentCancelled       = "APPOINTMENT_CANCELLED"
	TypeAppointmentRescheduled     = "APPOINTMENT_RESCHEDULED"
	TypeAppointmentReassigned      = "APPOINTMENT_REASSIGNED"
	TypeAppointmentRemoved         = "APPOINTMENT_REMOVED"
	TypeAppointmentReminder24H     = "APPOINTMENT_REMINDER_24H"
	TypeAppointmentReminder1H      = "APPOINTMENT_REMINDER_1H"
	TypeConsultationSummary        = "CONSULTATION_SUMMARY_AVAILABLE"
	TypeInvestigationsRequested    = "INVESTIGATIONS_REQUESTED"
	TypePrescriptionReady          = "PRESCRIPTION_READY"
	TypeReferralAvailable          = "REFERRAL_AVAILABLE"
	TypeInvestigationResults       = "INVESTIGATION_RESULTS_UPLOADED"
	TypeVideoRoomOpened            = "VIDEO_ROOM_OPENED"
)

// Person is any named party (patient, doctor, actor).
type Person struct {
	FirstName string
	LastName  string
	FullName  string
}

// Spec is the write shape for one notification row (mirrors NotificationSpec).
type Spec struct {
	RecipientID    string
	RecipientType  string
	Type           string
	Category       string
	Title          string
	Body           string
	Data           map[string]any
	AppointmentID  string
	ConsultationID string
	ActorID        string
	ActorType      string
	DeepLink       string
	EventKey       string
}

// PersonName degrades gracefully rather than rendering "undefined".
func PersonName(p *Person, fallback string) string {
	if p == nil {
		return fallback
	}
	composed := strings.TrimSpace(strings.TrimSpace(p.FirstName) + " " + strings.TrimSpace(p.LastName))
	composed = strings.TrimSpace(strings.ReplaceAll(composed, "  ", " "))
	if composed != "" {
		return composed
	}
	if strings.TrimSpace(p.FullName) != "" {
		return strings.TrimSpace(p.FullName)
	}
	return fallback
}

// DoctorName prefixes with Dr, falling back to "your doctor".
func DoctorName(d *Person) string {
	if name := PersonName(d, ""); name != "" {
		return "Dr " + name
	}
	return "your doctor"
}

// EventKey is the deterministic dedupe key behind the unique index.
func EventKey(kind, subjectID, recipientType, recipientID string) string {
	return kind + ":" + subjectID + ":" + recipientType + ":" + recipientID
}

// FormatWhen renders an instant in the recipient's own zone, falling back to
// the booking zone, degrading to UTC on a malformed zone (never throws).
func FormatWhen(startUTC time.Time, recipientZone, snapshotZone string) string {
	zone := recipientZone
	if zone == "" {
		zone = snapshotZone
	}
	loc, err := time.LoadLocation(zone)
	if err != nil || zone == "" {
		loc = time.UTC
	}
	return startUTC.In(loc).Format("Mon, 02 Jan 2006 at 15:04 MST")
}

// HumanizeMinutes renders a real remaining duration, not a nominal offset.
func HumanizeMinutes(minutes int) string {
	if minutes <= 1 {
		return "in under a minute"
	}
	if minutes < 60 {
		return fmt.Sprintf("in %d minutes", minutes)
	}
	hours := (minutes + 30) / 60
	if hours < 24 {
		if hours == 1 {
			return "in about an hour"
		}
		return fmt.Sprintf("in about %d hours", hours)
	}
	days := (hours + 12) / 24
	if days == 1 {
		return "tomorrow"
	}
	return fmt.Sprintf("in %d days", days)
}

func dataOrEmpty(data map[string]any) map[string]any {
	if data == nil {
		return map[string]any{}
	}
	return data
}

// ─── Appointments ───────────────────────────────────────────────

type AppointmentBookedArgs struct {
	PatientID     string
	AppointmentID string
	Doctor        *Person
	DoctorID      string
	When          string
	Pending       bool
	Data          map[string]any
}

func PatientAppointmentBooked(a AppointmentBookedArgs) Spec {
	actorType := ""
	if a.DoctorID != "" {
		actorType = RecipientDoctor
	}
	title, body := "Appointment booked", "Your appointment with "+DoctorName(a.Doctor)+" is booked for "+a.When+"."
	if a.Pending {
		title = "Appointment request sent"
		body = "Your request for " + a.When + " is awaiting confirmation."
	}
	return Spec{
		RecipientID: a.PatientID, RecipientType: RecipientPatient,
		Type: TypeAppointmentBooked, Category: CategoryAppointment,
		Title: title, Body: body,
		AppointmentID: a.AppointmentID, ActorID: a.DoctorID, ActorType: actorType,
		DeepLink: "/appointments/" + a.AppointmentID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey("appointment_booked", a.AppointmentID, RecipientPatient, a.PatientID),
	}
}

type DoctorAppointmentRequestArgs struct {
	DoctorID      string
	PatientID     string
	AppointmentID string
	Patient       *Person
	When          string
	Pending       bool
	Data          map[string]any
}

func DoctorAppointmentRequest(a DoctorAppointmentRequestArgs) Spec {
	typ, title := TypeAppointmentBooked, "New appointment booked"
	if a.Pending {
		typ, title = TypeAppointmentRequestReceived, "New consultation request"
	}
	return Spec{
		RecipientID: a.DoctorID, RecipientType: RecipientDoctor,
		Type: typ, Category: CategoryAppointment, Title: title,
		Body:          PersonName(a.Patient, "A patient") + " — " + a.When + ".",
		AppointmentID: a.AppointmentID, ActorID: a.PatientID, ActorType: RecipientPatient,
		DeepLink: "/appointments/" + a.AppointmentID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey("appointment_booked", a.AppointmentID, RecipientDoctor, a.DoctorID),
	}
}

type AppointmentConfirmedArgs struct {
	PatientID     string
	AppointmentID string
	Doctor        *Person
	DoctorID      string
	When          string
	Data          map[string]any
}

func PatientAppointmentConfirmed(a AppointmentConfirmedArgs) Spec {
	return Spec{
		RecipientID: a.PatientID, RecipientType: RecipientPatient,
		Type: TypeAppointmentConfirmed, Category: CategoryAppointment,
		Title:         "Appointment confirmed",
		Body:          DoctorName(a.Doctor) + " confirmed your appointment for " + a.When + ".",
		AppointmentID: a.AppointmentID, ActorID: a.DoctorID, ActorType: RecipientDoctor,
		DeepLink: "/appointments/" + a.AppointmentID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey("appointment_confirmed", a.AppointmentID, RecipientPatient, a.PatientID),
	}
}

type AppointmentCancelledArgs struct {
	RecipientID   string
	RecipientType string
	AppointmentID string
	Actor         *Person
	ActorID       string
	ActorType     string
	When          string
	Data          map[string]any
	// NOTE: no reason field — cancellation copy must never carry the
	// caller-supplied reason text (PHI rule; covered by test).
}

func AppointmentCancelled(a AppointmentCancelledArgs) Spec {
	who := PersonName(a.Actor, "The patient")
	if a.ActorType == RecipientDoctor {
		who = DoctorName(a.Actor)
	}
	return Spec{
		RecipientID: a.RecipientID, RecipientType: a.RecipientType,
		Type: TypeAppointmentCancelled, Category: CategoryAppointment,
		Title:         "Appointment cancelled",
		Body:          who + " cancelled the appointment scheduled for " + a.When + ".",
		AppointmentID: a.AppointmentID, ActorID: a.ActorID, ActorType: a.ActorType,
		DeepLink: "/appointments/" + a.AppointmentID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey("appointment_cancelled", a.AppointmentID, a.RecipientType, a.RecipientID),
	}
}

type AppointmentRescheduledArgs struct {
	RecipientID      string
	RecipientType    string
	NewAppointmentID string
	Actor            *Person
	ActorID          string
	ActorType        string
	NewWhen          string
	Data             map[string]any
}

func AppointmentRescheduled(a AppointmentRescheduledArgs) Spec {
	who := PersonName(a.Actor, "The patient")
	if a.ActorType == RecipientDoctor {
		who = DoctorName(a.Actor)
	}
	return Spec{
		RecipientID: a.RecipientID, RecipientType: a.RecipientType,
		Type: TypeAppointmentRescheduled, Category: CategoryAppointment,
		Title:         "Appointment rescheduled",
		Body:          who + " moved the appointment to " + a.NewWhen + ".",
		AppointmentID: a.NewAppointmentID, ActorID: a.ActorID, ActorType: a.ActorType,
		DeepLink: "/appointments/" + a.NewAppointmentID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey("appointment_rescheduled", a.NewAppointmentID, a.RecipientType, a.RecipientID),
	}
}

type DoctorAppointmentRemovedArgs struct {
	DoctorID         string
	OldAppointmentID string
	When             string
	Data             map[string]any
}

func DoctorAppointmentRemoved(a DoctorAppointmentRemovedArgs) Spec {
	return Spec{
		RecipientID: a.DoctorID, RecipientType: RecipientDoctor,
		Type: TypeAppointmentRemoved, Category: CategoryAppointment,
		Title:         "Appointment removed from your schedule",
		Body:          "The appointment for " + a.When + " was rescheduled to another doctor.",
		AppointmentID: a.OldAppointmentID,
		DeepLink:      "/appointments/" + a.OldAppointmentID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey("appointment_removed", a.OldAppointmentID, RecipientDoctor, a.DoctorID),
	}
}

type DoctorAppointmentAssignedArgs struct {
	DoctorID         string
	NewAppointmentID string
	Patient          *Person
	PatientID        string
	When             string
	Data             map[string]any
}

func DoctorAppointmentAssigned(a DoctorAppointmentAssignedArgs) Spec {
	return Spec{
		RecipientID: a.DoctorID, RecipientType: RecipientDoctor,
		Type: TypeAppointmentReassigned, Category: CategoryAppointment,
		Title:         "Appointment added to your schedule",
		Body:          PersonName(a.Patient, "A patient") + " — " + a.When + ".",
		AppointmentID: a.NewAppointmentID, ActorID: a.PatientID, ActorType: RecipientPatient,
		DeepLink: "/appointments/" + a.NewAppointmentID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey("appointment_assigned", a.NewAppointmentID, RecipientDoctor, a.DoctorID),
	}
}

// ─── Reminders ──────────────────────────────────────────────────

type AppointmentReminderArgs struct {
	RecipientID       string
	RecipientType     string
	AppointmentID     string
	Counterparty      *Person
	When              string
	MinutesUntilStart int
	OffsetMinutes     int
	Data              map[string]any
}

func AppointmentReminder(a AppointmentReminderArgs) Spec {
	isDoctor := a.RecipientType == RecipientDoctor
	who := DoctorName(a.Counterparty)
	if isDoctor {
		who = PersonName(a.Counterparty, "a patient")
	}
	typ := TypeAppointmentReminder1H
	if a.OffsetMinutes >= 1440 {
		typ = TypeAppointmentReminder24H
	}
	title := "Appointment reminder"
	if isDoctor {
		title = "Upcoming appointment"
	}
	return Spec{
		RecipientID: a.RecipientID, RecipientType: a.RecipientType,
		Type: typ, Category: CategoryReminder, Title: title,
		Body: "You have a consultation with " + who + " on " + a.When +
			" (" + HumanizeMinutes(a.MinutesUntilStart) + ").",
		AppointmentID: a.AppointmentID,
		DeepLink:      "/appointments/" + a.AppointmentID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey(
			fmt.Sprintf("appointment_reminder_%dm", a.OffsetMinutes),
			a.AppointmentID, a.RecipientType, a.RecipientID),
	}
}

// ─── Consultations & clinical ───────────────────────────────────

type ConsultationSummaryArgs struct {
	PatientID      string
	ConsultationID string
	AppointmentID  string
	Doctor         *Person
	DoctorID       string
	Data           map[string]any
}

func ConsultationSummaryAvailable(a ConsultationSummaryArgs) Spec {
	return Spec{
		RecipientID: a.PatientID, RecipientType: RecipientPatient,
		Type: TypeConsultationSummary, Category: CategoryConsultation,
		Title:          "Consultation summary available",
		Body:           "Your consultation with " + DoctorName(a.Doctor) + " is complete. The summary is ready to view.",
		ConsultationID: a.ConsultationID, AppointmentID: a.AppointmentID,
		ActorID: a.DoctorID, ActorType: RecipientDoctor,
		DeepLink: "/consultations/" + a.ConsultationID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey("consultation_summary", a.ConsultationID, RecipientPatient, a.PatientID),
	}
}

type InvestigationsRequestedArgs struct {
	PatientID      string
	ConsultationID string
	Doctor         *Person
	DoctorID       string
	Count          int
	Data           map[string]any
}

func InvestigationsRequested(a InvestigationsRequestedArgs) Spec {
	plural := "tests"
	if a.Count == 1 {
		plural = "test"
	}
	return Spec{
		RecipientID: a.PatientID, RecipientType: RecipientPatient,
		Type: TypeInvestigationsRequested, Category: CategoryClinical,
		Title:          "Investigations requested",
		Body:           DoctorName(a.Doctor) + fmt.Sprintf(" requested %d %s. Tap to view and upload your results.", a.Count, plural),
		ConsultationID: a.ConsultationID,
		ActorID:        a.DoctorID, ActorType: RecipientDoctor,
		DeepLink: "/consultations/" + a.ConsultationID + "/investigations", Data: dataOrEmpty(a.Data),
		EventKey: EventKey(
			fmt.Sprintf("consultation_investigations_%d", a.Count),
			a.ConsultationID, RecipientPatient, a.PatientID),
	}
}

type PrescriptionReadyArgs struct {
	PatientID      string
	ConsultationID string
	Doctor         *Person
	DoctorID       string
	Count          int
	Data           map[string]any
}

func PrescriptionReady(a PrescriptionReadyArgs) Spec {
	plural := "medications"
	if a.Count == 1 {
		plural = "medication"
	}
	return Spec{
		RecipientID: a.PatientID, RecipientType: RecipientPatient,
		Type: TypePrescriptionReady, Category: CategoryClinical,
		Title:          "Prescription ready",
		Body:           DoctorName(a.Doctor) + fmt.Sprintf(" prescribed %d %s. Your prescription form is available.", a.Count, plural),
		ConsultationID: a.ConsultationID,
		ActorID:        a.DoctorID, ActorType: RecipientDoctor,
		DeepLink: "/consultations/" + a.ConsultationID + "/medications", Data: dataOrEmpty(a.Data),
		EventKey: EventKey(
			fmt.Sprintf("consultation_meds_%d", a.Count),
			a.ConsultationID, RecipientPatient, a.PatientID),
	}
}

type ReferralAvailableArgs struct {
	PatientID      string
	ConsultationID string
	ReferralID     string
	Doctor         *Person
	DoctorID       string
	Data           map[string]any
}

func ReferralAvailable(a ReferralAvailableArgs) Spec {
	return Spec{
		RecipientID: a.PatientID, RecipientType: RecipientPatient,
		Type: TypeReferralAvailable, Category: CategoryClinical,
		// No specialist name, hospital, or referral details — clinical detail.
		Title:          "Referral letter available",
		Body:           DoctorName(a.Doctor) + " issued a referral letter. Tap to view it.",
		ConsultationID: a.ConsultationID,
		ActorID:        a.DoctorID, ActorType: RecipientDoctor,
		DeepLink: "/referrals/" + a.ReferralID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey("referral", a.ReferralID, RecipientPatient, a.PatientID),
	}
}

type InvestigationResultsUploadedArgs struct {
	DoctorID            string
	PatientID           string
	Patient             *Person
	ConsultationID      string
	InvestigationListID string
	ImageCount          int
	Data                map[string]any
}

func InvestigationResultsUploaded(a InvestigationResultsUploadedArgs) Spec {
	plural := "files"
	if a.ImageCount == 1 {
		plural = "file"
	}
	return Spec{
		RecipientID: a.DoctorID, RecipientType: RecipientDoctor,
		Type: TypeInvestigationResults, Category: CategoryClinical,
		Title:          "New investigation result",
		Body:           PersonName(a.Patient, "A patient") + fmt.Sprintf(" uploaded %d result %s.", a.ImageCount, plural),
		ConsultationID: a.ConsultationID,
		ActorID:        a.PatientID, ActorType: RecipientPatient,
		DeepLink: "/investigations/" + a.InvestigationListID, Data: dataOrEmpty(a.Data),
		EventKey: EventKey(
			fmt.Sprintf("investigation_results_%d", a.ImageCount),
			a.InvestigationListID, RecipientDoctor, a.DoctorID),
	}
}

// ─── Video ──────────────────────────────────────────────────────

type VideoRoomOpenedArgs struct {
	PatientID      string
	AppointmentID  string
	ConsultationID string
	Doctor         *Person
	DoctorID       string
	Data           map[string]any
}

func VideoRoomOpened(a VideoRoomOpenedArgs) Spec {
	return Spec{
		RecipientID: a.PatientID, RecipientType: RecipientPatient,
		Type: TypeVideoRoomOpened, Category: CategoryVideo,
		Title:         "Your doctor is ready",
		Body:          DoctorName(a.Doctor) + " has joined the consultation. Tap to join now.",
		AppointmentID: a.AppointmentID, ConsultationID: a.ConsultationID,
		ActorID: a.DoctorID, ActorType: RecipientDoctor,
		DeepLink: "/appointments/" + a.AppointmentID + "/video", Data: dataOrEmpty(a.Data),
		EventKey: EventKey("video_room_opened", a.AppointmentID, RecipientPatient, a.PatientID),
	}
}
