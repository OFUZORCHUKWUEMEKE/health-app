package patients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/mail"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/testdb"
)

type fakeFiles struct {
	last []byte
	url  string
}

func (f *fakeFiles) UploadProfileImage(_ context.Context, data []byte, _ string, _, _ string) (string, error) {
	f.last = data
	return f.url, nil
}

func (f *fakeFiles) UploadInvestigationImage(_ context.Context, data []byte, _ string, _, _ string) (string, error) {
	f.last = data
	return f.url, nil
}

type fixture struct {
	engine *gin.Engine
	svc    *Service
	issuer *auth.Issuer
	pool   *postgres.Pool
	tokens map[string]string // role -> bearer token
	ids    map[string]string // role -> user id
	files  *fakeFiles
}

func setup(t *testing.T) *fixture {
	t.Helper()
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{
		JWTSecret: "p-access", JWTRefreshSecret: "p-refresh",
	})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	authSvc := &auth.Service{
		DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy: mail.NewCopy(),
		FrontendURL: "http://x", IncludeOTP: true,
	}
	fx := &fixture{
		issuer: iss, pool: pool,
		tokens: map[string]string{}, ids: map[string]string{},
		files: &fakeFiles{url: "https://img.test/pic.jpg"},
	}
	mkPatient := func(local, password string) {
		email := testdb.UniqueEmail(t, local)
		testdb.Track(t, pool, email)
		if _, err := authSvc.PatientSignup(context.Background(), "Test", "User", "", email, password); err != nil {
			t.Fatalf("signup %s: %v", email, err)
		}
		out, err := authSvc.Login(context.Background(), auth.RolePatient, email, password)
		if err != nil {
			t.Fatalf("login %s: %v", email, err)
		}
		fx.tokens[local] = out["token"].(string)
		user := out["user"].(map[string]any)
		fx.ids[local] = user["_id"].(string)
	}
	mkPatient("pat", "StrongPass123!")
	mkPatient("pat2", "StrongPass123!")

	// Doctor via direct insert (login not needed, only the token).
	docEmail := testdb.UniqueEmail(t, "doc")
	testdb.Track(t, pool, docEmail)
	hash, _ := auth.HashPassword("DocPass123!")
	var docID string
	err = pool.Inner().QueryRow(context.Background(),
		`INSERT INTO doctors (doctor_no, first_name, last_name, email, password_hash, active)
		 VALUES ('DOC-T9','Doc','Tor',$1,$2,true) RETURNING id::text`, docEmail, hash).Scan(&docID)
	if err != nil {
		t.Fatalf("seed doctor: %v", err)
	}
	docTok, err := iss.GenerateAccess(docID, docEmail, auth.RoleDoctor)
	if err != nil {
		t.Fatalf("mint doctor token: %v", err)
	}
	fx.tokens["doc"] = docTok
	fx.ids["doc"] = docID

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
	var r *strings.Reader
	if body == "" {
		r = strings.NewReader("")
	} else {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, r)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	fx.engine.ServeHTTP(w, req)
	return w
}

func doMultipart(fx *fixture, path, token string, fields map[string][]string, files map[string]string) *httptest.ResponseRecorder {
	return doMultipartMethod(fx, http.MethodPatch, path, token, fields, files)
}

func doMultipartMethod(fx *fixture, method, path, token string, fields map[string][]string, files map[string]string) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, vals := range fields {
		for _, v := range vals {
			_ = w.WriteField(k, v)
		}
	}
	for k, content := range files {
		fw, _ := w.CreateFormFile(k, "pic.png")
		_, _ = fw.Write([]byte(content))
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
	tok := fx.tokens["pat"]

	w := doJSON(fx, "GET", "/api/v1/patients/me", tok, "")
	env := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("me: got %d %s", w.Code, w.Body.String())
	}
	m := dataMap(t, env)
	for _, k := range []string{"_id", "registration_no", "email", "allergies", "previous_medical_conditions"} {
		if _, ok := m[k]; !ok {
			t.Errorf("summary missing %q", k)
		}
	}
	if _, ok := m["password_hash"]; ok {
		t.Error("summary leaks password hash")
	}

	w = doJSON(fx, "GET", "/api/v1/patients/me/profile", tok, "")
	if w.Code != 200 {
		t.Fatalf("profile: got %d", w.Code)
	}

	w = doJSON(fx, "GET", "/api/v1/patients/me/metrics", tok, "")
	m = dataMap(t, decode(t, w))
	for _, k := range []string{"consultations", "medications", "investigations", "appointments"} {
		if m[k] != float64(0) {
			t.Errorf("fresh metrics %q = %v, want 0", k, m[k])
		}
	}

	// No token and wrong role both 401.
	w = doJSON(fx, "GET", "/api/v1/patients/me", "", "")
	if w.Code != 401 {
		t.Errorf("no token: got %d, want 401", w.Code)
	}
	w = doJSON(fx, "GET", "/api/v1/patients/me", fx.tokens["doc"], "")
	env = decode(t, w)
	if w.Code != 401 || env.ResponseCode != "011" {
		t.Errorf("doctor token: got %d %+v, want 401/011", w.Code, env)
	}
}

