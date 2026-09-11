package booking

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/mail"
	"github.com/wizzyszn/Telemex/internal/patients"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/testdb"
)

type fixture struct {
	engine  *gin.Engine
	svc     *Service
	pool    *postgres.Pool
	issuer  *auth.Issuer
	doctorT string
	doctor  string
	patT    string
	pat     string
	pat2T   string
	pat2    string
	adminT  string
}

func setup(t *testing.T) *fixture {
	t.Helper()
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{
		JWTSecret: "b-access", JWTRefreshSecret: "b-refresh",
	})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	authSvc := &auth.Service{
		DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy:        mail.NewCopy(),
		FrontendURL: "http://x", IncludeOTP: true,
	}
	fx := &fixture{pool: pool, issuer: iss}
	ctx := context.Background()

	mkUser := func(prefix, role string) (token, id string) {
		email := testdb.UniqueEmail(t, prefix)
		testdb.Track(t, pool, email)
		var out map[string]any
		switch role {
		case auth.RoleDoctor:
			if _, err := authSvc.DoctorSignup(ctx, email, "Doc", "Tor", "DocPass123!", ""); err != nil {
				t.Fatalf("doctor signup: %v", err)
			}
			out, err = authSvc.Login(ctx, auth.RoleDoctor, email, "DocPass123!")
			id = out["doctor"].(map[string]any)["_id"].(string)
		case auth.RolePatient:
			if _, err := authSvc.PatientSignup(ctx, "Pat", "One", "", email, "StrongPass123!"); err != nil {
				t.Fatalf("patient signup: %v", err)
			}
			out, err = authSvc.Login(ctx, auth.RolePatient, email, "StrongPass123!")
			id = out["user"].(map[string]any)["_id"].(string)
		case auth.RoleAdmin:
			if _, err := authSvc.BootstrapAdmin(ctx, auth.BootstrapInput{
				FirstName: "R", LastName: "A", Email: email,
				Password: "AdminPass123!", BootstrapKey: "k",
			}, true, "k"); err != nil {
				t.Fatalf("bootstrap: %v", err)
			}
			out, err = authSvc.Login(ctx, auth.RoleAdmin, email, "AdminPass123!")
			id = out["admin"].(map[string]any)["_id"].(string)
		}
		if err != nil {
			t.Fatalf("login %s: %v", email, err)
		}
		return out["token"].(string), id
	}
	fx.doctorT, fx.doctor = mkUser("bdoc", auth.RoleDoctor)
	fx.patT, fx.pat = mkUser("bpat", auth.RolePatient)
	fx.pat2T, fx.pat2 = mkUser("bpat2", auth.RolePatient)
	fx.adminT, _ = mkUser("badm", auth.RoleAdmin)

	fx.svc = &Service{DB: pool, BookingMode: "auto"}
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(middleware.RequestID())
	h := NewHandler(fx.svc, iss, middleware.NewDBResolver(pool))
	v1 := e.Group("/api/v1")
	h.Register(v1)
	ph := patients.NewHandler(&patients.Service{DB: pool, Files: files.Disabled{}},
		iss, middleware.NewDBResolver(pool))
	ph.Register(v1)
	fx.engine = e
	return fx
}

// wideOpen sets 7-day 00:00-23:30 30-min availability in UTC.
func wideOpen(t *testing.T, fx *fixture) {
	t.Helper()
	slots := make([]WeeklySlot, 0, 7)
	for d := 0; d < 7; d++ {
		slots = append(slots, WeeklySlot{DayOfWeek: d, StartTime: "00:00", EndTime: "23:30", Duration: 30, Active: true})
	}
	if _, err := fx.svc.UpsertAvailability(context.Background(), fx.doctor, "UTC", slots, nil, nil); err != nil {
		t.Fatalf("availability: %v", err)
	}
}

func doReq(fx *fixture, method, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	fx.engine.ServeHTTP(w, req)
	return w
}

