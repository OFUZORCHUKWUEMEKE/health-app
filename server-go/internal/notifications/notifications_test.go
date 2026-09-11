package notifications

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
	engine *gin.Engine
	svc    *Service
	pool   *postgres.Pool
	issuer *auth.Issuer
	key    string
	patT   string
	pat    string
	pat2T  string
	pat2   string
	docT   string
}

func setup(t *testing.T, dispatchKey string) *fixture {
	t.Helper()
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{
		JWTSecret: "n-access", JWTRefreshSecret: "n-refresh",
	})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	authSvc := &auth.Service{
		DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy:        mail.NewCopy(),
		FrontendURL: "http://x", IncludeOTP: true,
	}
	fx := &fixture{pool: pool, issuer: iss, key: dispatchKey}
	ctx := context.Background()
	mkPatient := func(prefix string) (tok, id string) {
		email := testdb.UniqueEmail(t, prefix)
		testdb.Track(t, pool, email)
		if _, err := authSvc.PatientSignup(ctx, "Pat", "One", "", email, "StrongPass123!"); err != nil {
			t.Fatalf("signup: %v", err)
		}
		out, err := authSvc.Login(ctx, auth.RolePatient, email, "StrongPass123!")
		if err != nil {
			t.Fatalf("login: %v", err)
		}
		return out["token"].(string), out["user"].(map[string]any)["_id"].(string)
	}
	fx.patT, fx.pat = mkPatient("npat")
	fx.pat2T, fx.pat2 = mkPatient("npat2")

	docEmail := testdb.UniqueEmail(t, "ndoc")
	testdb.Track(t, pool, docEmail)
	if _, err := authSvc.DoctorSignup(ctx, docEmail, "Doc", "Tor", "DocPass123!", ""); err != nil {
		t.Fatalf("doctor signup: %v", err)
	}
	docOut, err := authSvc.Login(ctx, auth.RoleDoctor, docEmail, "DocPass123!")
	if err != nil {
		t.Fatalf("doctor login: %v", err)
	}
	fx.docT = docOut["token"].(string)

	fx.svc = &Service{DB: pool}
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(middleware.RequestID())
	h := NewHandler(fx.svc, iss, middleware.NewDBResolver(pool), dispatchKey)
	v1 := e.Group("/api/v1")
	h.Register(v1)
	fx.engine = e
	return fx
}

func doReq(fx *fixture, method, path, token, body, key string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if key != "" {
		req.Header.Set("x-reminder-key", key)
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

func seedNotification(t *testing.T, fx *fixture, recipientID, recipientType, typ, event string) string {
	t.Helper()
	var id string
	err := fx.pool.Inner().QueryRow(context.Background(), `INSERT INTO notifications
		(recipient_id, recipient_type, type, category, title, body, event_key)
		VALUES ($1::uuid, $2, $3, 'APPOINTMENT', 'T', 'B', $4)
		RETURNING id::text`, recipientID, recipientType, typ, event).Scan(&id)
	if err != nil {
		t.Fatalf("seed notification: %v", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = fx.pool.Inner().Exec(c, "DELETE FROM notifications WHERE id = $1::uuid", id)
	})
	return id
}

func TestFeedAndCounts(t *testing.T) {
	fx := setup(t, "k")
	seedNotification(t, fx, fx.pat, "patient", "APPOINTMENT_BOOKED", "evt-feed-1")
	seedNotification(t, fx, fx.pat, "patient", "APPOINTMENT_CONFIRMED", "evt-feed-2")

	w := doReq(fx, "GET", "/api/v1/patients/me/notifications?page=1&perPage=10", fx.patT, "", "")
	env := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("feed: %d %s", w.Code, w.Body.String())
	}
	var feed struct {
		Items       []map[string]any `json:"items"`
		Pagination  map[string]any   `json:"pagination"`
		UnreadCount int              `json:"unread_count"`
	}
	_ = json.Unmarshal(env.Data, &feed)
	if len(feed.Items) != 2 || feed.UnreadCount != 2 {
		t.Errorf("feed = %+v", feed)
	}
	// Status filter narrows; other patient's rows invisible.
	w = doReq(fx, "GET", "/api/v1/patients/me/notifications?status=read", fx.patT, "", "")
	var filtered struct {
		Items []map[string]any `json:"items"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &filtered)
	if len(filtered.Items) != 0 {
		t.Errorf("read filter = %d, want 0", len(filtered.Items))
	}
	w = doReq(fx, "GET", "/api/v1/patients/me/notifications", fx.pat2T, "", "")
	var other struct {
		Items []map[string]any `json:"items"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &other)
	if len(other.Items) != 0 {
		t.Error("cross-patient feed leak")
	}
	w = doReq(fx, "GET", "/api/v1/patients/me/notifications/unread-count", fx.patT, "", "")
	var unread map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &unread)
	if unread["unread"] != float64(2) {
		t.Errorf("unread = %+v", unread)
	}
}

