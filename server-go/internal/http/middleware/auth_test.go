package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/testdb"
)

type seededEmails struct {
	patient, doctor1, doctor2, admin string
}

type envelope struct {
	Success             bool   `json:"success"`
	ResponseCode        string `json:"response_code"`
	ResponseDescription string `json:"response_description"`
}

func testIssuer(t *testing.T) *auth.Issuer {
	t.Helper()
	iss, err := auth.NewIssuer(auth.IssuerConfig{
		JWTSecret:        "test-access-secret",
		JWTRefreshSecret: "test-refresh-secret",
	})
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	return iss
}

// testEngine builds a Gin engine with the auth chain on /me (patient-only)
// and /any (any authenticated role).
func testEngine(iss *auth.Issuer, resolver UserResolver) *gin.Engine {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.GET("/me", Authenticate(iss, resolver, auth.RolePatient), func(c *gin.Context) {
		u, _ := CurrentUserFrom(c)
		c.String(http.StatusOK, u.Role+":"+u.Email)
	})
	e.GET("/any", RequireAnyAuth(iss, resolver), func(c *gin.Context) {
		u, _ := CurrentUserFrom(c)
		c.String(http.StatusOK, u.Role)
	})
	return e
}

func doReq(e *gin.Engine, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)
	return w
}

func mustSeed(t *testing.T) (iss *auth.Issuer, pool *postgres.Pool, emails seededEmails, patientTok, doctorTok, adminTok string) {
	t.Helper()
	pool = testdb.Setup(t)
	email_pat1 := testdb.UniqueEmail(t, "pat1")
	email_doc1 := testdb.UniqueEmail(t, "doc1")
	email_doc2 := testdb.UniqueEmail(t, "doc2")
	email_adm1 := testdb.UniqueEmail(t, "adm1")
	testdb.Track(t, pool, email_pat1, email_doc1, email_doc2, email_adm1)
	ctx := context.Background()
	_, err := pool.Inner().Exec(ctx,
		"INSERT INTO patients (registration_no, first_name, last_name, email) VALUES ('REG-T1','Pat','One','" + email_pat1 + "')")
	if err != nil {
		t.Fatalf("seed patient: %v", err)
	}
	_, err = pool.Inner().Exec(ctx,
		"INSERT INTO doctors (doctor_no, first_name, last_name, email, password_hash, active) VALUES ('DOC-T1','Doc','One','" + email_doc1 + "','h',true)")
	if err != nil {
		t.Fatalf("seed doctor: %v", err)
	}
	_, err = pool.Inner().Exec(ctx,
		"INSERT INTO doctors (doctor_no, first_name, last_name, email, password_hash, active) VALUES ('DOC-T2','Doc','Two','" + email_doc2 + "','h',false)")
	if err != nil {
		t.Fatalf("seed inactive doctor: %v", err)
	}
	_, err = pool.Inner().Exec(ctx,
		"INSERT INTO admins (first_name, last_name, email, password_hash) VALUES ('Ad','Min','" + email_adm1 + "','h')")
	if err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	iss = testIssuer(t)
	mk := func(id, email, role string) string {
		tok, err := iss.GenerateAccess(id, email, role)
		if err != nil {
			t.Fatalf("mint %s token: %v", role, err)
		}
		return tok
	}
	emails = seededEmails{patient: email_pat1, doctor1: email_doc1, doctor2: email_doc2, admin: email_adm1}
	return iss, pool, emails,
		mk("p1", email_pat1, auth.RolePatient),
		mk("d1", email_doc1, auth.RoleDoctor),
		mk("a1", email_adm1, auth.RoleAdmin)
}

func decodeEnv(t *testing.T, w *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("body is not an envelope: %v (%s)", err, w.Body.String())
	}
	return env
}

func TestPatientRouteHappyPath(t *testing.T) {
	iss, pool, emails, patientTok, _, _ := mustSeed(t)
	e := testEngine(iss, NewDBResolver(pool))
	w := doReq(e, "/me", patientTok)
	if w.Code != http.StatusOK || w.Body.String() != "patient:"+emails.patient {
		t.Errorf("got %d %q, want 200 patient:pat1@example.com", w.Code, w.Body.String())
	}
	// Any-auth route also passes and injects the role.
	w = doReq(e, "/any", patientTok)
	if w.Code != http.StatusOK || w.Body.String() != "patient" {
		t.Errorf("any-auth: got %d %q", w.Code, w.Body.String())
	}
}

func TestMissingAndBadTokens(t *testing.T) {
	iss, pool, _, _, _, _ := mustSeed(t)
	e := testEngine(iss, NewDBResolver(pool))

	w := doReq(e, "/me", "")
	env := decodeEnv(t, w)
	if w.Code != 401 || env.ResponseCode != "011" || env.ResponseDescription != "Missing authorization token" {
		t.Errorf("missing token: got %d %+v", w.Code, env)
	}

	w = doReq(e, "/me", "garbage.token.here")
	env = decodeEnv(t, w)
	if w.Code != 401 || env.ResponseCode != "011" || env.ResponseDescription != "Invalid or expired token" {
		t.Errorf("bad token: got %d %+v", w.Code, env)
	}

	// Unknown account (fresh unique address guarantees absence).
	email_ghost := testdb.UniqueEmail(t, "ghost")
	other, _ := iss.GenerateAccess("ghost", email_ghost, auth.RolePatient)
	w = doReq(e, "/me", other)
	env = decodeEnv(t, w)
	if w.Code != 401 || env.ResponseDescription != "User not found or account deactivated" {
		t.Errorf("ghost: got %d %+v", w.Code, env)
	}
}

func TestRoleMismatchIs401(t *testing.T) {
	iss, pool, _, _, doctorTok, adminTok := mustSeed(t)
	e := testEngine(iss, NewDBResolver(pool))

	for _, tok := range []string{doctorTok, adminTok} {
		w := doReq(e, "/me", tok)
		env := decodeEnv(t, w)
		if w.Code != 401 || env.ResponseCode != "011" || !strings.HasPrefix(env.ResponseDescription, "Access denied.") {
			t.Errorf("wrong role: got %d %+v, want 401 Access denied.", w.Code, env)
		}
	}
}

func TestInactiveDoctorRejected(t *testing.T) {
	iss, pool, emails, _, _, _ := mustSeed(t)
	tok, err := iss.GenerateAccess("d2", emails.doctor2, auth.RoleDoctor)
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	e := testEngine(iss, NewDBResolver(pool))
	w := doReq(e, "/me", tok)
	env := decodeEnv(t, w)
	if w.Code != 401 || env.ResponseDescription != "Doctor account is deactivated" {
		t.Errorf("inactive doctor: got %d %+v", w.Code, env)
	}
}

func TestNilPoolFailsClosed(t *testing.T) {
	iss := testIssuer(t)
	tok, _ := iss.GenerateAccess("p1", "nilpool@example.com", auth.RolePatient)
	e := testEngine(iss, NewDBResolver(nil))
	w := doReq(e, "/me", tok)
	if w.Code != 401 {
		t.Errorf("nil pool: got %d, want 401", w.Code)
	}
}