type envelope struct {
	Success             bool            `json:"success"`
	ResponseCode        string          `json:"response_code"`
	ResponseDescription string          `json:"response_description"`
	Data                json.RawMessage `json:"data"`
}

func decode(t *testing.T, w *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("not an envelope: %v (%s)", err, w.Body.String())
	}
	return env
}

// tomorrowAt returns tomorrow's date + HH:mm wall time.
func tomorrowAt(hhmm string) string {
	tomorrow := time.Now().Add(30 * time.Hour).Format("2006-01-02")
	return tomorrow + "T" + hhmm
}

func bookBody(fx *fixture, local string) string {
	return fmt.Sprintf(`{"first_name":"Pat","last_name":"One","present_complaint":"Headache",
		"doctor_id":%q,"scheduled_start_local":%q,"timezone":"UTC",
		"requested_duration_minutes":30,"confirm_appointment":true}`, fx.doctor, local)
}

func TestAvailabilityValidation(t *testing.T) {
	fx := setup(t)
	ctx := context.Background()

	bad := []WeeklySlot{{DayOfWeek: 1, StartTime: "09:00", EndTime: "09:45", Duration: 30, Active: true}}
	if _, err := fx.svc.UpsertAvailability(ctx, fx.doctor, "UTC", bad, nil, nil); err == nil {
		t.Error("non-dividing range accepted")
	}
	overlap := []WeeklySlot{
		{DayOfWeek: 1, StartTime: "09:00", EndTime: "10:00", Duration: 30, Active: true},
		{DayOfWeek: 1, StartTime: "09:30", EndTime: "10:30", Duration: 30, Active: true},
	}
	if _, err := fx.svc.UpsertAvailability(ctx, fx.doctor, "UTC", overlap, nil, nil); err == nil {
		t.Error("overlapping slots accepted")
	}
	if _, err := fx.svc.UpsertAvailability(ctx, fx.doctor, "Mars/Olympus", overlap[:1], nil, nil); err == nil {
		t.Error("bad zone accepted")
	}
	from := time.Now()
	to := from.Add(-time.Hour)
	if _, err := fx.svc.UpsertAvailability(ctx, fx.doctor, "UTC", overlap[:1], &from, &to); err == nil {
		t.Error("inverted window accepted")
	}
	wideOpen(t, fx)
	w := doReq(fx, "GET", "/api/v1/booking/doctors/me/availability", fx.doctorT, "")
	if w.Code != 200 {
		t.Fatalf("get availability: %d %s", w.Code, w.Body.String())
	}
}

func TestBlackoutLifecycle(t *testing.T) {
	fx := setup(t)
	wideOpen(t, fx)
	ctx := context.Background()
	tomorrow := time.Now().Add(30 * time.Hour).Format("2006-01-02")

	body := fmt.Sprintf(`{"blackouts":[{"start_local":%q,"end_local":%q,"timezone":"UTC","reason":"Conf","reccuring":false}]}`,
		tomorrow+"T10:00", tomorrow+"T11:00")
	w := doReq(fx, "POST", "/api/v1/booking/doctors/me/blackouts", fx.doctorT, body)
	if w.Code != 201 {
		t.Fatalf("create blackout: %d %s", w.Code, w.Body.String())
	}
	// Overlapping one-time blackout → 409.
	w = doReq(fx, "POST", "/api/v1/booking/doctors/me/blackouts", fx.doctorT, body)
	if w.Code != 409 {
		t.Errorf("overlap: got %d, want 409", w.Code)
	}
	// Recurring blackout on the same weekday.
	wd := tomorrowWeekday(tomorrow)
	_ = wd
	rb := fmt.Sprintf(`{"blackouts":[{"start_local":%q,"end_local":%q,"timezone":"UTC","reason":"Lunch","reccuring":true}]}`,
		tomorrow+"T12:00", tomorrow+"T13:00")
	w = doReq(fx, "POST", "/api/v1/booking/doctors/me/blackouts", fx.doctorT, rb)
	if w.Code != 201 {
		t.Fatalf("recurring: %d %s", w.Code, w.Body.String())
	}
	// Booking inside the blackout is rejected.
	appt := fmt.Sprintf(`{"first_name":"Pat","last_name":"One","present_complaint":"X",
		"doctor_id":%q,"scheduled_start_local":%q,"timezone":"UTC",
		"requested_duration_minutes":30,"confirm_appointment":true}`, fx.doctor, tomorrow+"T10:00")
	w = doReq(fx, "POST", "/api/v1/booking/patients/appointments", fx.patT, appt)
	if w.Code != 409 {
		t.Errorf("booking in blackout: got %d %s, want 409", w.Code, w.Body.String())
	}
	// List + delete.
	w = doReq(fx, "GET", "/api/v1/booking/doctors/me/blackouts", fx.doctorT, "")
	var listed []map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &listed)
	if len(listed) != 2 {
		t.Fatalf("blackouts = %d, want 2", len(listed))
	}
	id := listed[0]["_id"].(string)
	w = doReq(fx, "DELETE", "/api/v1/booking/doctors/me/blackouts/"+id, fx.doctorT, "")
	if w.Code != 200 {
		t.Errorf("delete: got %d", w.Code)
	}
	w = doReq(fx, "DELETE", "/api/v1/booking/doctors/me/blackouts/00000000-0000-0000-0000-000000000000", fx.doctorT, "")
	if w.Code != 404 {
		t.Errorf("unknown blackout: got %d, want 404", w.Code)
	}
	_ = ctx
}

