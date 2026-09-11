package consult

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/mail"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/testdb"
)

type fixture struct {
	engine   *gin.Engine
	svc      *Service
	pool     *postgres.Pool
	issuer   *auth.Issuer
	doctorT  string
	doctor   string
	doctor2T string
	doctor2  string
	patT     string
	pat      string
}

func setup(t *testing.T) *fixture {
	t.Helper()
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{
		JWTSecret: "c-access", JWTRefreshSecret: "c-refresh",
	})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	authSvc := &auth.Service{
		DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy: mail.NewCopy(),
		FrontendURL: "http://x", IncludeOTP: true,
	}
	fx := &fixture{pool: pool, issuer: iss}
	ctx := context.Background()
	mkDoctor := func(prefix string) (tok, id string) {
		email := testdb.UniqueEmail(t, prefix)
		testdb.Track(t, pool, email)
		if _, err := authSvc.DoctorSignup(ctx, email, "Doc", "Tor", "DocPass123!", ""); err != nil {
			t.Fatalf("doctor signup: %v", err)
		}
		out, err := authSvc.Login(ctx, auth.RoleDoctor, email, "DocPass123!")
		if err != nil {
			t.Fatalf("doctor login: %v", err)
		}
		return out["token"].(string), out["doctor"].(map[string]any)["_id"].(string)
	}
	mkPatient := func(prefix string) (tok, id string) {
		email := testdb.UniqueEmail(t, prefix)
		testdb.Track(t, pool, email)
		if _, err := authSvc.PatientSignup(ctx, "Pat", "One", "", email, "StrongPass123!"); err != nil {
			t.Fatalf("patient signup: %v", err)
		}
		out, err := authSvc.Login(ctx, auth.RolePatient, email, "StrongPass123!")
		if err != nil {
			t.Fatalf("patient login: %v", err)
		}
		return out["token"].(string), out["user"].(map[string]any)["_id"].(string)
	}
	fx.doctorT, fx.doctor = mkDoctor("cdoc")
	fx.doctor2T, fx.doctor2 = mkDoctor("cdoc2")
	fx.patT, fx.pat = mkPatient("cpat")

	fx.svc = &Service{DB: pool}
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(middleware.RequestID())
	h := NewHandler(fx.svc, iss, middleware.NewDBResolver(pool))
	v1 := e.Group("/api/v1")
	h.Register(v1)
	fx.engine = e
	return fx
}

// seedAppointment inserts a CONFIRMED appointment and tracks cleanup.
func seedAppointment(t *testing.T, fx *fixture, status string) string {
	t.Helper()
	var id string
	err := fx.pool.Inner().QueryRow(context.Background(), `INSERT INTO appointments
		(appointment_number, patient_id, doctor_id, scheduled_start_at_utc, scheduled_end_at_utc,
		 timezone_snapshot, status, appointment_for, reason_for_visit)
		VALUES ('APT-C-' || left(md5(random()::text), 6), $1::uuid, $2::uuid,
		 now() + interval '1 day', now() + interval '1 day' + interval '30 min',
		 'UTC', $3, 'SELF', 'Checkup')
		RETURNING id::text`, fx.pat, fx.doctor, status).Scan(&id)
	if err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = fx.pool.Inner().Exec(ctx, "DELETE FROM consultations WHERE appointment_id = $1::uuid", id)
		_, _ = fx.pool.Inner().Exec(ctx, "DELETE FROM appointments WHERE id = $1::uuid", id)
	})
	return id
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

func dataMap(t *testing.T, env envelope) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(env.Data, &m); err != nil {
		t.Fatalf("data not object: %v", err)
	}
	return m
}

