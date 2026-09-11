package config

import (
	"fmt"
	"strings"
	"testing"
)

// TestRedactedLeaksNoSecrets fills every secret field with a marker and
// asserts none of it appears in the log-safe summary.
func TestRedactedLeaksNoSecrets(t *testing.T) {
	c := Config{
		Port: 4000, Environment: "test",
		DatabaseURL: "postgres://sekret:pw@host/db",
		JWTSecret:   "sekret-jwt", JWTRefreshSecret: "sekret-refresh",
		RegTokenSecret: "sekret-reg", ResetTokenSecret: "sekret-reset",
		EmailUser: "sekret-user", EmailPassword: "sekret-pw",
		GoogleClientID: "sekret-gid", GoogleClientSecret: "sekret-gsecret",
		AdminBootstrapKey: "sekret-boot", ReminderDispatchKey: "sekret-dispatch",
		DailyAPIKey:         "sekret-daily",
		CloudinaryAPIKey:    "sekret-ckey",
		CloudinaryAPISecret: "sekret-csecret",
	}
	dump := fmt.Sprintf("%v", c.Redacted())
	for _, marker := range []string{
		"sekret:pw", "sekret-jwt", "sekret-refresh", "sekret-reg",
		"sekret-reset", "sekret-user", "sekret-pw", "sekret-gid",
		"sekret-gsecret", "sekret-boot", "sekret-dispatch",
		"sekret-daily", "sekret-ckey", "sekret-csecret",
	} {
		if strings.Contains(dump, marker) {
			t.Errorf("redacted summary leaks %q: %s", marker, dump)
		}
	}
}
