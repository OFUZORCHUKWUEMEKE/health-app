package booking

import (
	"testing"
	"time"
)

func TestLocalToUTCEdmontonLagos(t *testing.T) {
	// Canonical contract example: 10:00 America/Edmonton → 16:00Z.
	got, err := LocalToUTC("2026-04-16T10:00:00", "America/Edmonton")
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	want := time.Date(2026, 4, 16, 16, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("got %v, want %v", got, want)
	}
	if _, err := LocalToUTC("2026-04-16T10:00:00", "MDT"); err == nil {
		t.Error("MDT accepted, want rejection")
	}
	if _, err := LocalToUTC("2026-04-16T10:00:00Z", "Africa/Lagos"); err == nil {
		t.Error("offset input accepted, want rejection")
	}
	if _, err := LocalToUTC("2026-04-16 10:00", "Africa/Lagos"); err == nil {
		t.Error("space separator accepted, want rejection")
	}
}

func TestDSTSpringForwardKeepsWallClock(t *testing.T) {
	// US DST 2026 starts Mar 8 (UTC-7 after). A 09:00 weekly slot must stay
	// 09:00 local with a shifted UTC instant.
	before, err := DateAndTimeToUTC("2026-03-07", "09:00", "America/Edmonton")
	if err != nil {
		t.Fatalf("before: %v", err)
	}
	after, err := DateAndTimeToUTC("2026-03-09", "09:00", "America/Edmonton")
	if err != nil {
		t.Fatalf("after: %v", err)
	}
	if before.Hour() != 16 || after.Hour() != 15 {
		t.Errorf("UTC hours = %d/%d, want 16/15 across spring-forward", before.Hour(), after.Hour())
	}
	if ZonedClock(after, "America/Edmonton").MinuteOfDay != 540 {
		t.Error("local wall clock moved")
	}
}

func TestDSTFallBackKeepsWallClock(t *testing.T) {
	// Nov 1 2026 transition: current tzdata keeps Edmonton at UTC-6
	// afterwards (CST, no UTC-7 winter), so the invariant under test is
	// wall-clock stability, not a particular offset.
	before, _ := DateAndTimeToUTC("2026-10-31", "09:00", "America/Edmonton")
	after, _ := DateAndTimeToUTC("2026-11-02", "09:00", "America/Edmonton")
	for _, tc := range []struct {
		name string
		tm   time.Time
	}{{"before", before}, {"after", after}} {
		parts := ZonedClock(tc.tm, "America/Edmonton")
		if parts.MinuteOfDay != 540 {
			t.Errorf("%s: local wall clock moved: %+v", tc.name, parts)
		}
	}
}

func TestDayBoundsRespectsZone(t *testing.T) {
	start, end, err := DayBoundsUTC("2026-03-20", "Africa/Lagos")
	if err != nil {
		t.Fatalf("bounds: %v", err)
	}
	// Lagos is UTC+1 with no DST: midnight local = 23:00Z previous day.
	want := time.Date(2026, 3, 19, 23, 0, 0, 0, time.UTC)
	if !start.Equal(want) || !end.Equal(want.Add(24*time.Hour)) {
		t.Errorf("bounds = %v..%v", start, end)
	}
	if ZonedClock(start, "Africa/Lagos").DayOfWeek != 5 {
		t.Errorf("Mar 20 2026 is a Friday (5), got %d", ZonedClock(start, "Africa/Lagos").DayOfWeek)
	}
}

func TestOverlapsHalfOpen(t *testing.T) {
	base := time.Date(2026, 3, 20, 10, 0, 0, 0, time.UTC)
	if !Overlaps(base, base.Add(30*time.Minute), base.Add(15*time.Minute), base.Add(45*time.Minute)) {
		t.Error("overlapping ranges not detected")
	}
	if Overlaps(base, base.Add(30*time.Minute), base.Add(30*time.Minute), base.Add(time.Hour)) {
		t.Error("touching ranges must not overlap (half-open)")
	}
}

func TestISOWeekStart(t *testing.T) {
	// 2026-01-05 is the Monday of ISO week 2, 2026.
	got := ISOWeekStart(2026, 2)
	want := time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestCandidateLocalDatesSpill(t *testing.T) {
	// A UTC day spans two Lagos-local dates at the edges.
	start := time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	dates := CandidateLocalDates(start, end, "Africa/Lagos")
	if len(dates) != 2 || dates[0] != "2026-03-20" || dates[1] != "2026-03-21" {
		t.Errorf("dates = %v", dates)
	}
}
