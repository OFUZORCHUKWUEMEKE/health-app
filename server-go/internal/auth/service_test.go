package auth

import (
	"context"
	"testing"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/mail"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
	"github.com/wizzyszn/Telemex/internal/testdb"
)

func testService(t *testing.T, pool *postgres.Pool) *Service {
	t.Helper()
	iss, err := NewIssuer(IssuerConfig{
		JWTSecret: "test-access", JWTRefreshSecret: "test-refresh",
	})
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	return &Service{
		DB: pool, Issuer: iss, Mail: mail.New(mail.Config{}),
		Copy: mail.NewCopy(),
		FrontendURL: "http://localhost:3000", IncludeOTP: true,
		RegExpLabel: "15m", ResetExpLabel: "15m",
	}
}

func svcErrStatus(err error) int {
	if e, ok := err.(*Error); ok {
		return e.Status
	}
	return 0
}

func TestFullOTPRegistrationFlow(t *testing.T) {
	pool := testdb.Setup(t)
	email_new := testdb.UniqueEmail(t, "new")
	testdb.Track(t, pool, email_new)
	svc := testService(t, pool)
	ctx := context.Background()

	init, err := svc.InitiateRegistration(ctx, email_new)
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	if init.OTP == "" || init.ExpiresInMinutes != 10 || init.CooldownSeconds != 60 {
		t.Errorf("initiate result = %+v", init)
	}
	// Immediate resend hits the cooldown.
	if _, err := svc.ResendRegistrationOTP(ctx, email_new); svcErrStatus(err) != 400 {
		t.Errorf("resend during cooldown err = %v, want 400", err)
	}
	ver, err := svc.VerifyRegistrationOTP(ctx, email_new, init.OTP)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	regToken, _ := ver["registration_token"].(string)
	done, err := svc.CompleteRegistration(ctx, regToken, "Ada", "Lovelace", "", "+1000", "StrongPass123!")
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	user, _ := done["user"].(map[string]any)
	if user["_id"] == nil || done["role"] != "patient" || done["token"] == nil || done["refresh_token"] == nil {
		t.Errorf("complete payload = %+v", done)
	}
	// Pending row consumed: verify again fails.
	if _, err := svc.VerifyRegistrationOTP(ctx, email_new, init.OTP); err == nil {
		t.Error("re-verify after complete succeeded, want failure")
	}
	// Login works.
	out, err := svc.Login(ctx, RolePatient, email_new, "StrongPass123!")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if out["token"] == nil {
		t.Error("login missing token")
	}
	// MRN claimed.
	row, _ := gen.New(pool.Inner()).GetPatientByEmail(ctx, email_new)
	if !row.Mrn.Valid || len(row.Mrn.String) != 8 || row.Mrn.String[:2] != "C-" {
		t.Errorf("mrn = %v, want C-XXXXXX", row.Mrn)
	}
}

func TestOTPAttemptsLockout(t *testing.T) {
	pool := testdb.Setup(t)
	email_lock := testdb.UniqueEmail(t, "lock")
	testdb.Track(t, pool, email_lock)
	svc := testService(t, pool)
	ctx := context.Background()

	init, err := svc.InitiateRegistration(ctx, email_lock)
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	for i := 0; i < 5; i++ {
		if _, err := svc.VerifyRegistrationOTP(ctx, email_lock, "000000"); svcErrStatus(err) != 401 {
			t.Fatalf("wrong OTP %d err = %v, want 401", i, err)
		}
	}
	if _, err := svc.VerifyRegistrationOTP(ctx, email_lock, init.OTP); svcErrStatus(err) != 403 {
		t.Errorf("6th attempt err = %v, want 403 lockout", err)
	}
}

