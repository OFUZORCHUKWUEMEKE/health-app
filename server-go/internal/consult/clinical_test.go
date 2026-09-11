package consult

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/mail"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/testdb"
	)

type cfx struct {
	engine *gin.Engine
	pool   *postgres.Pool
	issuer *auth.Issuer
	docT   string
	doc    string
	doc2T  string
	patT   string
	pat    string
	cid    string
}

// fakeConsultFiles stands in for Cloudinary: deterministic URLs, no creds.
type fakeConsultFiles struct{}

func (fakeConsultFiles) UploadProfileImage(_ context.Context, _ []byte, _, _, _ string) (string, error) {
	return "https://fake.cloudinary/pic.png", nil
}

func (fakeConsultFiles) UploadInvestigationImage(_ context.Context, _ []byte, _, _ string, listID string) (string, error) {
	return "https://fake.cloudinary/inv/" + listID + ".png", nil
}

func csetup(t *testing.T) *cfx {
	t.Helper()
	pool := testdb.Setup(t)
	iss, err := auth.NewIssuer(auth.IssuerConfig{
		JWTSecret: "k-access", JWTRefreshSecret: "k-refresh",
	})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	authSvc := &auth.Service{
		DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy: mail.NewCopy(),
		FrontendURL: "http://x", IncludeOTP: true,
	}
	fx := &cfx{pool: pool, issuer: iss}
	ctx := context.Background()
	mk := func(prefix, role string) (tok, id, key string) {
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
			key = "doctor"
		default:
			if _, err := authSvc.PatientSignup(ctx, "Pat", "One", "", email, "StrongPass123!"); err != nil {
				t.Fatalf("patient signup: %v", err)
			}
			out, err = authSvc.Login(ctx, auth.RolePatient, email, "StrongPass123!")
			id = out["user"].(map[string]any)["_id"].(string)
			key = "user"
		}
		if err != nil {
			t.Fatalf("login: %v", err)
		}
		_ = key
		return out["token"].(string), id, key
	}
	fx.docT, fx.doc, _ = mk("kdoc", auth.RoleDoctor)
	fx.doc2T, _, _ = mk("kdoc2", auth.RoleDoctor)
	fx.patT, fx.pat, _ = mk("kpat", auth.RolePatient)

	// CONFIRMED appointment + started workspace.
	var apptID string
	err = pool.Inner().QueryRow(ctx, `INSERT INTO appointments
		(appointment_number, patient_id, doctor_id, scheduled_start_at_utc, scheduled_end_at_utc,
		 timezone_snapshot, status, appointment_for, reason_for_visit)
		VALUES ('APT-K-' || left(md5(random()::text), 6), $1::uuid, $2::uuid,
		 now() + interval '1 day', now() + interval '1 day' + interval '30 min',
		 'UTC', 'CONFIRMED', 'SELF', 'Checkup')
		RETURNING id::text`, fx.pat, fx.doc).Scan(&apptID)
	if err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Inner().Exec(c, "DELETE FROM consultations WHERE appointment_id = $1::uuid", apptID)
		_, _ = pool.Inner().Exec(c, "DELETE FROM appointments WHERE id = $1::uuid", apptID)
	})

	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(middleware.RequestID())
	h := NewHandler(&Service{DB: pool, Files: &fakeConsultFiles{}}, iss, middleware.NewDBResolver(pool))
	v1 := e.Group("/api/v1")
	h.Register(v1)
	fx.engine = e

	w := doCReq(fx, "POST", "/api/v1/doctors/consultations/appointments/"+apptID+"/start", fx.docT, `{}`)
	if w.Code != 201 {
		t.Fatalf("start workspace: %d %s", w.Code, w.Body.String())
	}
	var m map[string]any
	_ = json.Unmarshal(decodeC(t, w).Data, &m)
	fx.cid = m["_id"].(string)
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Inner().Exec(c, "DELETE FROM consultations WHERE id = $1::uuid", fx.cid)
	})
	return fx
}

func doCReq(fx *cfx, method, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	fx.engine.ServeHTTP(w, req)
	return w
}

func decodeC(t *testing.T, w *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("not an envelope: %v (%s)", err, w.Body.String())
	}
	return env
}

func dataMapC(t *testing.T, env envelope) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(env.Data, &m); err != nil {
		t.Fatalf("data not object: %v", err)
	}
	return m
}