func TestProfileReplaceSemantics(t *testing.T) {
	fx := setup(t)
	tok := fx.tokens["pat"]

	w := doJSON(fx, "PATCH", "/api/v1/patients/me/profile",
		tok, `{"allergies":["Peanuts","Latex"],"occupation":"Engineer"}`)
	if w.Code != 200 {
		t.Fatalf("patch: got %d %s", w.Code, w.Body.String())
	}
	m := dataMap(t, decode(t, w))
	if fmt.Sprint(m["allergies"]) != "[Peanuts Latex]" || m["occupation"] != "Engineer" {
		t.Errorf("patched = %+v", m)
	}

	// Empty array clears; blank string leaves untouched.
	w = doJSON(fx, "PATCH", "/api/v1/patients/me/profile", tok, `{"allergies":[]}`)
	m = dataMap(t, decode(t, w))
	if arr, _ := m["allergies"].([]any); len(arr) != 0 {
		t.Errorf("clear failed: %+v", m["allergies"])
	}
	w = doJSON(fx, "PATCH", "/api/v1/patients/me/profile", tok, `{"occupation":"  "}`)
	if dataMap(t, decode(t, w))["occupation"] != "Engineer" {
		t.Error("blank string should leave field untouched")
	}

	// Unknown key 400; bad date 400.
	w = doJSON(fx, "PATCH", "/api/v1/patients/me/profile", tok, `{"mrn":"C-HACKED"}`)
	if w.Code != 400 {
		t.Errorf("unknown key: got %d, want 400", w.Code)
	}
	w = doJSON(fx, "PATCH", "/api/v1/patients/me/profile", tok, `{"date_of_birth":"not-a-date"}`)
	if w.Code != 400 {
		t.Errorf("bad dob: got %d, want 400", w.Code)
	}
	w = doJSON(fx, "PATCH", "/api/v1/patients/me/profile", tok, `{"date_of_birth":"1990-05-01"}`)
	if dataMap(t, decode(t, w))["date_of_birth"] != "1990-05-01" {
		t.Error("dob not stored")
	}
}

func TestMultipartCoercionAndFilePick(t *testing.T) {
	fx := setup(t)
	tok := fx.tokens["pat2"]

	// JSON-array string + single value coerce; '' clears.
	w := doMultipart(fx, "/api/v1/patients/me", tok,
		map[string][]string{"allergies": {`["X","Y"]`}}, nil)
	if fmt.Sprint(dataMap(t, decode(t, w))["allergies"]) != "[X Y]" {
		t.Errorf("json-array coerce failed: %s", w.Body.String())
	}
	w = doMultipart(fx, "/api/v1/patients/me", tok,
		map[string][]string{"allergies": {""}}, nil)
	if arr, _ := dataMap(t, decode(t, w))["allergies"].([]any); len(arr) != 0 {
		t.Error("empty part should clear the list")
	}

	// File pick order: file wins over image.
	w = doMultipart(fx, "/api/v1/patients/me", tok, nil,
		map[string]string{"image": "imagedata", "file": "filedata!!"})
	if w.Code != 200 {
		t.Fatalf("multipart+file: got %d %s", w.Code, w.Body.String())
	}
	if string(fx.files.last) != "filedata!!" {
		t.Errorf("file pick order wrong, provider got %q", fx.files.last)
	}
	if dataMap(t, decode(t, w))["profile_picture_url"] != "https://img.test/pic.jpg" {
		t.Error("picture URL not persisted")
	}
}

func TestTimezone(t *testing.T) {
	fx := setup(t)
	tok := fx.tokens["pat"]

	w := doJSON(fx, "PATCH", "/api/v1/patients/me/timezone", tok, `{"timezone":"Not/AZone"}`)
	env := decode(t, w)
	if w.Code != 400 || !strings.Contains(env.ResponseDescription, "valid IANA timezone") {
		t.Errorf("bad zone: got %d %+v", w.Code, env)
	}
	w = doJSON(fx, "PATCH", "/api/v1/patients/me/timezone", tok, `{"timezone":"Africa/Lagos"}`)
	if dataMap(t, decode(t, w))["timezone"] != "Africa/Lagos" {
		t.Error("timezone not updated")
	}
}

