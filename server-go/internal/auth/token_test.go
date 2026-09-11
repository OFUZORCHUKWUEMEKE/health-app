package auth

import (
	"testing"
	"time"
)

func testIssuer(t *testing.T) *Issuer {
	t.Helper()
	iss, err := NewIssuer(IssuerConfig{
		JWTSecret:        "access-secret-for-tests-only",
		JWTRefreshSecret: "refresh-secret-for-tests-only",
	})
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	return iss
}

func TestSessionTokenRoundtrip(t *testing.T) {
	iss := testIssuer(t)
	access, err := iss.GenerateAccess("user-1", "a@example.com", RolePatient)
	if err != nil {
		t.Fatalf("GenerateAccess: %v", err)
	}
	c, err := iss.VerifyAccess(access)
	if err != nil {
		t.Fatalf("VerifyAccess: %v", err)
	}
	if c.Subject != "user-1" || c.Email != "a@example.com" || c.Role != RolePatient {
		t.Errorf("claims = %+v, want sub/email/role", c)
	}

	refresh, err := iss.GenerateRefresh("user-1", "a@example.com", RolePatient)
	if err != nil {
		t.Fatalf("GenerateRefresh: %v", err)
	}
	if _, err := iss.VerifyRefresh(refresh); err != nil {
		t.Fatalf("VerifyRefresh: %v", err)
	}
	// Cross-type verification must fail (different secrets).
	if _, err := iss.VerifyAccess(refresh); err == nil {
		t.Error("refresh token verified as access, want failure")
	}
	if _, err := iss.VerifyRefresh(access); err == nil {
		t.Error("access token verified as refresh, want failure")
	}
}

func TestOneTimeTokens(t *testing.T) {
	iss := testIssuer(t)
	tok, jti, err := iss.GenerateRegistration("n@example.com")
	if err != nil {
		t.Fatalf("GenerateRegistration: %v", err)
	}
	if jti == "" {
		t.Error("empty jti")
	}
	c, err := iss.VerifyRegistration(tok)
	if err != nil {
		t.Fatalf("VerifyRegistration: %v", err)
	}
	if c.Email != "n@example.com" || c.Purpose != PurposeRegistration || c.ID != jti {
		t.Errorf("claims = %+v", c)
	}
	// Purpose confusion must fail.
	if _, err := iss.VerifyReset(tok); err == nil {
		t.Error("registration token verified as reset, want failure")
	}

	rst, _, err := iss.GenerateReset("n@example.com")
	if err != nil {
		t.Fatalf("GenerateReset: %v", err)
	}
	if _, err := iss.VerifyReset(rst); err != nil {
		t.Fatalf("VerifyReset: %v", err)
	}
	if _, err := iss.VerifyRegistration(rst); err == nil {
		t.Error("reset token verified as registration, want failure")
	}
}

func TestExpiredAndTampered(t *testing.T) {
	iss := testIssuer(t)
	iss.AccessTTL = -time.Minute // already expired
	tok, err := iss.GenerateAccess("u", "e", RoleDoctor)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if _, err := iss.VerifyAccess(tok); err != ErrExpired {
		t.Errorf("expired err = %v, want ErrExpired", err)
	}

	iss.AccessTTL = time.Hour
	tok, _ = iss.GenerateAccess("u", "e", RoleDoctor)
	bad := tok[:len(tok)-2] + "xx"
	if _, err := iss.VerifyAccess(bad); err != ErrInvalid {
		t.Errorf("tampered err = %v, want ErrInvalid", err)
	}

	other := testIssuer(t)
	other.AccessSecret = "different-secret"
	if _, err := other.VerifyAccess(tok); err == nil {
		t.Error("wrong-secret token verified, want failure")
	}
}

func TestMissingRoleClaim(t *testing.T) {
	iss := testIssuer(t)
	// Token without role (e.g. legacy) — middleware rejects; verify parse works.
	tok, err := sign(Claims{Email: "e"}, iss.AccessSecret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	c, err := iss.VerifyAccess(tok)
	if err != nil {
		t.Fatalf("VerifyAccess: %v", err)
	}
	if c.Role != "" {
		t.Errorf("role = %q, want empty", c.Role)
	}
}

func TestParseDuration(t *testing.T) {
	cases := map[string]time.Duration{
		"15m": 15 * time.Minute,
		"24h": 24 * time.Hour,
		"7d":  7 * 24 * time.Hour,
		"90d": 90 * 24 * time.Hour,
		"30s": 30 * time.Second,
	}
	for in, want := range cases {
		got, err := ParseDuration(in)
		if err != nil || got != want {
			t.Errorf("ParseDuration(%q) = %v, %v; want %v", in, got, err, want)
		}
	}
	if _, err := ParseDuration("bogus"); err == nil {
		t.Error("bogus duration parsed, want error")
	}
}

func TestPasswordAndTokenHashing(t *testing.T) {
	h, err := HashPassword("StrongPass123!")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !ComparePassword("StrongPass123!", h) {
		t.Error("correct password rejected")
	}
	if ComparePassword("wrong", h) {
		t.Error("wrong password accepted")
	}

	th, err := HashToken("refresh.plaintext.token")
	if err != nil {
		t.Fatalf("HashToken: %v", err)
	}
	if !CompareToken("refresh.plaintext.token", th) {
		t.Error("correct token rejected")
	}
	if CompareToken("other", th) {
		t.Error("wrong token accepted")
	}

	oh, err := HashOTP("123456")
	if err != nil {
		t.Fatalf("HashOTP: %v", err)
	}
	if !CompareOTP("123456", oh) || CompareOTP("654321", oh) {
		t.Error("OTP compare wrong")
	}
}

func TestIssuerRequiresSecrets(t *testing.T) {
	if _, err := NewIssuer(IssuerConfig{}); err == nil {
		t.Error("empty secrets accepted, want error")
	}
}