func TestStartAndResume(t *testing.T) {
	fx := setup(t)
	apptID := seedAppointment(t, fx, "CONFIRMED")

	w := doReq(fx, "POST", "/api/v1/doctors/consultations/appointments/"+apptID+"/start", fx.doctorT,
		`{"type":"VIDEO","title":"Visit 1"}`)
	env := decode(t, w)
	if w.Code != 201 {
		t.Fatalf("start: got %d %s", w.Code, w.Body.String())
	}
	m := dataMap(t, env)
	if m["status"] != "ACTIVE" {
		t.Errorf("status = %v, want ACTIVE", m["status"])
	}
	ref, _ := m["consultation_id"].(string)
	if len(ref) < 12 || ref[:6] != "VIDEO-" {
		t.Errorf("reference = %q, want VIDEO-xxxxxxxxxx", ref)
	}
	cid := m["_id"].(string)

	// Second start resumes the same workspace (no duplicate).
	w = doReq(fx, "POST", "/api/v1/doctors/consultations/appointments/"+apptID+"/start", fx.doctorT, `{}`)
	if w.Code != 201 {
		t.Fatalf("resume: got %d %s", w.Code, w.Body.String())
	}
	if dataMap(t, decode(t, w))["_id"] != cid {
		t.Error("resume created a second consultation")
	}

	// Non-confirmed appointment → 409.
	pendingID := seedAppointment(t, fx, "PENDING")
	w = doReq(fx, "POST", "/api/v1/doctors/consultations/appointments/"+pendingID+"/start", fx.doctorT, `{}`)
	env = decode(t, w)
	if w.Code != 409 || env.ResponseDescription != "Consultation can only be started from a confirmed appointment" {
		t.Errorf("pending start: got %d %+v", w.Code, env)
	}
	// Other doctor's appointment → 404; bad id → 400.
	w = doReq(fx, "POST", "/api/v1/doctors/consultations/appointments/"+apptID+"/start", fx.doctor2T, `{}`)
	if w.Code != 404 {
		t.Errorf("foreign appointment: got %d, want 404", w.Code)
	}
	w = doReq(fx, "POST", "/api/v1/doctors/consultations/appointments/not-an-id/start", fx.doctorT, `{}`)
	if w.Code != 400 {
		t.Errorf("bad id: got %d, want 400", w.Code)
	}
}

func TestComplete(t *testing.T) {
	fx := setup(t)
	apptID := seedAppointment(t, fx, "CONFIRMED")

	w := doReq(fx, "POST", "/api/v1/doctors/consultations/appointments/"+apptID+"/start", fx.doctorT, `{}`)
	cid := dataMap(t, decode(t, w))["_id"].(string)

	w = doReq(fx, "PATCH", "/api/v1/doctors/consultations/"+cid+"/complete", fx.doctorT, "")
	env := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("complete: got %d %s", w.Code, w.Body.String())
	}
	// Again → 409; appointment flipped to COMPLETED.
	w = doReq(fx, "PATCH", "/api/v1/doctors/consultations/"+cid+"/complete", fx.doctorT, "")
	env = decode(t, w)
	if w.Code != 409 || env.ResponseDescription != "Consultation is already completed" {
		t.Errorf("re-complete: got %d %+v", w.Code, env)
	}
	var status string
	_ = fx.pool.Inner().QueryRow(context.Background(),
		"SELECT status FROM appointments WHERE id = $1::uuid", apptID).Scan(&status)
	if status != "COMPLETED" {
		t.Errorf("appointment status = %q, want COMPLETED", status)
	}
	// Summary notification emitted.
	var n int
	_ = fx.pool.Inner().QueryRow(context.Background(),
		`SELECT count(*) FROM notifications WHERE consultation_id = $1::uuid
		 AND type = 'CONSULTATION_SUMMARY_AVAILABLE'`, cid).Scan(&n)
	if n != 1 {
		t.Errorf("summary notifications = %d, want 1", n)
	}
	// Completed workspace cannot restart.
	w = doReq(fx, "POST", "/api/v1/doctors/consultations/appointments/"+apptID+"/start", fx.doctorT, `{}`)
	env = decode(t, w)
	if w.Code != 409 {
		t.Errorf("restart completed: got %d %+v", w.Code, env)
	}
	// Other doctor cannot complete.
	w = doReq(fx, "PATCH", "/api/v1/doctors/consultations/"+cid+"/complete", fx.doctor2T, "")
	if w.Code != 404 {
		t.Errorf("foreign complete: got %d, want 404", w.Code)
	}
}

