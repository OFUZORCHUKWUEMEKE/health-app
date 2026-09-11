// Package contract pins the frontend-used API surface: every endpoint the
// web/mobile clients call, with the envelope code and key payload shapes
// they depend on. Per-module tests cover logic; this suite guards the
// surface against renames, regroups, and envelope drift (M20).
package contract

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/booking"
	"github.com/wizzyszn/Telemex/internal/consult"
	"github.com/wizzyszn/Telemex/internal/doctors"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/router"
	"github.com/wizzyszn/Telemex/internal/mail"
	"github.com/wizzyszn/Telemex/internal/notifications"
	"github.com/wizzyszn/Telemex/internal/patients"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/testdb"
	"github.com/wizzyszn/Telemex/internal/video"
)

type envelope struct {
	Success      bool            `json:"success"`
	ResponseCode string          `json:"response_code"`
	Data         json.RawMessage `json:"data"`
	Message      any             `json:"message"`
	RequestID    string          `json:"request_id"`
}

type surface struct {
	engine *gin.Engine
	pool   *postgres.Pool
	patT   string
	docT   string
}

func setup(t *testing.T) *surface {
	t.Helper()
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{JWTSecret: "c-access", JWTRefreshSecret: "c-refresh"})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	authSvc := &auth.Service{DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy: mail.NewCopy(), FrontendURL: "http://x", IncludeOTP: true}
	ctx := context.Background()
	mk := func(prefix, role, password string) (string, string) {
		email := testdb.UniqueEmail(t, prefix)
		testdb.Track(t, pool, email)
		var out map[string]any
		if role == auth.RoleDoctor {
			if _, err := authSvc.DoctorSignup(ctx, email, "Doc", "Tor", password, ""); err != nil {
				t.Fatalf("doctor signup: %v", err)
			}
			out, err = authSvc.Login(ctx, auth.RoleDoctor, email, password)
			if err != nil {
				t.Fatalf("doctor login: %v", err)
			}
			return out["token"].(string), out["doctor"].(map[string]any)["_id"].(string)
		}
		if _, err := authSvc.PatientSignup(ctx, "Pat", "One", "", email, password); err != nil {
			t.Fatalf("patient signup: %v", err)
		}
		out, err = authSvc.Login(ctx, auth.RolePatient, email, password)
		if err != nil {
			t.Fatalf("patient login: %v", err)
		}
		return out["token"].(string), out["user"].(map[string]any)["_id"].(string)
	}
	docT, _ := mk("csurf-doc", auth.RoleDoctor, "DocPass123!")
	patT, pat := mk("csurf-pat", auth.RolePatient, "StrongPass123!")

	users := middleware.NewDBResolver(pool)
	e := router.New(router.Deps{
		Pool:     pool,
		Patients: patients.NewHandler(&patients.Service{DB: pool, Files: files.Disabled{}}, iss, users),
		Doctors:  doctors.NewHandler(&doctors.Service{DB: pool, Files: files.Disabled{}}, iss, users),
		Booking:  booking.NewHandler(&booking.Service{DB: pool, BookingMode: "auto"}, iss, users),
		Consult:  consult.NewHandler(&consult.Service{DB: pool, Files: files.Disabled{}}, iss, users),
		Notify:   notifications.NewHandler(&notifications.Service{DB: pool}, iss, users, ""),
		Video:    video.NewHandler(&video.Service{DB: pool}, iss, users),
	})
	fx := &surface{engine: e, pool: pool, patT: patT, docT: docT}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Inner().Exec(c, "DELETE FROM appointments WHERE patient_id = $1::uuid", pat)
	})
	return fx
}

func call(e *gin.Engine, method, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
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
	if env.RequestID == "" {
		t.Errorf("envelope missing request_id: %s", w.Body.String())
	}
	return env
}

// TestUnauthenticatedSurface pins the 011 envelope across frontend-used
// protected routes: no token → 401, never 404/500.
func TestUnauthenticatedSurface(t *testing.T) {
	fx := setup(t)
	paths := []struct{ method, path string }{
		{"GET", "/api/v1/patients/me"},
		{"GET", "/api/v1/patients/me/profile"},
		{"GET", "/api/v1/doctors/me"},
		{"GET", "/api/v1/booking/doctors/search?q=x"},
		{"GET", "/api/v1/booking/patients/appointments"},
		{"GET", "/api/v1/patients/consultations"},
		{"GET", "/api/v1/doctors/consultations"},
		{"GET", "/api/v1/patients/me/notifications"},
		{"GET", "/api/v1/doctors/me/notifications"},
		{"GET", "/api/v1/doctors/me/appointments/x/video-token"},
		{"GET", "/api/v1/version"},
		{"GET", "/api/v1/health"},
		{"GET", "/api/v1/readyz"},
	}
	for _, p := range paths {
		w := call(fx.engine, p.method, p.path, "", "")
		env := decode(t, w)
		switch p.path {
		case "/api/v1/version", "/api/v1/health":
			if w.Code != 200 || !env.Success {
				t.Errorf("%s %s: got %d, want 200", p.method, p.path, w.Code)
			}
		case "/api/v1/readyz":
			if w.Code != 200 {
				t.Errorf("readyz: got %d, want 200", w.Code)
			}
		default:
			if w.Code != 401 || env.ResponseCode != "011" {
				t.Errorf("%s %s: got %d/%s, want 401/011", p.method, p.path, w.Code, env.ResponseCode)
			}
		}
	}
	// Unknown routes stay enveloped 404s.
	w := call(fx.engine, "GET", "/api/v1/nope", "", "")
	if w.Code != 404 {
		t.Errorf("no-route: got %d, want 404", w.Code)
	}
}