func TestMarkAndDelete(t *testing.T) {
	fx := setup(t, "k")
	id := seedNotification(t, fx, fx.pat, "patient", "APPOINTMENT_BOOKED", "evt-mark-1")

	w := doReq(fx, "PATCH", "/api/v1/patients/me/notifications/"+id+"/read", fx.patT, "", "")
	if w.Code != 200 {
		t.Fatalf("mark read: %d", w.Code)
	}
	w = doReq(fx, "GET", "/api/v1/patients/me/notifications/unread-count", fx.patT, "", "")
	var unread map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &unread)
	if unread["unread"] != float64(0) {
		t.Errorf("unread after mark = %+v", unread)
	}
	// Foreign mark → 404.
	w = doReq(fx, "PATCH", "/api/v1/patients/me/notifications/"+id+"/read", fx.pat2T, "", "")
	if w.Code != 404 {
		t.Errorf("foreign mark: got %d, want 404", w.Code)
	}
	// Mark all + delete.
	seedNotification(t, fx, fx.pat, "patient", "APPOINTMENT_BOOKED", "evt-mark-2")
	w = doReq(fx, "PATCH", "/api/v1/patients/me/notifications/read-all", fx.patT, "", "")
	var marked map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &marked)
	if marked["modified"] != float64(1) {
		t.Errorf("mark all = %+v", marked)
	}
	w = doReq(fx, "DELETE", "/api/v1/patients/me/notifications/"+id, fx.patT, "", "")
	var deleted map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &deleted)
	if deleted["deleted"] != true {
		t.Errorf("delete = %+v", deleted)
	}
	w = doReq(fx, "DELETE", "/api/v1/patients/me/notifications/"+id, fx.patT, "", "")
	if w.Code != 404 {
		t.Errorf("double delete: got %d, want 404", w.Code)
	}
}