func tomorrowWeekday(dateStr string) int {
	d, _ := time.Parse("2006-01-02", dateStr)
	return int(d.Weekday())
}

func TestBookAndDoubleBook(t *testing.T) {
	fx := setup(t)
	wideOpen(t, fx)
	local := tomorrowAt("10:00")

	w := doReq(fx, "POST", "/api/v1/booking/patients/appointments", fx.patT, bookBody(fx, local))
	env := decode(t, w)
	if w.Code != 201 {
		t.Fatalf("book: got %d %s", w.Code, w.Body.String())
	}
	var created map[string]any
	_ = json.Unmarshal(env.Data, &created)
	if created["status"] != "PENDING" {
		t.Errorf("manual-mode default should be PENDING (BOOKING_MODE=auto but doctor_id given → manual path? got %v)", created["status"])
	}
	// Same slot, other patient → 409.
	w = doReq(fx, "POST", "/api/v1/booking/patients/appointments", fx.pat2T, bookBody(fx, local))
	if w.Code != 409 {
		t.Errorf("double-book: got %d %s, want 409", w.Code, w.Body.String())
	}
	// Same patient, different slot with same doctor → patient overlap only if overlapping; use adjacent slot (fine).
	other := tomorrowAt("11:00")
	w = doReq(fx, "POST", "/api/v1/booking/patients/appointments", fx.patT, bookBody(fx, other))
	if w.Code != 201 {
		t.Errorf("adjacent slot: got %d %s", w.Code, w.Body.String())
	}
	// Past slot → 400.
	w = doReq(fx, "POST", "/api/v1/booking/patients/appointments", fx.patT, bookBody(fx, "2020-01-01T10:00"))
	if w.Code != 400 {
		t.Errorf("past: got %d, want 400", w.Code)
	}
	// Unconfirmed → 400.
	w = doReq(fx, "POST", "/api/v1/booking/patients/appointments", fx.patT,
		`{"first_name":"P","last_name":"O","present_complaint":"X","scheduled_start_local":"2030-01-01T10:00","timezone":"UTC","requested_duration_minutes":30}`)
	if w.Code != 400 {
		t.Errorf("unconfirmed: got %d, want 400", w.Code)
	}
}