func TestRefreshRotationAndLogout(t *testing.T) {
	pool := testdb.Setup(t)
	email_bob := testdb.UniqueEmail(t, "bob")
	testdb.Track(t, pool, email_bob)
	svc := testService(t, pool)
	ctx := context.Background()

	if _, err := svc.PatientSignup(ctx, "Bob", "Jones", "", email_bob, "StrongPass123!"); err != nil {
		t.Fatalf("signup: %v", err)
	}
	login, err := svc.Login(ctx, RolePatient, email_bob, "StrongPass123!")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	rt1 := login["refresh_token"].(string)
	rot, err := svc.Refresh(ctx, rt1, RolePatient)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if rot["accessToken"] == nil || rot["refreshToken"] == nil {
		t.Errorf("refresh payload = %+v, want camelCase pair", rot)
	}
	// Old refresh token is dead.
	if _, err := svc.Refresh(ctx, rt1, RolePatient); svcErrStatus(err) != 403 {
		t.Errorf("reused refresh err = %v, want 403", err)
	}
	// Logout kills the current refresh token.
	claims, _ := svc.Issuer.VerifyAccess(login["token"].(string))
	if _, err := svc.Logout(ctx, claims.Subject, RolePatient); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := svc.Refresh(ctx, rot["refreshToken"].(string), RolePatient); svcErrStatus(err) != 403 {
		t.Errorf("post-logout refresh err = %v, want 403", err)
	}
}

func TestForgotPasswordFlow(t *testing.T) {
	pool := testdb.Setup(t)
	email_cara := testdb.UniqueEmail(t, "cara")
	email_nobody := testdb.UniqueEmail(t, "nobody")
	testdb.Track(t, pool, email_cara, email_nobody)
	svc := testService(t, pool)
	ctx := context.Background()

	if _, err := svc.PatientSignup(ctx, "Cara", "Wu", "", email_cara, "OldPass123!"); err != nil {
		t.Fatalf("signup: %v", err)
	}
	// Unknown email: generic message, no OTP.
	unknown, err := svc.InitiateForgotPassword(ctx, email_nobody)
	if err != nil || unknown.OTP != "" {
		t.Errorf("unknown initiate = %+v, %v; want generic, no OTP", unknown, err)
	}
	init, err := svc.InitiateForgotPassword(ctx, email_cara)
	if err != nil || init.OTP == "" {
		t.Fatalf("initiate = %+v, %v", init, err)
	}
	ver, err := svc.VerifyForgotOTP(ctx, email_cara, init.OTP)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	resetToken, _ := ver["reset_token"].(string)
	if ver["reset_redirect_url"] == nil || ver["expires_in"] != "15m" {
		t.Errorf("verify payload = %+v", ver)
	}
	if _, err := svc.ResetPassword(ctx, resetToken, "NewPass123!", "mismatch"); svcErrStatus(err) != 400 {
		t.Errorf("mismatch err = %v, want 400", err)
	}
	if _, err := svc.ResetPassword(ctx, resetToken, "NewPass123!", "NewPass123!"); err != nil {
		t.Fatalf("reset: %v", err)
	}
	// Single use: same token now fails.
	if _, err := svc.ResetPassword(ctx, resetToken, "Xyz12345!", "Xyz12345!"); svcErrStatus(err) != 401 {
		t.Errorf("reuse err = %v, want 401", err)
	}
	// New password works, old does not.
	if _, err := svc.Login(ctx, RolePatient, email_cara, "NewPass123!"); err != nil {
		t.Errorf("login with new password: %v", err)
	}
	if _, err := svc.Login(ctx, RolePatient, email_cara, "OldPass123!"); svcErrStatus(err) != 401 {
		t.Errorf("login with old password err = %v, want 401", err)
	}
}