func TestMetricsCounts(t *testing.T) {
	fx := setup(t)
	tok := fx.tokens["pat"]
	pid := fx.ids["pat"]
	ctx := context.Background()
	suffix := strings.ReplaceAll(testdb.UniqueEmail(t, "m9"), "@example.com", "")
	apptNo, consRef := "APT-"+suffix, "CONS-"+suffix

	var apptID, consID string
	err := fx.pool.Inner().QueryRow(ctx, `INSERT INTO appointments
		(appointment_number, patient_id, scheduled_start_at_utc, scheduled_end_at_utc, timezone_snapshot, status)
		VALUES ($1, $2::uuid, now() + interval '1 day', now() + interval '1 day' + interval '30 min', 'UTC', 'CONFIRMED')
		RETURNING id::text`, apptNo, pid).Scan(&apptID)
	if err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	err = fx.pool.Inner().QueryRow(ctx, `INSERT INTO consultations
		(appointment_id, reference, type, patient_id, consoltation_for, title, status)
		VALUES ($1::uuid, $2, 'VIDEO', $3::uuid, 'SELF', 'Visit', 'ACTIVE')
		RETURNING id::text`, apptID, consRef, pid).Scan(&consID)
	if err != nil {
		t.Fatalf("seed consultation: %v", err)
	}
	_, err = fx.pool.Inner().Exec(ctx, `INSERT INTO medications
		(consultation_id, patient_id, formulary, medication, dose, unit, interval, duration, duration_unit)
		VALUES ($1::uuid, $2::uuid, 'TABLET', 'Paracetamol', 500, 'MILLIGRAM', 'DAILY', 5, 'DAY')`, consID, pid)
	if err != nil {
		t.Fatalf("seed medication: %v", err)
	}
	_, err = fx.pool.Inner().Exec(ctx, `INSERT INTO investigation_lists
		(consultation_id, patient_id, name, assign_to_patient)
		VALUES ($1::uuid, $2::uuid, 'Blood panel', true)`, consID, pid)
	if err != nil {
		t.Fatalf("seed investigation: %v", err)
	}
	w := doJSON(fx, "GET", "/api/v1/patients/me/metrics", tok, "")
	m := dataMap(t, decode(t, w))
	for _, k := range []string{"consultations", "medications", "investigations", "appointments"} {
		if m[k] != float64(1) {
			t.Errorf("metrics %q = %v, want 1 (full: %+v)", k, m[k], m)
		}
	}
	// Cleanup FK-ordered (tracked emails handle accounts; domain rows here).
	_, _ = fx.pool.Inner().Exec(ctx, `DELETE FROM medications WHERE consultation_id = $1::uuid
		; DELETE FROM investigation_lists WHERE consultation_id = $1::uuid
		; DELETE FROM consultations WHERE id = $1::uuid
		; DELETE FROM appointments WHERE id = $2::uuid`, consID, apptID)
}

func TestPictureFlows(t *testing.T) {
	fx := setup(t)
	tok := fx.tokens["pat2"]

	w := doJSON(fx, "PATCH", "/api/v1/patients/me/profile-picture",
		tok, `{"profile_picture_url":"https://cdn.test/a.png"}`)
	if dataMap(t, decode(t, w))["profile_picture_url"] != "https://cdn.test/a.png" {
		t.Error("URL flow not persisted")
	}

	// Disabled provider → controlled 503.
	fx.svc.Files = files.Disabled{}
	w = doMultipartMethod(fx, http.MethodPost, "/api/v1/patients/me/profile-picture/upload", tok, nil,
		map[string]string{"file": "bytes"})
	env := decode(t, w)
	if w.Code != 503 || env.ResponseDescription != "Cloudinary is not configured" {
		t.Errorf("disabled upload: got %d %+v, want 503", w.Code, env)
	}

	// Missing file → exact 400.
	fx.svc.Files = fx.files
	w = doMultipartMethod(fx, http.MethodPost, "/api/v1/patients/me/profile-picture/upload", tok, nil, nil)
	env = decode(t, w)
	if w.Code != 400 || !strings.Contains(env.ResponseDescription, "Profile image file is required") {
		t.Errorf("missing file: got %d %+v", w.Code, env)
	}
}