func TestMedicationLifecycle(t *testing.T) {
	fx := csetup(t)

	body := `{"medications":[
		{"formulary":"TABLET","medication":"Paracetamol","dose":500,"unit":"MILLIGRAM","interval":"DAILY","duration":5,"duration_unit":"DAY","assign_to_patient":true},
		{"formulary":"SYRUP","medication":"Cough Relief","dose":10,"unit":"MLS","interval":"DAILY","duration":7,"duration_unit":"DAY"}]}`
	w := doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/medication", fx.docT, body)
	env := decodeC(t, w)
	if w.Code != 201 {
		t.Fatalf("create meds: %d %s", w.Code, w.Body.String())
	}
	var created []map[string]any
	_ = json.Unmarshal(env.Data, &created)
	if len(created) != 2 {
		t.Fatalf("created = %d", len(created))
	}
	mid := created[0]["_id"].(string)

	// One notification for the batch (never drug names).
	var n int
	_ = fx.pool.Inner().QueryRow(context.Background(),
		`SELECT count(*) FROM notifications WHERE consultation_id = $1::uuid
		 AND type = 'PRESCRIPTION_READY'`, fx.cid).Scan(&n)
	if n != 1 {
		t.Errorf("prescription notifications = %d, want 1", n)
	}
	var titleBody string
	_ = fx.pool.Inner().QueryRow(context.Background(),
		`SELECT title || ' ' || body FROM notifications WHERE consultation_id = $1::uuid
		 AND type = 'PRESCRIPTION_READY'`, fx.cid).Scan(&titleBody)
	if strings.Contains(titleBody, "Paracetamol") {
		t.Errorf("notification leaks drug name: %q", titleBody)
	}

	// Get / update / delete with ownership.
	w = doCReq(fx, "GET", "/api/v1/doctors/consultations/medication/"+mid, fx.docT, "")
	if w.Code != 200 {
		t.Errorf("get med: %d", w.Code)
	}
	w = doCReq(fx, "PATCH", "/api/v1/doctors/consultations/medication/"+mid, fx.docT, `{"status":"STOPPED"}`)
	if dataMapC(t, decodeC(t, w))["status"] != "STOPPED" {
		t.Error("status not updated")
	}
	w = doCReq(fx, "GET", "/api/v1/doctors/consultations/medication/"+mid, fx.doc2T, "")
	if w.Code != 401 {
		t.Errorf("foreign doctor read: got %d, want 401", w.Code)
	}
	w = doCReq(fx, "DELETE", "/api/v1/doctors/consultations/medication/"+mid, fx.docT, "")
	if w.Code != 200 {
		t.Errorf("delete med: %d", w.Code)
	}

	// Grouped-by-consultation for the doctor.
	w = doCReq(fx, "GET", "/api/v1/doctors/consultations/medications/grouped-by-consultation", fx.docT, "")
	var grouped map[string]any
	_ = json.Unmarshal(decodeC(t, w).Data, &grouped)
	if grouped["groups"] == nil || grouped["pagination"] == nil {
		t.Errorf("grouped shape = %+v", grouped)
	}
	// Patient formulary grouping still sees the remaining med.
	w = doCReq(fx, "GET", "/api/v1/patients/consultations/"+fx.cid+"/medications/grouped", fx.patT, "")
	var fg map[string]any
	_ = json.Unmarshal(decodeC(t, w).Data, &fg)
	if fg["total"] != float64(1) {
		t.Errorf("formulary total = %v", fg["total"])
	}
}

func TestInvestigationListDupesAndNotify(t *testing.T) {
	fx := csetup(t)

	body := `{"investigations":[
		{"category":"Hematological","test_requested":"CBC","priority":"Routine","specimen":"Blood"}],
		"assign_to_patient":true}`
	w := doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/investigation-list", fx.docT, body)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	// Same test again unassigned → 409 pending-duplicate... but our row IS
	// assigned; pending means assign_to_patient=false. Create unassigned first.
	w = doReqUnassigned(t, fx)
	_ = w
}