func TestListingsAndSingles(t *testing.T) {
	fx := setup(t)
	apptID := seedAppointment(t, fx, "CONFIRMED")
	w := doReq(fx, "POST", "/api/v1/doctors/consultations/appointments/"+apptID+"/start", fx.doctorT, `{}`)
	cid := dataMap(t, decode(t, w))["_id"].(string)

	w = doReq(fx, "GET", "/api/v1/patients/consultations?page=1&perPage=10", fx.patT, "")
	var plist struct {
		Consultation []map[string]any `json:"consultation"`
		Meta         map[string]any   `json:"meta"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &plist)
	if len(plist.Consultation) != 1 || plist.Meta["total"] != float64(1) {
		t.Errorf("patient list = %+v", plist)
	}
	if plist.Consultation[0]["doctor_id"] == nil {
		t.Error("patient list missing doctor populate")
	}
	w = doReq(fx, "GET", "/api/v1/patients/consultations/all", fx.patT, "")
	var pall struct {
		Consultation []map[string]any `json:"consultation"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &pall)
	if len(pall.Consultation) != 1 {
		t.Error("/all differs from /")
	}

	w = doReq(fx, "GET", "/api/v1/doctors/consultations", fx.doctorT, "")
	var dlist struct {
		Consultation []map[string]any `json:"consultation"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &dlist)
	if len(dlist.Consultation) != 1 {
		t.Errorf("doctor list = %d", len(dlist.Consultation))
	}
	w = doReq(fx, "GET", "/api/v1/doctors/consultations/all", fx.doctorT, "")
	var dall []map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &dall)
	if len(dall) != 1 {
		t.Error("doctor /all should be an array of 1")
	}

	// Singles + ownership.
	w = doReq(fx, "GET", "/api/v1/patients/consultations/"+cid, fx.patT, "")
	if w.Code != 200 {
		t.Fatalf("patient single: %d", w.Code)
	}
	w = doReq(fx, "GET", "/api/v1/doctors/consultations/"+cid, fx.doctor2T, "")
	env := decode(t, w)
	if w.Code != 401 || env.ResponseDescription != "Invalid User" {
		t.Errorf("foreign single: got %d %+v, want 401", w.Code, env)
	}
	w = doReq(fx, "GET", "/api/v1/doctors/consultations/00000000-0000-0000-0000-000000000000", fx.doctorT, "")
	if w.Code != 404 {
		t.Errorf("unknown single: got %d, want 404", w.Code)
	}
	// Weekly includes the fresh workspace.
	w = doReq(fx, "GET", "/api/v1/patients/consultations/consultation/weekly", fx.patT, "")
	var weekly []any
	_ = json.Unmarshal(decode(t, w).Data, &weekly)
	if len(weekly) != 1 {
		t.Errorf("weekly = %d, want 1", len(weekly))
	}
}

func TestHistoryAndPatientReads(t *testing.T) {
	fx := setup(t)
	apptID := seedAppointment(t, fx, "CONFIRMED")
	w := doReq(fx, "POST", "/api/v1/doctors/consultations/appointments/"+apptID+"/start", fx.doctorT, `{}`)
	cid := dataMap(t, decode(t, w))["_id"].(string)
	ctx := context.Background()

	_, err := fx.pool.Inner().Exec(ctx, `INSERT INTO medications
		(consultation_id, patient_id, doctor_id, formulary, medication, dose, unit, interval, duration, duration_unit, status)
		VALUES ($1::uuid, $2::uuid, $3::uuid, 'TABLET', 'Paracetamol', 500, 'MILLIGRAM', 'DAILY', 5, 'DAY', 'ACTIVE')`,
		cid, fx.pat, fx.doctor)
	if err != nil {
		t.Fatalf("seed med: %v", err)
	}
	_, err = fx.pool.Inner().Exec(ctx, `INSERT INTO investigation_lists
		(consultation_id, patient_id, doctor_id, name, assign_to_patient)
		VALUES ($1::uuid, $2::uuid, $3::uuid, 'Blood panel', true)`, cid, fx.pat, fx.doctor)
	if err != nil {
		t.Fatalf("seed list: %v", err)
	}
	_, err = fx.pool.Inner().Exec(ctx, `INSERT INTO diagnosis_forms
		(consultation_id, patient_id, doctor_id, provisional_diagnosis, status)
		VALUES ($1::uuid, $2::uuid, $3::uuid, '{Flu}', 'COMPLETED')`, cid, fx.pat, fx.doctor)
	if err != nil {
		t.Fatalf("seed form: %v", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = fx.pool.Inner().Exec(c, "DELETE FROM medications WHERE consultation_id = $1::uuid", cid)
		_, _ = fx.pool.Inner().Exec(c, "DELETE FROM investigation_lists WHERE consultation_id = $1::uuid", cid)
		_, _ = fx.pool.Inner().Exec(c, "DELETE FROM diagnosis_forms WHERE consultation_id = $1::uuid", cid)
	})

	// Doctor history aggregate carries children.
	w = doReq(fx, "GET", "/api/v1/doctors/consultations/patients/"+fx.pat+"/history", fx.doctorT, "")
	var hist []map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &hist)
	if len(hist) != 1 || hist[0]["medication_id"] == nil {
		t.Errorf("history = %s", w.Body.String()[:200])
	}
	// Focused history endpoints.
	for path, want := range map[string]int{
		"/history/consultations": 1, "/history/medications": 1, "/history/diagnoses": 1,
	} {
		w = doReq(fx, "GET", "/api/v1/doctors/consultations/patients/"+fx.pat+path, fx.doctorT, "")
		var arr []any
		_ = json.Unmarshal(decode(t, w).Data, &arr)
		if len(arr) != want {
			t.Errorf("%s = %d, want %d", path, len(arr), want)
		}
	}
	w = doReq(fx, "GET", "/api/v1/doctors/consultations/patients/"+fx.pat+"/history/investigations", fx.doctorT, "")
	var grouped map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &grouped)
	if grouped["groups"] == nil {
		t.Error("grouped investigations missing groups")
	}
	// Patient self reads.
	w = doReq(fx, "GET", "/api/v1/patients/consultations/medications/active", fx.patT, "")
	var meds []any
	_ = json.Unmarshal(decode(t, w).Data, &meds)
	if len(meds) != 1 {
		t.Errorf("active meds = %d", len(meds))
	}
	w = doReq(fx, "GET", "/api/v1/patients/consultations/medications/grouped-by-consultation", fx.patT, "")
	var mg map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &mg)
	if mg["groups"] == nil {
		t.Error("grouped meds missing groups")
	}
	w = doReq(fx, "GET", "/api/v1/patients/consultations/"+cid+"/medications/grouped", fx.patT, "")
	var fg map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &fg)
	if fg["total"] != float64(1) {
		t.Errorf("formulary groups = %+v", fg)
	}
	w = doReq(fx, "GET", "/api/v1/patients/consultations/investigations/grouped", fx.patT, "")
	if w.Code != 200 {
		t.Errorf("patient investigations grouped: %d", w.Code)
	}
	w = doReq(fx, "GET", "/api/v1/patients/consultations/"+cid+"/investigation-list", fx.patT, "")
	var il map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &il)
	if il["investigation_count"] != float64(1) {
		t.Errorf("investigation list = %+v", il)
	}
}
