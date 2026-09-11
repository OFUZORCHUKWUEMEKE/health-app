package doctors

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/mail"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/testdb"
)

type fakeFiles struct {
	last     []byte
	userType string
	url      string
}

func (f *fakeFiles) UploadProfileImage(_ context.Context, data []byte, _ string, userType, _ string) (string, error) {
	f.last, f.userType = data, userType
	return f.url, nil
}

func (f *fakeFiles) UploadInvestigationImage(_ context.Context, data []byte, _ string, _, _ string) (string, error) {
	f.last = data
	return f.url, nil
}

type fixture struct {
	engine   *gin.Engine
	svc      *Service
	issuer   *auth.Issuer
	pool     *postgres.Pool
	doctorID string
	doctorT  string
	patientT string
	adminT   string
	files    *fakeFiles
}

func setup(t *testing.T) *fixture {
	t.Helper()
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{
		JWTSecret: "d-access", JWTRefreshSecret: "d-refresh",
	})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	authSvc := &auth.Service{
		DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy: mail.NewCopy(),
		FrontendURL: "http://x", IncludeOTP: true,
	}
	fx := &fixture{issuer: iss, pool: pool, files: &fakeFiles{url: "https://img.test/doc.jpg"}}

	docEmail := testdb.UniqueEmail(t, "doc")
	adminEmail := testdb.UniqueEmail(t, "adm")
	patEmail := testdb.UniqueEmail(t, "pat")
	testdb.Track(t, pool, docEmail, adminEmail, patEmail)

	if _, err := authSvc.DoctorSignup(context.Background(), docEmail, "Greg", "House", "DocPass123!", ""); err != nil {
		t.Fatalf("doctor signup: %v", err)
	}
	login, err := authSvc.Login(context.Background(), auth.RoleDoctor, docEmail, "DocPass123!")
	if err != nil {
		t.Fatalf("doctor login: %v", err)
	}
	fx.doctorT = login["token"].(string)
	fx.doctorID = login["doctor"].(map[string]any)["_id"].(string)

	bs, err := authSvc.BootstrapAdmin(context.Background(), auth.BootstrapInput{
		FirstName: "Root", LastName: "A", Email: adminEmail,
		Password: "AdminPass123!", BootstrapKey: "k",
	}, true, "k")
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	_ = bs
	adminOut, err := authSvc.Login(context.Background(), auth.RoleAdmin, adminEmail, "AdminPass123!")
	if err != nil {
		t.Fatalf("admin login: %v", err)
	}
	fx.adminT = adminOut["token"].(string)

	if _, err := authSvc.PatientSignup(context.Background(), "Pat", "One", "", patEmail, "StrongPass123!"); err != nil {
		t.Fatalf("patient signup: %v", err)
	}
	patOut, err := authSvc.Login(context.Background(), auth.RolePatient, patEmail, "StrongPass123!")
	if err != nil {
		t.Fatalf("patient login: %v", err)
	}
	fx.patientT = patOut["token"].(string)

	fx.svc = &Service{DB: pool, Files: fx.files}
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(middleware.RequestID())
	h := NewHandler(fx.svc, iss, middleware.NewDBResolver(pool))
	v1 := e.Group("/api/v1")
	h.Register(v1)
	fx.engine = e
	return fx
}

func doJSON(fx *fixture, method, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	fx.engine.ServeHTTP(w, req)
	return w
}

func doMultipartMethod(fx *fixture, method, path, token string, fields map[string][]string, fileContent string) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, vals := range fields {
		for _, v := range vals {
			_ = w.WriteField(k, v)
		}
	}
	if fileContent != "" {
		fw, _ := w.CreateFormFile("file", "pic.png")
		_, _ = fw.Write([]byte(fileContent))
	}
	w.Close()
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	fx.engine.ServeHTTP(rec, req)
	return rec
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
		t.Fatalf("data not an object: %v", err)
	}
	return m
}

func TestReadsAndAuthz(t *testing.T) {
	fx := setup(t)

	w := doJSON(fx, "GET", "/api/v1/doctors/me", fx.doctorT, "")
	env := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("me: got %d %s", w.Code, w.Body.String())
	}
	m := dataMap(t, env)
	for _, k := range []string{"_id", "doctor_no", "first_name", "email", "active", "specializations"} {
		if _, ok := m[k]; !ok {
			t.Errorf("summary missing %q", k)
		}
	}
	if _, ok := m["license_no"]; ok {
		t.Error("summary must exclude license_no")
	}
	if _, ok := m["mrn"]; ok {
		t.Error("summary must exclude mrn")
	}

	w = doJSON(fx, "GET", "/api/v1/doctors/me/profile", fx.doctorT, "")
	if _, ok := dataMap(t, decode(t, w))["license_no"]; !ok {
		t.Error("full profile must include license_no")
	}

	w = doJSON(fx, "GET", "/api/v1/doctors/me/metrics", fx.doctorT, "")
	for _, k := range []string{"consultations", "medications", "investigations", "appointments"} {
		if dataMap(t, decode(t, w))[k] != float64(0) {
			t.Errorf("fresh metrics %q not 0", k)
		}
	}

	// Patient token on doctor route, and missing token.
	w = doJSON(fx, "GET", "/api/v1/doctors/me", fx.patientT, "")
	if w.Code != 401 {
		t.Errorf("patient token: got %d, want 401", w.Code)
	}
	w = doJSON(fx, "GET", "/api/v1/doctors/me", "", "")
	if w.Code != 401 {
		t.Errorf("no token: got %d, want 401", w.Code)
	}
}

