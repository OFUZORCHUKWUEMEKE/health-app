package video

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/mail"
	"github.com/wizzyszn/Telemex/internal/testdb"
)

// --- fake Daily ------------------------------------------------------------

type fakeDaily struct {
	rooms      map[string]Room
	tokens     []string
	createErr  error
	tokenErr   error
	roomCalls  int
	tokenCalls int
	lastUserID string
	lastOwner  bool
	lastRoom   string
}

func newFake() *fakeDaily { return &fakeDaily{rooms: map[string]Room{}} }

func (f *fakeDaily) CreateRoom(_ context.Context, name string, nbf, exp int64) (Room, error) {
	f.roomCalls++
	if f.createErr != nil {
		return Room{}, f.createErr
	}
	r := Room{Name: name, URL: "https://x.daily.co/" + name, Exp: exp}
	f.rooms[name] = r
	_ = nbf
	return r, nil
}

func (f *fakeDaily) GetRoom(_ context.Context, name string) (Room, error) {
	if r, ok := f.rooms[name]; ok {
		return r, nil
	}
	return Room{}, ErrNotFound{}
}

func (f *fakeDaily) CreateMeetingToken(_ context.Context, roomName string, isOwner bool, _, userID string, exp int64) (string, error) {
	f.tokenCalls++
	f.lastRoom, f.lastOwner, f.lastUserID = roomName, isOwner, userID
	if f.tokenErr != nil {
		return "", f.tokenErr
	}
	_ = exp
	tok := "tok-" + roomName
	if isOwner {
		tok += "-owner"
	}
	f.tokens = append(f.tokens, tok)
	return tok, nil
}

// --- unit: retry policy -----------------------------------------------------

type timeoutErr struct{}

func (timeoutErr) Error() string   { return "i/o timeout" }
func (timeoutErr) Timeout() bool   { return true }
func (timeoutErr) Temporary() bool { return true }

func TestShouldRetry(t *testing.T) {
	if !shouldRetry(429, nil) || !shouldRetry(500, nil) || !shouldRetry(503, nil) {
		t.Error("429/5xx should retry")
	}
	if shouldRetry(400, nil) || shouldRetry(401, nil) || shouldRetry(404, nil) {
		t.Error("deterministic 4xx must not retry")
	}
	if shouldRetry(0, timeoutErr{}) {
		t.Error("timeouts must not retry")
	}
	if !shouldRetry(0, errors.New("connection reset")) {
		t.Error("fast network failures should retry")
	}
	var _ net.Error = timeoutErr{}
}

func TestRetryDelayHonoursRetryAfter(t *testing.T) {
	if got := retryDelay(3, 1); got != 3*time.Second {
		t.Errorf("Retry-After: got %v", got)
	}
	if got := retryDelay(0, 1); got < RetryBase || got >= 2*RetryBase {
		t.Errorf("backoff+jitter out of range: %v", got)
	}
}

