package postgres

import (
	"strings"
	"testing"
	"time"
)

func TestSlowQueryThreshold(t *testing.T) {
	t.Setenv("SLOW_QUERY_MS", "")
	if got := slowQueryThreshold(); got != 500*time.Millisecond {
		t.Errorf("default = %v, want 500ms", got)
	}
	t.Setenv("SLOW_QUERY_MS", "1500")
	if got := slowQueryThreshold(); got != 1500*time.Millisecond {
		t.Errorf("custom = %v, want 1.5s", got)
	}
	t.Setenv("SLOW_QUERY_MS", "0")
	if got := slowQueryThreshold(); got != 0 {
		t.Errorf("zero disables, got %v", got)
	}
	t.Setenv("SLOW_QUERY_MS", "-5")
	if got := slowQueryThreshold(); got != 0 {
		t.Errorf("negative disables, got %v", got)
	}
	t.Setenv("SLOW_QUERY_MS", "banana")
	if got := slowQueryThreshold(); got != 500*time.Millisecond {
		t.Errorf("garbage falls back to default, got %v", got)
	}
}

func TestShouldLogSlow(t *testing.T) {
	if !shouldLogSlow(600*time.Millisecond, 500*time.Millisecond) {
		t.Error("breach must log")
	}
	if shouldLogSlow(100*time.Millisecond, 500*time.Millisecond) {
		t.Error("under threshold must not log")
	}
	if shouldLogSlow(time.Hour, 0) {
		t.Error("disabled threshold must never log")
	}
}

func TestTruncateSQL(t *testing.T) {
	if got := truncateSQL("SELECT  1\n  FROM  t"); got != "SELECT 1 FROM t" {
		t.Errorf("whitespace not collapsed: %q", got)
	}
	long := strings.Repeat("x", 3000)
	if got := truncateSQL(long); len(got) >= 3000 {
		t.Errorf("long statement not capped: len=%d", len(got))
	}
}

func TestNilPoolStatsAreZero(t *testing.T) {
	var p *Pool
	for k, v := range p.Stats() {
		if n, ok := v.(int); !ok || n != 0 {
			t.Errorf("nil pool %s = %v, want 0", k, v)
		}
	}
}