// TestAuthenticatedSurface pins happy-path shapes for the core reads the
// frontend renders on boot: profiles, search, lists, feeds.
func TestAuthenticatedSurface(t *testing.T) {
	fx := setup(t)
	cases := []struct {
		name       string
		method     string
		path       string
		token      func(*surface) string
		wantStatus int
		wantKeys   []string
	}{
		{"patient summary", "GET", "/api/v1/patients/me", func(fx *surface) string { return fx.patT }, 200, []string{"_id", "email"}},
		{"patient profile", "GET", "/api/v1/patients/me/profile", func(fx *surface) string { return fx.patT }, 200, []string{"_id"}},
		{"doctor profile", "GET", "/api/v1/doctors/me/profile", func(fx *surface) string { return fx.docT }, 200, []string{"_id"}},
		{"doctor search", "GET", "/api/v1/booking/doctors/search?q=a", func(fx *surface) string { return fx.patT }, 200, nil},
		{"patient appointments", "GET", "/api/v1/booking/patients/appointments", func(fx *surface) string { return fx.patT }, 200, []string{"items", "pagination"}},
		{"doctor appointments", "GET", "/api/v1/booking/doctors/me/appointments", func(fx *surface) string { return fx.docT }, 200, []string{"items", "pagination"}},
		{"patient consultations", "GET", "/api/v1/patients/consultations", func(fx *surface) string { return fx.patT }, 200, []string{"consultation", "meta"}},
		{"doctor consultations", "GET", "/api/v1/doctors/consultations", func(fx *surface) string { return fx.docT }, 200, []string{"consultation", "meta"}},
		{"patient medications", "GET", "/api/v1/patients/consultations/medications", func(fx *surface) string { return fx.patT }, 200, nil},
		{"patient referrals", "GET", "/api/v1/patients/consultations/referrals", func(fx *surface) string { return fx.patT }, 200, nil},
		{"notification feed", "GET", "/api/v1/patients/me/notifications", func(fx *surface) string { return fx.patT }, 200, []string{"items", "pagination"}},
		{"notification unread", "GET", "/api/v1/patients/me/notifications/unread-count", func(fx *surface) string { return fx.patT }, 200, []string{"unread"}},
	}
	for _, tc := range cases {
		w := call(fx.engine, tc.method, tc.path, tc.token(fx), "")
		env := decode(t, w)
		if w.Code != tc.wantStatus || !env.Success {
			t.Errorf("%s: got %d %s, want %d", tc.name, w.Code, w.Body.String(), tc.wantStatus)
			continue
		}
		if len(tc.wantKeys) > 0 {
			var data map[string]any
			if err := json.Unmarshal(env.Data, &data); err != nil {
				t.Errorf("%s: data not an object: %v", tc.name, err)
				continue
			}
			for _, k := range tc.wantKeys {
				if _, ok := data[k]; !ok {
					t.Errorf("%s: data missing key %q: %v", tc.name, k, data)
				}
			}
		}
	}
	// Cross-role access stays 401 (Nest parity): patient token on a doctor
	// route and vice versa.
	w := call(fx.engine, "GET", "/api/v1/doctors/me/profile", fx.patT, "")
	if w.Code != 401 {
		t.Errorf("patient on doctor route: got %d, want 401", w.Code)
	}
	w = call(fx.engine, "GET", "/api/v1/patients/me", fx.docT, "")
	if w.Code != 401 {
		t.Errorf("doctor on patient route: got %d, want 401", w.Code)
	}
	// Unconfigured Daily surfaces the controlled 503, not a 500.
	w = call(fx.engine, "GET", "/api/v1/doctors/me/appointments/00000000-0000-0000-0000-000000000000/video-token", fx.docT, "")
	if w.Code != 503 {
		t.Errorf("video without Daily: got %d, want 503", w.Code)
	}
}
