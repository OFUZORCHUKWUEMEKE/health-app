package authhttp

import (
	"context"
	"encoding/json"
	"net/http"
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

type envelope struct {
	Success             bool            `json:"success"`
	ResponseCode        string          `json:"response_code"`
	ResponseDescription string          `json:"response_description"`
	Data                json.RawMessage `json:"data"`
}

func testSetup(t *testing.T) (*gin.Engine, *auth.Service, *auth.Issuer, *postgres.Pool) {
	t.Helper()
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{
		JWTSecret: "h-access", JWTRefreshSecret: "h-refresh",
	})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	svc := &auth.Service{
		DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy: mail.NewCopy(),
		FrontendURL: "http://localhost:3000", IncludeOTP: true,
		RegExpLabel: "15m", ResetExpLabel: "15m",
	}
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(middleware.RequestID())
	h := NewHandler(svc, iss, middleware.NewDBResolver(pool), false, "", "http://localhost:3000")
	v1 := e.Group("/api/v1")
	h.Register(v1)
	return e, svc, iss, pool
}

func post(e *gin.Engine, path, body, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)
	return w
}

func decode(t *testing.T, w *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("not an envelope: %v (%s)", err, w.Body.String())
	}
	return env
}

func TestSignupLoginRefreshOverHTTP(t *testing.T) {
	email_eve := testdb.UniqueEmail(t, "eve")
	e, _, _, pool := testSetup(t)
	testdb.Track(t, pool, email_eve)

	w := post(e, "/api/v1/auth/patients/signup",
		`{"first_name":"Eve","last_name":"Adams","email":"` + email_eve + `","password":"StrongPass123!"}`, "")
	env := decode(t, w)
	if w.Code != 201 || !env.Success {
		t.Fatalf("signup: got %d %s", w.Code, w.Body.String())
	}
	var data map[string]any
	_ = json.Unmarshal(env.Data, &data)
	if data["token"] == nil || data["refresh_token"] == nil {
		t.Errorf("signup data keys = %v, want snake_case token pair", data)
	}

	w = post(e, "/api/v1/auth/patients/login",
		`{"email":"` + email_eve + `","password":"StrongPass123!"}`, "")
	env = decode(t, w)
	if w.Code != 200 {
		t.Fatalf("login: got %d %s", w.Code, w.Body.String())
	}
	_ = json.Unmarshal(env.Data, &data)
	rt := data["refresh_token"].(string)

	w = post(e, "/api/v1/auth/refresh",
		`{"refreshToken":"`+rt+`","role":"patient"}`, "")
	env = decode(t, w)
	if w.Code != 200 {
		t.Fatalf("refresh: got %d %s", w.Code, w.Body.String())
	}
	var refreshData map[string]any
	_ = json.Unmarshal(env.Data, &refreshData)
	if refreshData["accessToken"] == nil || refreshData["refreshToken"] == nil {
		t.Errorf("refresh data = %v, want camelCase pair", refreshData)
	}
}

func TestDoctorSignupRequiresAdmin(t *testing.T) {
	email_patone := testdb.UniqueEmail(t, "patone")
	email_d := testdb.UniqueEmail(t, "d")
	e, svc, iss, pool := testSetup(t)
	testdb.Track(t, pool, email_patone, email_d)
	ctx := context.Background()
	if _, err := svc.PatientSignup(ctx, "Pat", "One", "", email_patone, "StrongPass123!"); err != nil {
		t.Fatalf("signup: %v", err)
	}
	login, err := svc.Login(ctx, auth.RolePatient, email_patone, "StrongPass123!")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	_ = iss
	w := post(e, "/api/v1/auth/doctors/signup",
		`{"email":"` + email_d + `","first_name":"D","last_name":"Oc","password":"DocPass123!"}`, login["token"].(string))
	env := decode(t, w)
	if w.Code != 401 {
		t.Errorf("patient creating doctor: got %d %+v, want 401", w.Code, env)
	}
}

func TestBootstrapDisabledOverHTTP(t *testing.T) {
	email_r := testdb.UniqueEmail(t, "r")
	e, _, _, pool := testSetup(t)
	testdb.Track(t, pool, email_r)
	w := post(e, "/api/v1/auth/admins/bootstrap",
		`{"first_name":"R","last_name":"A","email":"` + email_r + `","password":"AdminPass123!","bootstrap_key":"k"}`, "")
	env := decode(t, w)
	if w.Code != 403 || env.ResponseCode != "009" {
		t.Errorf("bootstrap disabled: got %d %+v, want 403/009", w.Code, env)
	}
}

func TestValidationEnvelopeOverHTTP(t *testing.T) {
	e, _, _, _ := testSetup(t)
	w := post(e, "/api/v1/auth/patients/login", `{"email":"not-an-email"}`, "")
	env := decode(t, w)
	if w.Code != 400 || env.ResponseCode != "006" {
		t.Errorf("bad login body: got %d %+v, want 400/006", w.Code, env)
	}
}