func doReqUnassigned(t *testing.T, fx *cfx) *httptest.ResponseRecorder {
	body := `{"investigations":[{"category":"Radiology","test_requested":"X-Ray"}]}`
	w := doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/investigation-list", fx.docT, body)
	if w.Code != 201 {
		t.Fatalf("unassigned create: %d %s", w.Code, w.Body.String())
	}
	// Duplicate within one request → 409.
	w = doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/investigation-list", fx.docT,
		`{"investigations":[
			{"category":"Radiology","test_requested":"MRI"},
			{"category":"radiology","test_requested":"mri"}]}`)
	env := decodeC(t, w)
	if w.Code != 409 {
		t.Errorf("in-request dupe: got %d %+v", w.Code, env)
	}
	// Same test while a pending (unassigned) row exists → 409.
	w = doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/investigation-list", fx.docT,
		`{"investigations":[{"category":"Radiology","test_requested":"X-Ray"}]}`)
	env = decodeC(t, w)
	if w.Code != 409 || !strings.Contains(env.ResponseDescription, "has not been sent to the patient yet") {
		t.Errorf("pending dupe: got %d %+v", w.Code, env)
	}
	// Assigned batch emitted exactly one notification.
	var n int
	_ = fx.pool.Inner().QueryRow(context.Background(),
		`SELECT count(*) FROM notifications WHERE consultation_id = $1::uuid
		 AND type = 'INVESTIGATIONS_REQUESTED'`, fx.cid).Scan(&n)
	if n != 1 {
		t.Errorf("investigation notifications = %d, want 1", n)
	}
	return w
}

func TestReferralAndCompliant(t *testing.T) {
	fx := csetup(t)

	body := `{"specialist_name":"Dr Smith","hospital":"General Hospital",
		"referral_details":"Needs cardiology review","assign_to_patient":true}`
	w := doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/referral", fx.docT, body)
	if w.Code != 201 {
		t.Fatalf("referral: %d %s", w.Code, w.Body.String())
	}
	rid := dataMapC(t, decodeC(t, w))["_id"].(string)
	var n int
	_ = fx.pool.Inner().QueryRow(context.Background(),
		`SELECT count(*) FROM notifications WHERE consultation_id = $1::uuid
		 AND type = 'REFERRAL_AVAILABLE'`, fx.cid).Scan(&n)
	if n != 1 {
		t.Errorf("referral notifications = %d, want 1", n)
	}
	// Patient reads their referral; another patient's token cannot.
	w = doCReq(fx, "GET", "/api/v1/patients/consultations/referrals/"+rid, fx.patT, "")
	if w.Code != 200 {
		t.Errorf("patient referral read: %d", w.Code)
	}
	w = doCReq(fx, "GET", "/api/v1/doctors/consultations/referral/"+rid, fx.doc2T, "")
	if w.Code != 401 {
		t.Errorf("foreign referral read: got %d, want 401", w.Code)
	}
	// Doctor grouped referrals.
	w = doCReq(fx, "GET", "/api/v1/doctors/consultations/referrals/grouped", fx.docT, "")
	var grouped map[string]any
	_ = json.Unmarshal(decodeC(t, w).Data, &grouped)
	if grouped["groups"] == nil {
		t.Error("referral groups missing")
	}

	// Compliant history: 201s preserved.
	w = doCReq(fx, "POST", "/api/v1/patients/consultations/compliant-history/"+fx.cid, fx.patT,
		`{"past_medical_history":"Asthma since childhood"}`)
	if w.Code != 201 {
		t.Fatalf("compliant create: %d %s", w.Code, w.Body.String())
	}
	hid := dataMapC(t, decodeC(t, w))["_id"].(string)
	w = doCReq(fx, "GET", "/api/v1/patients/consultations/compliant-history/"+fx.cid, fx.patT, "")
	if w.Code != 201 {
		t.Errorf("compliant get: got %d, want 201", w.Code)
	}
	w = doCReq(fx, "DELETE", "/api/v1/patients/consultations/compliant-history/"+hid, fx.patT, "")
	if w.Code != 201 {
		t.Errorf("compliant delete: got %d, want 201", w.Code)
	}
}

