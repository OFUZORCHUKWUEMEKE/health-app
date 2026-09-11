package booking

import (
	"testing"
	"time"
)

func mustSlots(t *testing.T, date, zone string, slots []WeeklySlot, dow int) []Slot {
	t.Helper()
	out, err := ExpandDaySlots(date, zone, slots, dow)
	if err != nil {
		t.Fatalf("expand: %v", err)
	}
	return out
}

func TestExpandHonorsDuration(t *testing.T) {
	slots := []WeeklySlot{{DayOfWeek: 5, StartTime: "09:00", EndTime: "10:00", Duration: 30, Active: true}}
	out := mustSlots(t, "2026-03-20", "Africa/Lagos", slots, 5)
	if len(out) != 2 {
		t.Fatalf("got %d slots, want 2", len(out))
	}
	if !out[0].StartUTC.Equal(time.Date(2026, 3, 20, 8, 0, 0, 0, time.UTC)) {
		t.Errorf("first slot = %v", out[0].StartUTC)
	}
	// Inactive entries and other weekdays are skipped.
	inactive := []WeeklySlot{{DayOfWeek: 5, StartTime: "09:00", EndTime: "10:00", Duration: 30, Active: false}}
	if out := mustSlots(t, "2026-03-20", "Africa/Lagos", inactive, 5); len(out) != 0 {
		t.Errorf("inactive produced %d slots", len(out))
	}
}

func TestValidateWeeklySlots(t *testing.T) {
	ok := []WeeklySlot{{DayOfWeek: 1, StartTime: "09:00", EndTime: "10:00", Duration: 30, Active: true}}
	if err := ValidateWeeklySlots(ok); err != nil {
		t.Errorf("valid rejected: %v", err)
	}
	bad := [][]WeeklySlot{
		{{DayOfWeek: 1, StartTime: "10:00", EndTime: "09:00", Duration: 30, Active: true}},
		{{DayOfWeek: 1, StartTime: "09:00", EndTime: "09:20", Duration: 30, Active: true}},
		{{DayOfWeek: 1, StartTime: "09:00", EndTime: "09:45", Duration: 30, Active: true}},
		{
			{DayOfWeek: 1, StartTime: "09:00", EndTime: "10:00", Duration: 30, Active: true},
			{DayOfWeek: 1, StartTime: "09:30", EndTime: "10:30", Duration: 30, Active: true},
		},
	}
	for i, slots := range bad {
		if err := ValidateWeeklySlots(slots); err == nil {
			t.Errorf("case %d accepted, want rejection", i)
		}
	}
}

func TestSubtractBlackoutsAndBusy(t *testing.T) {
	slots := mustSlots(t, "2026-03-20", "Africa/Lagos",
		[]WeeklySlot{{DayOfWeek: 5, StartTime: "09:00", EndTime: "11:00", Duration: 30, Active: true}}, 5)
	if len(slots) != 4 {
		t.Fatalf("setup: %d slots", len(slots))
	}
	// One-time blackout covers the second slot only.
	oneTime := []Blackout{{
		StartUTC: time.Date(2026, 3, 20, 8, 30, 0, 0, time.UTC),
		EndUTC:   time.Date(2026, 3, 20, 9, 0, 0, 0, time.UTC),
	}}
	free := SubtractBlackouts(slots, oneTime, nil, "Africa/Lagos")
	if len(free) != 3 {
		t.Errorf("one-time subtraction left %d, want 3", len(free))
	}
	// Recurring Friday 10:00-10:30 Lagos kills the last slot.
	rec := []Blackout{{
		Recurring: true, Zone: "Africa/Lagos", DayOfWeek: 5,
		StartMins: 600, EndMins: 630,
	}}
	free = SubtractBlackouts(free, nil, rec, "Africa/Lagos")
	if len(free) != 2 {
		t.Errorf("recurring subtraction left %d, want 2", len(free))
	}
	// A booked appointment kills the first slot.
	busy := []Busy{{
		StartUTC: time.Date(2026, 3, 20, 8, 0, 0, 0, time.UTC),
		EndUTC:   time.Date(2026, 3, 20, 8, 30, 0, 0, time.UTC),
	}}
	free = SubtractBusy(free, busy)
	if len(free) != 1 {
		t.Errorf("busy subtraction left %d, want 1", len(free))
	}
}

func TestMatrixBlocksFixedGrid(t *testing.T) {
	// 30-min entry still expands to 15-min blocks on the matrix path.
	slots := []WeeklySlot{{DayOfWeek: 5, StartTime: "09:00", EndTime: "10:00", Duration: 30, Active: true}}
	out, err := MatrixBlocks("2026-03-20", "Africa/Lagos", slots, 5)
	if err != nil {
		t.Fatalf("matrix: %v", err)
	}
	if len(out) != 4 {
		t.Errorf("got %d blocks, want 4", len(out))
	}
}

func TestMatchWeeklySlotAlignment(t *testing.T) {
	slots := []WeeklySlot{{DayOfWeek: 5, StartTime: "09:00", EndTime: "10:00", Duration: 30, Active: true}}
	// 09:15 is inside the window but misaligned to the 30-min interval.
	if m := MatchWeeklySlot(slots, 5, 555); m != nil {
		t.Error("misaligned minute matched")
	}
	if m := MatchWeeklySlot(slots, 5, 540); m == nil {
		t.Error("aligned minute missed")
	}
	// WithinWindow rejects overnight spill.
	start, _ := LocalToUTC("2026-03-20T09:00", "Africa/Lagos")
	end, _ := LocalToUTC("2026-03-21T09:30", "Africa/Lagos")
	if WithinWindow(start, end, "Africa/Lagos", &slots[0]) {
		t.Error("overnight range accepted")
	}
}