func TestDoctorAndAdminLogin(t *testing.T) {
	pool := testdb.Setup(t)
	email_doc := testdb.UniqueEmail(t, "doc")
	email_root := testdb.UniqueEmail(t, "root")
	email_xboot := testdb.UniqueEmail(t, "xboot")
	testdb.Track(t, pool, email_doc, email_root, email_xboot)
	svc := testService(t, pool)
	ctx := context.Background()

	if _, err := svc.DoctorSignup(ctx, email_doc, "Doc", "Tor", "DocPass123!", ""); err != nil {
		t.Fatalf("doctor signup: %v", err)
	}
	out, err := svc.Login(ctx, RoleDoctor, email_doc, "DocPass123!")
	if err != nil {
		t.Fatalf("doctor login: %v", err)
	}
	doc, _ := out["doctor"].(map[string]any)
	if doc["doctor_no"] == nil || out["role"] != "doctor" {
		t.Errorf("doctor payload = %+v", out)
	}
	if _, ok := doc["mrn"]; ok {
		t.Error("doctor JSON exposes mrn, want stripped")
	}
	if _, err := svc.Login(ctx, RoleDoctor, email_doc, "wrong"); svcErrStatus(err) != 401 {
		t.Errorf("wrong password err = %v, want 401", err)
	}

	// Bootstrap then admin login + refresh (admin slot persists, M5 fix).
	bs, err := svc.BootstrapAdmin(ctx, BootstrapInput{
		FirstName: "Root", LastName: "Admin", Email: email_root,
		Password: "AdminPass123!", Role: "super_admin", BootstrapKey: "k",
	}, true, "k")
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if bs["mode"] != "created" {
		t.Errorf("mode = %v, want created", bs["mode"])
	}
	bs2, err := svc.BootstrapAdmin(ctx, BootstrapInput{
		FirstName: "Root", LastName: "Admin", Email: email_root,
		Password: "AdminPass123!", BootstrapKey: "k",
	}, true, "k")
	if err != nil || bs2["mode"] != "updated" {
		t.Errorf("second bootstrap = %+v, %v; want updated", bs2, err)
	}
	if _, err := svc.BootstrapAdmin(ctx, BootstrapInput{Email: email_xboot}, false, "k"); svcErrStatus(err) != 403 {
		t.Errorf("disabled bootstrap err = %v, want 403", err)
	}
	adminOut, err := svc.Login(ctx, RoleAdmin, email_root, "AdminPass123!")
	if err != nil {
		t.Fatalf("admin login: %v", err)
	}
	if _, err := svc.Refresh(ctx, adminOut["refresh_token"].(string), RoleAdmin); err != nil {
		t.Errorf("admin refresh: %v (admin slot must persist)", err)
	}
}

func TestChangePassword(t *testing.T) {
	pool := testdb.Setup(t)
	email_dan := testdb.UniqueEmail(t, "dan")
	testdb.Track(t, pool, email_dan)
	svc := testService(t, pool)
	ctx := context.Background()

	if _, err := svc.PatientSignup(ctx, "Dan", "Lee", "", email_dan, "OldPass123!"); err != nil {
		t.Fatalf("signup: %v", err)
	}
	login, _ := svc.Login(ctx, RolePatient, email_dan, "OldPass123!")
	claims, _ := svc.Issuer.VerifyAccess(login["token"].(string))
	if _, err := svc.ChangePassword(ctx, claims.Subject, RolePatient, "OldPass123!", "OldPass123!", "OldPass123!"); svcErrStatus(err) != 400 {
		t.Errorf("same-password err = %v, want 400", err)
	}
	if _, err := svc.ChangePassword(ctx, claims.Subject, RolePatient, "wrong", "NewPass123!", "NewPass123!"); svcErrStatus(err) != 401 {
		t.Errorf("wrong current err = %v, want 401", err)
	}
	if _, err := svc.ChangePassword(ctx, claims.Subject, RolePatient, "OldPass123!", "NewPass123!", "NewPass123!"); err != nil {
		t.Fatalf("change: %v", err)
	}
	if _, err := svc.Login(ctx, RolePatient, email_dan, "NewPass123!"); err != nil {
		t.Errorf("login after change: %v", err)
	}
}