func TestHistoryTakingSingleton(t *testing.T) {
	fx := csetup(t)

	w := doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/history-taking", fx.docT, `{}`)
	if w.Code != 400 {
		t.Errorf("missing complaint: got %d, want 400", w.Code)
	}
	w = doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/history-taking", fx.docT,
		`{"present_complaint":"Persistent cough","status":"COMPLETED"}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	hid := dataMapC(t, decodeC(t, w))["_id"].(string)
	w = doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/history-taking", fx.docT,
		`{"present_complaint":"Again"}`)
	env := decodeC(t, w)
	if w.Code != 409 {
		t.Errorf("duplicate: got %d %+v", w.Code, env)
	}
	w = doCReq(fx, "GET", "/api/v1/doctors/consultations/"+fx.cid+"/history-taking", fx.docT, "")
	if w.Code != 200 {
		t.Errorf("get: %d", w.Code)
	}
	w = doCReq(fx, "PATCH", "/api/v1/doctors/consultations/history-taking/"+hid, fx.docT,
		`{"social_history":"Non-smoker"}`)
	if dataMapC(t, decodeC(t, w))["present_complaint"] != "Persistent cough" {
		t.Error("patch clobbered untouched fields")
	}
	w = doCReq(fx, "PATCH", "/api/v1/doctors/consultations/history-taking/"+hid, fx.doc2T,
		`{"social_history":"x"}`)
	if w.Code != 401 {
		t.Errorf("foreign update: got %d, want 401", w.Code)
	}
	w = doCReq(fx, "DELETE", "/api/v1/doctors/consultations/history-taking/"+hid, fx.docT, "")
	if w.Code != 200 {
		t.Errorf("delete: %d", w.Code)
	}
}

func TestUploadFlowUnconfigured(t *testing.T) {
	fx := csetup(t)
	w := doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/investigation-list", fx.docT,
		`{"investigations":[{"category":"Lab","test_requested":"CBC"}],"assign_to_patient":true}`)
	var created []map[string]any
	_ = json.Unmarshal(decodeC(t, w).Data, &created)
	lid := created[0]["_id"].(string)

	blob := []files.Upload{{Data: []byte("scan"), ContentType: "image/png", Filename: "scan.png"}}

	// Nil provider (and Disabled) → controlled 503, nothing stored.
	for _, svc := range []*Service{{DB: fx.pool}, {DB: fx.pool, Files: files.Disabled{}}} {
		if _, err := svc.UploadInvestigationImages(context.Background(), fx.pat, lid, blob); err == nil {
			t.Error("unconfigured upload must fail")
		} else if serr, ok := err.(*auth.Error); !ok || serr.Status != 503 {
			t.Errorf("unconfigured: got %v, want 503", err)
		}
	}

	// Provider failure → 500 with the Nest message.
	svc := &Service{DB: fx.pool, Files: &files.Fake{Err: errFakeBoom}}
	if _, err := svc.UploadInvestigationImages(context.Background(), fx.pat, lid, blob); err == nil {
		t.Error("failed upload must fail")
	} else if serr, ok := err.(*auth.Error); !ok || serr.Status != 500 || serr.Message != "Failed to upload image to Cloudinary" {
		t.Errorf("provider failure: got %v", err)
	}

	var n int
	_ = fx.pool.Inner().QueryRow(context.Background(),
		`SELECT count(*) FROM notifications WHERE consultation_id = $1::uuid
		 AND type = 'INVESTIGATION_RESULTS_UPLOADED'`, fx.cid).Scan(&n)
	if n != 0 {
		t.Errorf("failed uploads must not notify: %d rows", n)
	}
}

var errFakeBoom = errBoom{}

type errBoom struct{}

func (errBoom) Error() string { return "boom" }

func TestUploadFlow(t *testing.T) {
	fx := csetup(t)
	w := doCReq(fx, "POST", "/api/v1/doctors/consultations/"+fx.cid+"/investigation-list", fx.docT,
		`{"investigations":[{"category":"Lab","test_requested":"Glucose"}],"assign_to_patient":true}`)
	var created []map[string]any
	_ = json.Unmarshal(decodeC(t, w).Data, &created)
	lid := created[0]["_id"].(string)

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("files", "result.png")
	_, _ = fw.Write([]byte("png-bytes"))
	fw2, _ := mw.CreateFormFile("files", "result2.png")
	_, _ = fw2.Write([]byte("more-bytes"))
	mw.Close()
	req := httptest.NewRequest(http.MethodPatch,
		"/api/v1/patients/consultations/investigation-list/"+lid+"/upload", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+fx.patT)
	rec := httptest.NewRecorder()
	fx.engine.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var m map[string]any
	_ = json.Unmarshal(decodeC(t, rec).Data, &m)
	imgs, _ := m["result_images"].([]any)
	if len(imgs) != 2 {
		t.Fatalf("images = %v, want 2 uploaded URLs", m["result_images"])
	}
	for _, u := range imgs {
		s, _ := u.(string)
		if s != "https://fake.cloudinary/inv/"+lid+".png" {
			t.Errorf("image = %q, want provider URL", s)
		}
	}
	var n int
	_ = fx.pool.Inner().QueryRow(context.Background(),
		`SELECT count(*) FROM notifications WHERE consultation_id = $1::uuid
		 AND type = 'INVESTIGATION_RESULTS_UPLOADED'`, fx.cid).Scan(&n)
	if n != 1 {
		t.Errorf("upload notifications = %d, want 1", n)
	}
}
