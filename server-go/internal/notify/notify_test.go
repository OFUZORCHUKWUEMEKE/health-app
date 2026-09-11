package notify

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDoctorPrefixAndFallbacks(t *testing.T) {
	if got := DoctorName(&Person{FirstName: "Ada", LastName: "Lovelace"}); got != "Dr Ada Lovelace" {
		t.Errorf("doctor = %q", got)
	}
	if got := DoctorName(nil); got != "your doctor" {
		t.Errorf("nil doctor = %q", got)
	}
	if got := PersonName(&Person{FullName: " Only Full "}, "fb"); got != "Only Full" {
		t.Errorf("full_name fallback = %q", got)
	}
	if got := PersonName(nil, "A patient"); got != "A patient" {
		t.Errorf("nil person = %q", got)
	}
}

func TestFormatWhenZones(t *testing.T) {
	instant := time.Date(2026, 3, 26, 9, 0, 0, 0, time.UTC)
	lagos := FormatWhen(instant, "Africa/Lagos", "America/Edmonton")
	if !strings.Contains(lagos, "10:00") {
		t.Errorf("recipient zone ignored: %q", lagos)
	}
	fallback := FormatWhen(instant, "", "America/Edmonton")
	if !strings.Contains(fallback, "03:00") {
		t.Errorf("snapshot fallback wrong: %q", fallback)
	}
	degraded := FormatWhen(instant, "Not/AZone", "")
	if !strings.HasSuffix(degraded, "UTC") {
		t.Errorf("bad zone should degrade to UTC: %q", degraded)
	}
}

func TestEventKeyDeterminism(t *testing.T) {
	a := EventKey("appointment_booked", "appt1", RecipientPatient, "pat1")
	if a != EventKey("appointment_booked", "appt1", RecipientPatient, "pat1") {
		t.Error("event key not deterministic")
	}
	if a == EventKey("appointment_booked", "appt1", RecipientDoctor, "doc1") {
		t.Error("event key must differ per recipient")
	}
}

func TestBookingCopyPendingVsBooked(t *testing.T) {
	pending := PatientAppointmentBooked(AppointmentBookedArgs{
		PatientID: "p", AppointmentID: "a", When: "tomorrow", Pending: true,
	})
	if pending.Title != "Appointment request sent" || !strings.Contains(pending.Body, "awaiting confirmation") {
		t.Errorf("pending copy = %+v", pending)
	}
	if pending.Type != TypeAppointmentBooked {
		t.Errorf("pending type = %q", pending.Type)
	}
	booked := PatientAppointmentBooked(AppointmentBookedArgs{
		PatientID: "p", AppointmentID: "a", Doctor: &Person{FirstName: "Ada"},
		When: "tomorrow",
	})
	if !strings.Contains(booked.Body, "Dr Ada") {
		t.Errorf("booked copy = %+v", booked)
	}
	req := DoctorAppointmentRequest(DoctorAppointmentRequestArgs{
		DoctorID: "d", PatientID: "p", AppointmentID: "a", When: "tomorrow", Pending: true,
	})
	if req.Type != TypeAppointmentRequestReceived {
		t.Errorf("doctor pending type = %q", req.Type)
	}
}

func TestReminderRealTimeAndOffsetTyping(t *testing.T) {
	rem := AppointmentReminder(AppointmentReminderArgs{
		RecipientID: "p", RecipientType: RecipientPatient, AppointmentID: "a",
		When: "tomorrow", MinutesUntilStart: 47, OffsetMinutes: 60,
	})
	if rem.Type != TypeAppointmentReminder1H {
		t.Errorf("type = %q, want 1H from offset", rem.Type)
	}
	if !strings.Contains(rem.Body, "in 47 minutes") {
		t.Errorf("body should render real time: %q", rem.Body)
	}
	day := AppointmentReminder(AppointmentReminderArgs{
		RecipientID: "p", RecipientType: RecipientPatient, AppointmentID: "a",
		When: "x", MinutesUntilStart: 1400, OffsetMinutes: 1440,
	})
	if day.Type != TypeAppointmentReminder24H {
		t.Errorf("type = %q, want 24H", day.Type)
	}
	if !strings.Contains(day.EventKey, "1440m") {
		t.Errorf("key = %q, want offset in key", day.EventKey)
	}
}

