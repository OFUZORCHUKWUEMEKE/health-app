package admin

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
	engine  *gin.Engine
	pool    *postgres.Pool
	adminT  string
	doctorT string
}

func setup(t *testing.T) *fixture {
	t.Helper()
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{
		JWTSecret: "a-access", JWTRefreshSecret: "a-refresh",
	})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	authSvc := &auth.Service{
		DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy: mail.NewCopy(),
		FrontendURL: "http://x", IncludeOTP: true,
	}
	fx := &fixture{pool: pool}
	ctx := context.Background()

	adminEmail := testdb.UniqueEmail(t, "adm")
	patEmail := testdb.UniqueEmail(t, "pat")
	docEmail := testdb.UniqueEmail(t, "doc")
	testdb.Track(t, pool, adminEmail, patEmail, docEmail)

	if _, err := authSvc.BootstrapAdmin(ctx, auth.BootstrapInput{
		FirstName: "Root", LastName: "A", Email: adminEmail,
		Password: "AdminPass123!", BootstrapKey: "k",
	}, true, "k"); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	adminOut, err := authSvc.Login(ctx, auth.RoleAdmin, adminEmail, "AdminPass123!")
	if err != nil {
		t.Fatalf("admin login: %v", err)
	}
	fx.adminT = adminOut["token"].(string)

	if _, err := authSvc.PatientSignup(ctx, "Pat", "One", "", patEmail, "StrongPass123!"); err != nil {
		t.Fatalf("patient signup: %v", err)
	}
	if _, err := authSvc.DoctorSignup(ctx, docEmail, "Doc", "Tor", "DocPass123!", ""); err != nil {
		t.Fatalf("doctor signup: %v", err)
	}
	docOut, err := authSvc.Login(ctx, auth.RoleDoctor, docEmail, "DocPass123!")
	if err != nil {
		t.Fatalf("doctor login: %v", err)
	}
	fx.doctorT = docOut["token"].(string)

	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(middleware.RequestID())
	h := NewHandler(&Service{DB: pool}, iss, middleware.NewDBResolver(pool))
	v1 := e.Group("/api/v1")
	h.Register(v1)
	fx.engine = e
	return fx
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

func TestAdminAuthz(t *testing.T) {
	fx := setup(t)
	// Doctor token on admin route + missing token both 401.
	w := doReq(fx, "GET", "/api/v1/admin/patients", fx.doctorT, "")
	if w.Code != 401 {
		t.Errorf("doctor token: got %d, want 401", w.Code)
	}
	w = doReq(fx, "GET", "/api/v1/admin/metrics", "", "")
	if w.Code != 401 {
		t.Errorf("no token: got %d, want 401", w.Code)
	}
}

func TestCreateDoctor(t *testing.T) {
	fx := setup(t)
	email := testdb.UniqueEmail(t, "newdoc")
	testdb.Track(t, fx.pool, email)

	w := doReq(fx, "POST", "/api/v1/admin/doctors", fx.adminT,
		`{"email":"`+email+`","first_name":"New","last_name":"Doc","password":"DocPass123!"}`)
	env := decode(t, w)
	if w.Code != 201 || env.ResponseDescription != "Doctor created successfully" {
		t.Fatalf("create: got %d %+v", w.Code, env)
	}
	var data map[string]any
	_ = json.Unmarshal(env.Data, &data)
	if data["doctor_no"] == nil {
		t.Errorf("doctor missing doctor_no: %+v", data)
	}
	// Duplicate → 409 with Nest message.
	w = doReq(fx, "POST", "/api/v1/admin/doctors", fx.adminT,
		`{"email":"`+email+`","first_name":"New","last_name":"Doc","password":"DocPass123!"}`)
	env = decode(t, w)
	if w.Code != 409 || env.ResponseDescription != "Doctor already exists" {
		t.Errorf("duplicate: got %d %+v, want 409", w.Code, env)
	}
	// Validation: bad email 400.
	w = doReq(fx, "POST", "/api/v1/admin/doctors", fx.adminT,
		`{"email":"nope","first_name":"N","last_name":"D","password":"x"}`)
	if w.Code != 400 {
		t.Errorf("bad email: got %d, want 400", w.Code)
	}
}