func TestHTTPDailyRetriesThenSucceeds(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"r","url":"https://u","config":{"exp":99}}`))
	}))
	defer srv.Close()
	d := NewDailyWithBase("k", srv.URL)
	d.http = srv.Client()
	room, err := d.CreateRoom(context.Background(), "r", 1, 2)
	if err != nil || room.Exp != 99 || calls != 2 {
		t.Errorf("retry: room=%+v err=%v calls=%d", room, err, calls)
	}
}

func TestHTTPDailyEmptyTokenFailsNearCause(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	d := NewDailyWithBase("k", srv.URL)
	d.http = srv.Client()
	if _, err := d.CreateMeetingToken(context.Background(), "r", true, "Doc", "u", 9); err == nil {
		t.Error("empty token must fail")
	}
}

func TestHTTPDailyGetRoom404(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
	}))
	defer srv.Close()
	d := NewDailyWithBase("k", srv.URL)
	d.http = srv.Client()
	if _, err := d.GetRoom(context.Background(), "nope"); err == nil {
		t.Error("expected error")
	} else if _, ok := err.(ErrNotFound); !ok {
		t.Errorf("expected ErrNotFound, got %T", err)
	}
}

func TestHTTPDailyTruncatesUserID(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Properties struct {
				UserID string `json:"user_id"`
			} `json:"properties"`
		}
		_ = json.NewDecoder(r.Body).Decode(&v)
		got = v.Properties.UserID
		_, _ = w.Write([]byte(`{"token":"abc"}`))
	}))
	defer srv.Close()
	d := NewDailyWithBase("k", srv.URL)
	d.http = srv.Client()
	long := strings.Repeat("x", 40)
	if _, err := d.CreateMeetingToken(context.Background(), "r", false, "P", long, 9); err != nil {
		t.Fatal(err)
	}
	if len(got) != MaxUserIDLength {
		t.Errorf("user_id len=%d, want %d", len(got), MaxUserIDLength)
	}
}

func TestReferenceShape(t *testing.T) {
	ref, err := reference()
	if err != nil || !strings.HasPrefix(ref, "VIDEO-") || len(ref) != 16 {
		t.Errorf("ref=%q err=%v", ref, err)
	}
}

// --- integration ------------------------------------------------------------

func TestVideoIntegration(t *testing.T) {
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{JWTSecret: "v-access", JWTRefreshSecret: "v-refresh"})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	authSvc := &auth.Service{DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy: mail.NewCopy(), FrontendURL: "http://x", IncludeOTP: true}
	ctx := context.Background()
	mkDoctor := func(prefix string) (string, string) {
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
	mkPatient := func(prefix string) (string, string) {
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
	doctorT, doctor := mkDoctor("vdoc")
	doctor2T, _ := mkDoctor("vdoc2")
	patT, pat := mkPatient("vpat")

	fake := newFake()
	svc := &Service{DB: pool, Daily: fake}
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(middleware.RequestID())
	h := NewHandler(svc, iss, middleware.NewDBResolver(pool))
	v1 := e.Group("/api/v1")
	h.Register(v1)

	seed := func(status string, start, end time.Time) string {
		var id string
		if err := pool.Inner().QueryRow(ctx, `INSERT INTO appointments
			(appointment_number, patient_id, doctor_id, scheduled_start_at_utc, scheduled_end_at_utc,
			 timezone_snapshot, status, appointment_for, reason_for_visit)
			VALUES ('APT-V-' || left(md5(random()::text), 6), $1::uuid, $2::uuid, $3, $4,
			 'UTC', $5, 'SELF', 'Checkup') RETURNING id::text`, pat, doctor, start, end, status).Scan(&id); err != nil {
			t.Fatalf("seed: %v", err)
		}
		t.Cleanup(func() {
			c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_, _ = pool.Inner().Exec(c, "DELETE FROM notifications WHERE appointment_id = $1::uuid", id)
			_, _ = pool.Inner().Exec(c, "DELETE FROM consultations WHERE appointment_id = $1::uuid", id)
			_, _ = pool.Inner().Exec(c, "DELETE FROM appointments WHERE id = $1::uuid", id)
		})
		return id
	}
	req := func(method, path, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		e.ServeHTTP(w, r)
		return w
	}
	var env struct {
		Success             bool            `json:"success"`
		ResponseCode        string          `json:"response_code"`
		ResponseDescription string          `json:"response_description"`
		Data                json.RawMessage `json:"data"`
		Message             any             `json:"message"`
	}
	decode := func(w *httptest.ResponseRecorder) {
		t.Helper()
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode: %v body=%s", err, w.Body.String())
		}
	}
	now := time.Now()
	live := seed("CONFIRMED", now.Add(-5*time.Minute), now.Add(30*time.Minute))
	// Doctor token creates room + consultation + one notification.
	w := req("GET", "/api/v1/doctors/me/appointments/"+live+"/video-token", doctorT, "")
	decode(w)
	if w.Code != 200 || !env.Success {
		t.Fatalf("doctor token: %d %s", w.Code, w.Body.String())
	}
	var tok struct {
		AppointmentID  string  `json:"appointmentId"`
		ConsultationID *string `json:"consultationId"`
		Role           string  `json:"role"`
		RoomURL        string  `json:"roomUrl"`
		Token          string  `json:"token"`
		ExpiresAt      string  `json:"expiresAt"`
	}
	if err := json.Unmarshal(env.Data, &tok); err != nil || tok.Role != "doctor" || tok.Token == "" || tok.ConsultationID == nil {
		t.Fatalf("doctor token shape: %s err=%v", env.Data, err)
	}
	var notifCount int
	_ = pool.Inner().QueryRow(ctx, `SELECT count(*) FROM notifications WHERE appointment_id = $1::uuid`, live).Scan(&notifCount)
	if notifCount != 1 {
		t.Errorf("room-opened notifications=%d, want 1", notifCount)
	}

	// Second doctor call reuses room: no second notification.
	w = req("GET", "/api/v1/doctors/me/appointments/"+live+"/video-token", doctorT, "")
	decode(w)
	if w.Code != 200 {
		t.Fatalf("doctor re-token: %d %s", w.Code, w.Body.String())
	}
	_ = pool.Inner().QueryRow(ctx, `SELECT count(*) FROM notifications WHERE appointment_id = $1::uuid`, live).Scan(&notifCount)
	if notifCount != 1 {
		t.Errorf("repeat poll notifications=%d, want still 1", notifCount)
	}
	if fake.roomCalls != 1 {
		t.Errorf("roomCalls=%d, want 1 (reuse)", fake.roomCalls)
	}

	// Patient token joins the open room.
	w = req("GET", "/api/v1/patients/me/appointments/"+live+"/video-token", patT, "")
	decode(w)
	if w.Code != 200 {
		t.Fatalf("patient token: %d %s", w.Code, w.Body.String())
	}
	var ptok struct {
		Role string `json:"role"`
	}
	_ = json.Unmarshal(env.Data, &ptok)
	if ptok.Role != "patient" {
		t.Errorf("patient role=%q", ptok.Role)
	}

	// Ownership: other doctor is forbidden.
	w = req("GET", "/api/v1/doctors/me/appointments/"+live+"/video-token", doctor2T, "")
	if w.Code != 403 {
		t.Errorf("foreign doctor: got %d, want 403", w.Code)
	}

	// Patient before room opens: 400 (distinct start avoids the
	// double-book unique index).
	fresh := seed("CONFIRMED", now.Add(-4*time.Minute), now.Add(31*time.Minute))
	w = req("GET", "/api/v1/patients/me/appointments/"+fresh+"/video-token", patT, "")
	if w.Code != 400 {
		t.Errorf("patient-before-room: got %d, want 400", w.Code)
	}

	// Non-confirmed: 400.
	pend := seed("PENDING", now.Add(-3*time.Minute), now.Add(32*time.Minute))
	w = req("GET", "/api/v1/doctors/me/appointments/"+pend+"/video-token", doctorT, "")
	if w.Code != 400 {
		t.Errorf("pending token: got %d, want 400", w.Code)
	}

	// Window: far-future appointment rejected.
	future := seed("CONFIRMED", now.Add(2*time.Hour), now.Add(3*time.Hour))
	w = req("GET", "/api/v1/doctors/me/appointments/"+future+"/video-token", doctorT, "")
	if w.Code != 400 {
		t.Errorf("early join: got %d, want 400", w.Code)
	}
	// Window: ended appointment rejected.
	past := seed("CONFIRMED", now.Add(-2*time.Hour), now.Add(-1*time.Hour))
	w = req("GET", "/api/v1/doctors/me/appointments/"+past+"/video-token", doctorT, "")
	if w.Code != 400 {
		t.Errorf("late join: got %d, want 400", w.Code)
	}

	// Start marks ACTIVE; end acknowledges.
	w = req("PATCH", "/api/v1/doctors/me/appointments/"+live+"/video/start", doctorT, "{}")
	decode(w)
	if w.Code != 200 {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	var startedAt pgtype.Timestamptz
	_ = pool.Inner().QueryRow(ctx, `SELECT video_started_at FROM appointments WHERE id = $1::uuid`, live).Scan(&startedAt)
	if !startedAt.Valid {
		t.Error("video_started_at not stamped")
	}
	w = req("PATCH", "/api/v1/doctors/me/appointments/"+live+"/video/end", doctorT, "{}")
	if w.Code != 200 {
		t.Fatalf("end: %d %s", w.Code, w.Body.String())
	}

	// Terminal consultation: start 409s.
	_, _ = pool.Inner().Exec(ctx, `UPDATE consultations SET status='COMPLETED' WHERE appointment_id = $1::uuid`, live)
	w = req("PATCH", "/api/v1/doctors/me/appointments/"+live+"/video/start", doctorT, "{}")
	if w.Code != 409 {
		t.Errorf("terminal start: got %d, want 409", w.Code)
	}

	// Start with no consultation: 400.
	w = req("PATCH", "/api/v1/doctors/me/appointments/"+fresh+"/video/start", doctorT, "{}")
	if w.Code != 400 {
		t.Errorf("start-without-token: got %d, want 400", w.Code)
	}

	// Unconfigured Daily: 503 on tokens, start/end still work.
	svc.Daily = nil
	w = req("GET", "/api/v1/doctors/me/appointments/"+live+"/video-token", doctorT, "")
	if w.Code != 503 {
		t.Errorf("unconfigured doctor token: got %d, want 503", w.Code)
	}
	w = req("GET", "/api/v1/patients/me/appointments/"+live+"/video-token", patT, "")
	if w.Code != 503 {
		t.Errorf("unconfigured patient token: got %d, want 503", w.Code)
	}
	_, _ = pool.Inner().Exec(ctx, `UPDATE consultations SET status='ACTIVE' WHERE appointment_id = $1::uuid`, live)
	w = req("PATCH", "/api/v1/doctors/me/appointments/"+live+"/video/end", doctorT, "{}")
	if w.Code != 200 {
		t.Errorf("unconfigured end: got %d, want 200", w.Code)
	}
	svc.Daily = fake

	// Invalid id: 400.
	w = req("GET", "/api/v1/doctors/me/appointments/not-a-uuid/video-token", doctorT, "")
	if w.Code != 400 {
		t.Errorf("invalid id: got %d, want 400", w.Code)
	}
}

// Room adoption: a 400 from CreateRoom falls back to GetRoom.
func TestDoctorTokenAdoptsExistingRoom(t *testing.T) {
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{JWTSecret: "v-access", JWTRefreshSecret: "v-refresh"})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	authSvc := &auth.Service{DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy: mail.NewCopy(), FrontendURL: "http://x", IncludeOTP: true}
	ctx := context.Background()
	demail := testdb.UniqueEmail(t, "vadoptdoc")
	testdb.Track(t, pool, demail)
	if _, err := authSvc.DoctorSignup(ctx, demail, "Doc", "Tor", "DocPass123!", ""); err != nil {
		t.Fatalf("doctor signup: %v", err)
	}
	dout, _ := authSvc.Login(ctx, auth.RoleDoctor, demail, "DocPass123!")
	pemail := testdb.UniqueEmail(t, "vadoptpat")
	testdb.Track(t, pool, pemail)
	if _, err := authSvc.PatientSignup(ctx, "Pat", "One", "", pemail, "StrongPass123!"); err != nil {
		t.Fatalf("patient signup: %v", err)
	}
	pout, _ := authSvc.Login(ctx, auth.RolePatient, pemail, "StrongPass123!")
	doctorID := dout["doctor"].(map[string]any)["_id"].(string)
	patientID := pout["user"].(map[string]any)["_id"].(string)
	now := time.Now()
	var apptID string
	if err := pool.Inner().QueryRow(ctx, `INSERT INTO appointments
		(appointment_number, patient_id, doctor_id, scheduled_start_at_utc, scheduled_end_at_utc,
		 timezone_snapshot, status, appointment_for, reason_for_visit)
		VALUES ('APT-VA-' || left(md5(random()::text), 6), $1::uuid, $2::uuid, $3, $4,
		 'UTC', 'CONFIRMED', 'SELF', 'Checkup') RETURNING id::text`,
		patientID, doctorID, now.Add(-5*time.Minute), now.Add(30*time.Minute)).Scan(&apptID); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Inner().Exec(c, "DELETE FROM notifications WHERE appointment_id = $1::uuid", apptID)
		_, _ = pool.Inner().Exec(c, "DELETE FROM consultations WHERE appointment_id = $1::uuid", apptID)
		_, _ = pool.Inner().Exec(c, "DELETE FROM appointments WHERE id = $1::uuid", apptID)
	})
	fake := newFake()
	fake.createErr = &StatusError{Status: 400}
	// Pre-seed the room as if a prior attempt created it on Daily.
	fake.rooms["consultation-"+apptID] = Room{Name: "consultation-" + apptID, URL: "https://adopted", Exp: now.Add(time.Hour).Unix()}
	svc := &Service{DB: pool, Daily: fake}
	if _, err := svc.DoctorToken(ctx, apptID, doctorID); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	var name string
	_ = pool.Inner().QueryRow(ctx, `SELECT daily_room_name FROM appointments WHERE id = $1::uuid`, apptID).Scan(&name)
	if name != "consultation-"+apptID {
		t.Errorf("adopted room=%q", name)
	}
}