func TestConcurrentDoubleBook(t *testing.T) {
	fx := setup(t)
	wideOpen(t, fx)
	local := tomorrowAt("14:00")

	const racers = 8
	var wg sync.WaitGroup
	results := make([]int, racers)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			tok := fx.patT
			if i%2 == 1 {
				tok = fx.pat2T
			}
			w := doReq(fx, "POST", "/api/v1/booking/patients/appointments", tok, bookBody(fx, local))
			results[i] = w.Code
		}(i)
	}
	wg.Wait()
	wins, conflicts := 0, 0
	for _, code := range results {
		switch code {
		case 201:
			wins++
		case 409:
			conflicts++
		default:
			t.Errorf("unexpected code %d", code)
		}
	}
	if wins != 1 || conflicts != racers-1 {
		t.Errorf("wins=%d conflicts=%d, want exactly 1 winner", wins, conflicts)
	}
}

func TestMedicalReconcile(t *testing.T) {
	fx := setup(t)
	wideOpen(t, fx)
	local := tomorrowAt("15:00")

	body := fmt.Sprintf(`{"first_name":"Pat","last_name":"One","present_complaint":"X",
		"doctor_id":%q,"scheduled_start_local":%q,"timezone":"UTC",
		"requested_duration_minutes":30,"confirm_appointment":true,
		"allergies":["Peanuts"],"Medical_conditions":["Hypertension"]}`, fx.doctor, local)
	w := doReq(fx, "POST", "/api/v1/booking/patients/appointments", fx.patT, body)
	if w.Code != 201 {
		t.Fatalf("book: %d %s", w.Code, w.Body.String())
	}
	// Profile gained the union.
	prof := doReq(fx, "GET", "/api/v1/patients/me/profile", fx.patT, "")
	var m map[string]any
	_ = json.Unmarshal(decode(t, prof).Data, &m)
	if fmt.Sprint(m["allergies"]) != "[Peanuts]" {
		t.Errorf("allergies = %v", m["allergies"])
	}
	// Second booking with overlapping+new values merges, keeps casing.
	local2 := tomorrowAt("16:00")
	body2 := fmt.Sprintf(`{"first_name":"Pat","last_name":"One","present_complaint":"X",
		"doctor_id":%q,"scheduled_start_local":%q,"timezone":"UTC",
		"requested_duration_minutes":30,"confirm_appointment":true,
		"allergies":["peanuts","Latex"],"Medical_conditions":[]}`, fx.doctor, local2)
	w = doReq(fx, "POST", "/api/v1/booking/patients/appointments", fx.patT, body2)
	if w.Code != 201 {
		t.Fatalf("book2: %d %s", w.Code, w.Body.String())
	}
	prof = doReq(fx, "GET", "/api/v1/patients/me/profile", fx.patT, "")
	_ = json.Unmarshal(decode(t, prof).Data, &m)
	if fmt.Sprint(m["allergies"]) != "[Peanuts Latex]" {
		t.Errorf("merged allergies = %v, want union with stored casing", m["allergies"])
	}
	// OTHERS booking does not mutate the booker.
	local3 := tomorrowAt("17:00")
	body3 := fmt.Sprintf(`{"first_name":"Other","last_name":"Kid","present_complaint":"X",
		"appointment_for":"OTHERS","doctor_id":%q,"scheduled_start_local":%q,"timezone":"UTC",
		"requested_duration_minutes":30,"confirm_appointment":true,
		"allergies":["Shellfish"]}`, fx.doctor, local3)
	w = doReq(fx, "POST", "/api/v1/booking/patients/appointments", fx.pat2T, body3)
	if w.Code != 201 {
		t.Fatalf("others book: %d %s", w.Code, w.Body.String())
	}
	prof = doReq(fx, "GET", "/api/v1/patients/me/profile", fx.pat2T, "")
	_ = json.Unmarshal(decode(t, prof).Data, &m)
	if fmt.Sprint(m["allergies"]) != "[]" {
		t.Errorf("OTHERS mutated booker allergies: %v", m["allergies"])
	}
	var created map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &created)
	if fmt.Sprint(created["allergies"]) != "[Shellfish]" {
		t.Errorf("snapshot should carry intake: %v", created["allergies"])
	}
}