func TestPatientListing(t *testing.T) {
	fx := setup(t)

	w := doReq(fx, "GET", "/api/v1/admin/patients?page=1&perPage=10", fx.adminT, "")
	env := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("list: got %d %s", w.Code, w.Body.String())
	}
	var data struct {
		Patients   []map[string]any `json:"patients"`
		Pagination map[string]any   `json:"pagination"`
		Meta       map[string]any   `json:"meta"`
	}
	if err := json.Unmarshal(env.Data, &data); err != nil {
		t.Fatalf("data shape: %v", err)
	}
	if len(data.Patients) == 0 {
		t.Fatal("expected patients")
	}
	if data.Pagination["limit"] != float64(10) {
		t.Errorf("perPage alias ignored: %+v", data.Pagination)
	}
	if data.Meta["lastPage"] == nil || data.Meta["perPage"] == nil {
		t.Errorf("meta shape missing: %+v", data.Meta)
	}
	// Frontend fallback chain resolves a page count.
	pages := data.Meta["lastPage"]
	if pages == float64(0) {
		t.Error("lastPage should be >= 1")
	}

	// q filters server-side (Go improvement over Nest).
	w = doReq(fx, "GET", "/api/v1/admin/patients?q=zzz-no-such-patient", fx.adminT, "")
	var empty struct {
		Patients []map[string]any `json:"patients"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &empty)
	if len(empty.Patients) != 0 {
		t.Errorf("filtered list should be empty, got %d", len(empty.Patients))
	}

	// Detail + 404.
	pid := data.Patients[0]["_id"].(string)
	w = doReq(fx, "GET", "/api/v1/admin/patients/"+pid, fx.adminT, "")
	if w.Code != 200 {
		t.Fatalf("detail: got %d", w.Code)
	}
	w = doReq(fx, "GET", "/api/v1/admin/patients/00000000-0000-0000-0000-000000000000", fx.adminT, "")
	env = decode(t, w)
	if w.Code != 404 || env.ResponseDescription != "Patient not found" {
		t.Errorf("unknown patient: got %d %+v", w.Code, env)
	}
}

func TestDoctorListingAndMetrics(t *testing.T) {
	fx := setup(t)
	seedMetricsRow(t, fx)

	w := doReq(fx, "GET", "/api/v1/admin/doctors?page=1&limit=20", fx.adminT, "")
	env := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("doctors: got %d %s", w.Code, w.Body.String())
	}
	var data struct {
		Doctors    []map[string]any `json:"doctors"`
		Pagination map[string]any   `json:"pagination"`
	}
	if err := json.Unmarshal(env.Data, &data); err != nil {
		t.Fatalf("data shape: %v", err)
	}
	if len(data.Doctors) == 0 || data.Pagination["total"] == float64(0) {
		t.Errorf("doctors = %+v", data)
	}

	w = doReq(fx, "GET", "/api/v1/admin/metrics", fx.adminT, "")
	env = decode(t, w)
	if w.Code != 200 {
		t.Fatalf("metrics: got %d %s", w.Code, w.Body.String())
	}
	var metrics map[string]map[string]any
	if err := json.Unmarshal(env.Data, &metrics); err != nil {
		t.Fatalf("metrics shape: %v", err)
	}
	for _, k := range []string{"consultations", "medications", "investigations", "appointments"} {
		m, ok := metrics[k]
		if !ok {
			t.Errorf("metrics missing %q", k)
			continue
		}
		for _, f := range []string{"total", "current", "previous", "change_percent", "trend"} {
			if _, ok := m[f]; !ok {
				t.Errorf("metrics.%s missing %q", k, f)
			}
		}
		if m["total"] == float64(0) {
			t.Errorf("metrics.%s.total = 0, want > 0 with seeded rows", k)
		}
	}
}

func seedMetricsRow(t *testing.T, fx *fixture) {
	t.Helper()
	ctx := context.Background()
	var pid string
	if err := fx.pool.Inner().QueryRow(ctx, `SELECT id::text FROM patients LIMIT 1`).Scan(&pid); err != nil {
		t.Fatalf("patient id: %v", err)
	}
	var apptID string
	if err := fx.pool.Inner().QueryRow(ctx, `INSERT INTO appointments
		(appointment_number, patient_id, scheduled_start_at_utc, scheduled_end_at_utc, timezone_snapshot, status)
		VALUES ('APT-ADM-' || left(md5(random()::text), 6), $1::uuid, now(), now() + interval '30 min', 'UTC', 'CONFIRMED')
		RETURNING id::text`, pid).Scan(&apptID); err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	var consID string
	if err := fx.pool.Inner().QueryRow(ctx, `INSERT INTO consultations
		(appointment_id, reference, type, patient_id, consoltation_for, title, status)
		VALUES ($1::uuid, 'CONS-ADM-' || left(md5(random()::text), 6), 'VIDEO', $2::uuid, 'SELF', 'Visit', 'ACTIVE')
		RETURNING id::text`, apptID, pid).Scan(&consID); err != nil {
		t.Fatalf("seed consultation: %v", err)
	}
	// Metrics counts medications/investigations globally: seed one of each
	// so the test is self-sufficient on a fresh database (previously it
	// relied on rows leaked by other packages' tests).
	if _, err := fx.pool.Inner().Exec(ctx, `INSERT INTO medications
		(consultation_id, patient_id, formulary, medication, dose, unit, interval, duration, duration_unit)
		VALUES ($1::uuid, $2::uuid, 'TABLET', 'Paracetamol', 500, 'MILLIGRAM', 'DAILY', 7, 'DAY')`, consID, pid); err != nil {
		t.Fatalf("seed medication: %v", err)
	}
	if _, err := fx.pool.Inner().Exec(ctx, `INSERT INTO investigation_lists
		(consultation_id, patient_id, name, test_requested)
		VALUES ($1::uuid, $2::uuid, 'CBC', 'Complete blood count')`, consID, pid); err != nil {
		t.Fatalf("seed investigation: %v", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// FK order: consultation first (medications/investigations
		// cascade), then the appointment.
		_, _ = fx.pool.Inner().Exec(c, "DELETE FROM consultations WHERE id = $1::uuid", consID)
		_, _ = fx.pool.Inner().Exec(c, "DELETE FROM appointments WHERE id = $1::uuid", apptID)
	})
}