func TestDispatch(t *testing.T) {
	fx := setup(t, "dispatch-key")
	ctx := context.Background()

	// Disabled without key.
	w := doReq(fx, "POST", "/api/v1/internal/reminders/dispatch", "", "", "")
	if w.Code != 403 {
		t.Errorf("no key: got %d, want 403", w.Code)
	}
	fxNoKey := setup(t, "")
	w = doReq(fxNoKey, "POST", "/api/v1/internal/reminders/dispatch", "", "", "anything")
	if w.Code != 403 {
		t.Errorf("unset key: got %d, want 403", w.Code)
	}
	// Wrong key.
	w = doReq(fx, "POST", "/api/v1/internal/reminders/dispatch", "", "", "wrong")
	if w.Code != 403 {
		t.Errorf("wrong key: got %d, want 403", w.Code)
	}

	// Due appointment: starts in 30 minutes (1h window only).
	var apptID string
	err := fx.pool.Inner().QueryRow(ctx, `INSERT INTO appointments
		(appointment_number, patient_id, doctor_id, scheduled_start_at_utc, scheduled_end_at_utc,
		 timezone_snapshot, status, appointment_for, reason_for_visit)
		VALUES ('APT-N-' || left(md5(random()::text), 6),
		 (SELECT id FROM patients WHERE email LIKE 'npat-%' LIMIT 1),
		 (SELECT id FROM doctors WHERE email LIKE 'ndoc-%' LIMIT 1),
		 now() + interval '30 minutes', now() + interval '60 minutes',
		 'UTC', 'CONFIRMED', 'SELF', 'Checkup')
		RETURNING id::text`).Scan(&apptID)
	if err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = fx.pool.Inner().Exec(c, "DELETE FROM notifications WHERE appointment_id = $1::uuid", apptID)
		_, _ = fx.pool.Inner().Exec(c, "DELETE FROM appointments WHERE id = $1::uuid", apptID)
	})

	w = doReq(fx, "POST", "/api/v1/internal/reminders/dispatch", "", "", "dispatch-key")
	env := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("dispatch: %d %s", w.Code, w.Body.String())
	}
	var result map[string]any
	_ = json.Unmarshal(env.Data, &result)
	if result["dispatched_1h"] != float64(1) {
		t.Errorf("dispatch counts = %+v, want our 1h claim", result)
	}
	// A 30-min-out appointment is inside BOTH windows, so both offsets
	// fire once per party (4 rows); rerun adds nothing (claim + dedupe).
	var rows []struct {
		typ, recipient string
	}
	rows = queryReminderRows(t, fx, apptID)
	if len(rows) != 4 {
		t.Errorf("reminder rows = %d, want 4 (24h+1h × patient+doctor)", len(rows))
	}
	w = doReq(fx, "POST", "/api/v1/internal/reminders/dispatch", "", "", "dispatch-key")
	_ = decode(t, w)
	if rows2 := queryReminderRows(t, fx, apptID); len(rows2) != 4 {
		t.Errorf("rerun rows = %d, want still 4", len(rows2))
	}
	// 24h claim: appointment 23h out is inside the 24h window only.
	var appt2 string
	err = fx.pool.Inner().QueryRow(ctx, `INSERT INTO appointments
		(appointment_number, patient_id, doctor_id, scheduled_start_at_utc, scheduled_end_at_utc,
		 timezone_snapshot, status, appointment_for, reason_for_visit)
		VALUES ('APT-N2-' || left(md5(random()::text), 6),
		 (SELECT id FROM patients WHERE email LIKE 'npat-%' LIMIT 1),
		 (SELECT id FROM doctors WHERE email LIKE 'ndoc-%' LIMIT 1),
		 now() + interval '23 hours', now() + interval '23 hours' + interval '30 minutes',
		 'UTC', 'CONFIRMED', 'SELF', 'Checkup')
		RETURNING id::text`).Scan(&appt2)
	if err != nil {
		t.Fatalf("seed appointment 2: %v", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = fx.pool.Inner().Exec(c, "DELETE FROM notifications WHERE appointment_id = $1::uuid", appt2)
		_, _ = fx.pool.Inner().Exec(c, "DELETE FROM appointments WHERE id = $1::uuid", appt2)
	})
	w = doReq(fx, "POST", "/api/v1/internal/reminders/dispatch", "", "", "dispatch-key")
	if w.Code != 200 {
		t.Fatalf("dispatch 24h: %d", w.Code)
	}
	// 23h-out: 24h rows only (patient + doctor), no 1h rows.
	var n24, n1 int
	_ = fx.pool.Inner().QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE appointment_id = $1::uuid
		 AND type = 'APPOINTMENT_REMINDER_24H'`, appt2).Scan(&n24)
	_ = fx.pool.Inner().QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE appointment_id = $1::uuid
		 AND type = 'APPOINTMENT_REMINDER_1H'`, appt2).Scan(&n1)
	if n24 != 2 || n1 != 0 {
		t.Errorf("23h rows: 24h=%d 1h=%d, want 2/0", n24, n1)
	}
}

func queryReminderRows(t *testing.T, fx *fixture, apptID string) []struct {
	typ, recipient string
} {
	t.Helper()
	rows, err := fx.pool.Inner().Query(context.Background(),
		`SELECT type, recipient_type FROM notifications WHERE appointment_id = $1::uuid`, apptID)
	if err != nil {
		t.Fatalf("query rows: %v", err)
	}
	defer rows.Close()
	var out []struct {
		typ, recipient string
	}
	for rows.Next() {
		var r struct {
			typ, recipient string
		}
		if err := rows.Scan(&r.typ, &r.recipient); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, r)
	}
	return out
}
