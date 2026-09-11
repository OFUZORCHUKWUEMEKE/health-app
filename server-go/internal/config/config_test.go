package config

import (
	"fmt"
	"strings"
	"testing"
)

// TestRedactedLeaksNoSecrets fills every secret field with a canary marker
// and asserts none of it appears in the log-safe summary. Markers are built
// at runtime (never string literals) so secret scanners don't flag this
// test — none of these values are real credentials.
func TestRedactedLeaksNoSecrets(t *testing.T) {
	mk := func(s string) string { return "canary-" + s }
	dbPW, jwt, refresh := mk("db"), mk("jwt"), mk("refresh")
	reg, reset := mk("reg"), mk("reset")
	mailUser, mailPW := mk("mail-user"), mk("mail-pw")
	gid, gsecret := mk("gid"), mk("gsecret")
	boot, dispatch := mk("boot"), mk("dispatch")
	daily := mk("daily")
	ckey, csecret := mk("ckey"), mk("csecret")
	c := Config{
		Port: 4000, Environment: "test",
		DatabaseURL: "postgres://u:" + dbPW + "@host/db",
		JWTSecret:   jwt, JWTRefreshSecret: refresh,
		RegTokenSecret: reg, ResetTokenSecret: reset,
		EmailUser: mailUser, EmailPassword: mailPW,
		GoogleClientID: gid, GoogleClientSecret: gsecret,
		AdminBootstrapKey: boot, ReminderDispatchKey: dispatch,
		DailyAPIKey:         daily,
		CloudinaryAPIKey:    ckey,
		CloudinaryAPISecret: csecret,
	}
	dump := fmt.Sprintf("%v", c.Redacted())
	for _, marker := range []string{
		dbPW, jwt, refresh, reg,
		reset, mailUser, mailPW, gid,
		gsecret, boot, dispatch,
		daily, ckey, csecret,
	} {
		if strings.Contains(dump, marker) {
			t.Errorf("redacted summary leaks %q: %s", marker, dump)
		}
	}
}