func TestInactiveDoctorBlocked(t *testing.T) {
	fx := setup(t)
	w := doJSON(fx, "PATCH", "/api/v1/doctors/"+fx.doctorID+"/deactivate", fx.adminT, "")
	if w.Code != 200 {
		t.Fatalf("deactivate: got %d %s", w.Code, w.Body.String())
	}
	if dataMap(t, decode(t, w))["active"] != false {
		t.Error("doctor not deactivated")
	}
	// Old token now rejected by middleware.
	w = doJSON(fx, "GET", "/api/v1/doctors/me", fx.doctorT, "")
	env := decode(t, w)
	if w.Code != 401 || env.ResponseDescription != "Doctor account is deactivated" {
		t.Errorf("inactive: got %d %+v", w.Code, env)
	}
	// Reactivate restores access shape (new login needed for a fresh hash).
	w = doJSON(fx, "PATCH", "/api/v1/doctors/"+fx.doctorID+"/activate", fx.adminT, "")
	if dataMap(t, decode(t, w))["active"] != true {
		t.Error("doctor not reactivated")
	}
	// Doctors cannot touch activation; unknown id 404s.
	w = doJSON(fx, "PATCH", "/api/v1/doctors/"+fx.doctorID+"/activate", fx.doctorT, "")
	if w.Code != 401 {
		t.Errorf("doctor self-activate: got %d, want 401", w.Code)
	}
	w = doJSON(fx, "PATCH", "/api/v1/doctors/00000000-0000-0000-0000-000000000000/activate", fx.adminT, "")
	env = decode(t, w)
	if w.Code != 404 || !strings.Contains(env.ResponseDescription, "not found") {
		t.Errorf("unknown id: got %d %+v", w.Code, env)
	}
}

func TestProfilePatch(t *testing.T) {
	fx := setup(t)

	w := doJSON(fx, "PATCH", "/api/v1/doctors/me", fx.doctorT,
		`{"phone_number":"+15550001111","specializations":["Cardiology","Neurology"],"license_no":"LIC-9"}`)
	if w.Code != 200 {
		t.Fatalf("patch: got %d %s", w.Code, w.Body.String())
	}
	m := dataMap(t, decode(t, w))
	if fmt.Sprint(m["specializations"]) != "[Cardiology Neurology]" || m["license_no"] != "LIC-9" {
		t.Errorf("patched = %+v", m)
	}
	// Alias route behaves identically.
	w = doJSON(fx, "PATCH", "/api/v1/doctors/me/profile", fx.doctorT, `{"occupation":"x"}`)
	if w.Code != 400 {
		t.Errorf("unknown key via alias: got %d, want 400", w.Code)
	}
	// Timezone bad + good.
	w = doJSON(fx, "PATCH", "/api/v1/doctors/me/timezone", fx.doctorT, `{"timezone":"Nope"}`)
	if w.Code != 400 {
		t.Errorf("bad zone: got %d, want 400", w.Code)
	}
	w = doJSON(fx, "PATCH", "/api/v1/doctors/me/timezone", fx.doctorT, `{"timezone":"America/Edmonton"}`)
	if dataMap(t, decode(t, w))["timezone"] != "America/Edmonton" {
		t.Error("timezone not updated")
	}
	// Multipart with file uses the doctors folder.
	w = doMultipartMethod(fx, "PATCH", "/api/v1/doctors/me", fx.doctorT,
		map[string][]string{"phone_number": {"+15550002222"}}, "bytes!")
	if w.Code != 200 {
		t.Fatalf("multipart: got %d %s", w.Code, w.Body.String())
	}
	if fx.files.userType != "doctors" || string(fx.files.last) != "bytes!" {
		t.Errorf("upload went to %q with %q", fx.files.userType, fx.files.last)
	}
}

func TestPatientList(t *testing.T) {
	fx := setup(t)

	w := doJSON(fx, "GET", "/api/v1/doctors/patients", fx.doctorT, "")
	env := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("list: got %d %s", w.Code, w.Body.String())
	}
	var data struct {
		Patients   []map[string]any `json:"patients"`
		Pagination map[string]any   `json:"pagination"`
	}
	if err := json.Unmarshal(env.Data, &data); err != nil {
		t.Fatalf("data shape: %v", err)
	}
	if len(data.Patients) == 0 {
		t.Fatal("expected at least one patient")
	}
	row := data.Patients[0]
	for _, k := range []string{"_id", "registration_no", "email", "consultation_id", "has_consultation_with_doctor"} {
		if _, ok := row[k]; !ok {
			t.Errorf("row missing %q", k)
		}
	}
	if row["has_consultation_with_doctor"] != false {
		t.Errorf("fresh doctor should have no consultations: %+v", row)
	}
	if data.Pagination["total"] == float64(0) || data.Pagination["total_pages"] == nil {
		t.Errorf("pagination = %+v", data.Pagination)
	}

	// Search narrows; unknown token rejected.
	w = doJSON(fx, "GET", "/api/v1/doctors/patients?q=pat-", fx.doctorT, "")
	var sdata struct {
		Patients []map[string]any `json:"patients"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &sdata)
	if len(sdata.Patients) == 0 {
		t.Error("search should match seeded patients")
	}
	none := doJSON(fx, "GET", "/api/v1/doctors/patients?q=zzz-no-such-patient", fx.doctorT, "")
	var ndata struct {
		Patients []map[string]any `json:"patients"`
	}
	_ = json.Unmarshal(decode(t, none).Data, &ndata)
	if len(ndata.Patients) != 0 {
		t.Errorf("search should be empty, got %d", len(ndata.Patients))
	}
}