func TestHumanizeMinutes(t *testing.T) {
	cases := map[int]string{
		0: "in under a minute", 1: "in under a minute", 47: "in 47 minutes",
		60: "in about an hour", 120: "in about 2 hours", 1500: "tomorrow", 3000: "in 2 days",
	}
	for in, want := range cases {
		if got := HumanizeMinutes(in); got != want {
			t.Errorf("HumanizeMinutes(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestCancellationCarriesNoReason(t *testing.T) {
	// There is deliberately no reason parameter: even a hostile caller cannot
	// smuggle free text into the stored copy.
	spec := AppointmentCancelled(AppointmentCancelledArgs{
		RecipientID: "p", RecipientType: RecipientPatient, AppointmentID: "a",
		Actor: &Person{FirstName: "Ada"}, ActorType: RecipientDoctor, When: "tomorrow",
	})
	if strings.Contains(spec.Body, "because") || strings.Contains(spec.Body, "HIV") {
		t.Errorf("cancellation body leaks: %q", spec.Body)
	}
}

// TestPHISweep enforces the PHI rule structurally: builder Args may carry
// identities (people, IDs), times, counts, and flags — never clinical free
// text. Every string-typed Args field must either be an identifier, a
// person, a time, or a deep-link part; anything else (drug/test/diagnosis/
// reason/notes/…) fails this test and forces review justification.
// Cancellation additionally has no reason parameter at all.
func TestPHISweep(t *testing.T) {
	safe := []string{
		"patientid", "doctorid", "appointmentid", "consultationid",
		"referralid", "investigationlistid", "newappointmentid", "oldappointmentid",
		"actorid", "recipientid", "recipienttype", "actortype", "when", "newwhen", "data", "pending", "count", "imagecount",
		"minutesuntilstart", "offsetminutes", "doctor", "patient", "actor",
		"counterparty",
	}
	check := func(name string, args any) {
		t.Helper()
		rt := reflect.TypeOf(args)
		for i := 0; i < rt.NumField(); i++ {
			f := rt.Field(i)
			kind := f.Type.Kind()
			if kind != reflect.String && !(kind == reflect.Ptr && f.Type.Elem().Name() == "Person") &&
				!strings.HasSuffix(f.Name, "ID") && f.Name != "Data" {
				if kind == reflect.Map || kind == reflect.Bool || kind == reflect.Int {
					continue
				}
				t.Errorf("%s.%s has unexpected type %v", name, f.Name, f.Type)
				continue
			}
			if kind == reflect.String {
				lower := strings.ToLower(f.Name)
				ok := false
				for _, s := range safe {
					if lower == s {
						ok = true
						break
					}
				}
				if !ok {
					t.Errorf("%s.%s: string field not in PHI-safe allowlist", name, f.Name)
				}
			}
		}
	}
	check("AppointmentBookedArgs", AppointmentBookedArgs{})
	check("DoctorAppointmentRequestArgs", DoctorAppointmentRequestArgs{})
	check("AppointmentConfirmedArgs", AppointmentConfirmedArgs{})
	check("AppointmentCancelledArgs", AppointmentCancelledArgs{})
	check("AppointmentRescheduledArgs", AppointmentRescheduledArgs{})
	check("DoctorAppointmentRemovedArgs", DoctorAppointmentRemovedArgs{})
	check("DoctorAppointmentAssignedArgs", DoctorAppointmentAssignedArgs{})
	check("AppointmentReminderArgs", AppointmentReminderArgs{})
	check("ConsultationSummaryArgs", ConsultationSummaryArgs{})
	check("InvestigationsRequestedArgs", InvestigationsRequestedArgs{})
	check("PrescriptionReadyArgs", PrescriptionReadyArgs{})
	check("ReferralAvailableArgs", ReferralAvailableArgs{})
	check("InvestigationResultsUploadedArgs", InvestigationResultsUploadedArgs{})
	check("VideoRoomOpenedArgs", VideoRoomOpenedArgs{})
}

func TestCountsNotNames(t *testing.T) {
	inv := InvestigationsRequested(InvestigationsRequestedArgs{
		PatientID: "p", ConsultationID: "c", Doctor: &Person{FirstName: "A"},
		DoctorID: "d", Count: 3,
	})
	if !strings.Contains(inv.Body, "3 tests") {
		t.Errorf("body = %q, want count", inv.Body)
	}
	rx := PrescriptionReady(PrescriptionReadyArgs{
		PatientID: "p", ConsultationID: "c", Doctor: &Person{FirstName: "A"},
		DoctorID: "d", Count: 1,
	})
	if !strings.Contains(rx.Body, "1 medication") {
		t.Errorf("body = %q, want singular count", rx.Body)
	}
}
