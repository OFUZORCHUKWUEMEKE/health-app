package booking

import (
	"sort"
	"time"
)

// MatrixSlotMinutes is the fixed system-matrix grid (slot_duration_minutes
// is honored only by the per-doctor path, Nest parity).
const MatrixSlotMinutes = 15

// MaxBookableConsecutiveSlots caps max_consecutive_slots.
const MaxBookableConsecutiveSlots = 4

// WeeklySlot is one availability window (wall-clock in the doctor zone).
type WeeklySlot struct {
	DayOfWeek int
	StartTime string
	EndTime   string
	Duration  int // slot_duration_minutes
	Active    bool
}

// Blackout is one exclusion, one-time (UTC range) or recurring (zone +
// weekday + minute range, reccuring contract spelling kept in storage).
type Blackout struct {
	StartUTC  time.Time
	EndUTC    time.Time
	Recurring bool
	Zone      string
	DayOfWeek int
	StartMins int
	EndMins   int
}

// Busy is a booked range (appointment).
type Busy struct {
	StartUTC time.Time
	EndUTC   time.Time
}

// Slot is one free/bookable instant pair in UTC.
type Slot struct {
	StartUTC time.Time
	EndUTC   time.Time
}

// ValidateWeeklySlots enforces the Nest upsert rules verbatim.
func ValidateWeeklySlots(slots []WeeklySlot) error {
	type rng struct{ s, e int }
	byDay := map[int][]rng{}
	for _, s := range slots {
		start, err := ToMinutes(s.StartTime)
		if err != nil {
			return err
		}
		end, err := ToMinutes(s.EndTime)
		if err != nil {
			return err
		}
		if start >= end {
			return errorf("Slot start_time must be earlier than end_time")
		}
		dur := s.Duration
		if dur <= 0 {
			return errorf("slot_duration_minutes must be positive")
		}
		if end-start < dur {
			return errorf("slot_duration_minutes is larger than slot range")
		}
		if (end-start)%dur != 0 {
			return errorf("slot_duration_minutes must divide the slot range exactly")
		}
		for _, r := range byDay[s.DayOfWeek] {
			if start < r.e && r.s < end {
				return errorf("Weekly slots overlap within the same day")
			}
		}
		byDay[s.DayOfWeek] = append(byDay[s.DayOfWeek], rng{start, end})
	}
	return nil
}

func errorf(msg string) error { return &slotError{msg} }

type slotError struct{ msg string }

func (e *slotError) Error() string { return e.msg }

// ExpandDaySlots builds the per-doctor slots for a local date, honoring
// each entry's own duration (was buildSlotsForDate).
func ExpandDaySlots(date, zone string, slots []WeeklySlot, dayOfWeek int) ([]Slot, error) {
	var out []Slot
	for _, s := range slots {
		if !s.Active || s.DayOfWeek != dayOfWeek {
			continue
		}
		startMin, err := ToMinutes(s.StartTime)
		if err != nil {
			return nil, err
		}
		endMin, err := ToMinutes(s.EndTime)
		if err != nil {
			return nil, err
		}
		for m := startMin; m+s.Duration <= endMin; m += s.Duration {
			start, err := DateAndTimeToUTC(date, MinutesToHHMM(m), zone)
			if err != nil {
				return nil, err
			}
			out = append(out, Slot{StartUTC: start, EndUTC: start.Add(time.Duration(s.Duration) * time.Minute)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartUTC.Before(out[j].StartUTC) })
	return out, nil
}

// SubtractBlackouts removes slots overlapped by one-time ranges or
// recurring rules (was overlapsAny + overlapsRecurring).
func SubtractBlackouts(slots []Slot, oneTime []Blackout, recurring []Blackout, zone string) []Slot {
	out := slots[:0]
	for _, s := range slots {
		blocked := false
		for _, b := range oneTime {
			if Overlaps(s.StartUTC, s.EndUTC, b.StartUTC, b.EndUTC) {
				blocked = true
				break
			}
		}
		if !blocked && OverlapsRecurring(s.StartUTC, s.EndUTC, recurring, zone) {
			blocked = true
		}
		if !blocked {
			out = append(out, s)
		}
	}
	return out
}

// SubtractBusy removes slots overlapped by appointments.
func SubtractBusy(slots []Slot, busy []Busy) []Slot {
	out := slots[:0]
	for _, s := range slots {
		blocked := false
		for _, b := range busy {
			if Overlaps(s.StartUTC, s.EndUTC, b.StartUTC, b.EndUTC) {
				blocked = true
				break
			}
		}
		if !blocked {
			out = append(out, s)
		}
	}
	return out
}

// OverlapsRecurring matches a slot against recurring rules, re-evaluating
// in the rule's own zone when it differs (mixed-zone branch, Nest parity).
func OverlapsRecurring(slotStart, slotEnd time.Time, rules []Blackout, zone string) bool {
	here := ZonedClock(slotStart, zone)
	startMins := here.MinuteOfDay
	endParts := ZonedClock(slotEnd.Add(-time.Millisecond), zone)
	endMins := endParts.MinuteOfDay
	if endParts.ISODate != here.ISODate {
		endMins = 24 * 60
	}
	for _, b := range rules {
		if !b.Recurring {
			continue
		}
		ruleZone := b.Zone
		if ruleZone == "" {
			ruleZone = zone
		}
		if ruleZone == zone {
			if b.DayOfWeek != here.DayOfWeek {
				continue
			}
			if b.StartMins < endMins && b.EndMins > startMins {
				return true
			}
			continue
		}
		// Mixed zones: evaluate in the rule's zone.
		ic := ZonedClock(slotStart, b.Zone)
		ec := ZonedClock(slotEnd.Add(-time.Millisecond), b.Zone)
		if ic.DayOfWeek != b.DayOfWeek {
			continue
		}
		ecMins := ec.MinuteOfDay
		if ec.ISODate != ic.ISODate {
			ecMins = 24 * 60
		}
		if b.StartMins < ecMins && b.EndMins > ic.MinuteOfDay {
			return true
		}
	}
	return false
}

// MatrixBlocks expands one availability entry to the fixed 15-minute grid
// for a local date (was buildAvailabilityMatrixBlocksForDate).
func MatrixBlocks(date, zone string, slots []WeeklySlot, dayOfWeek int) ([]Slot, error) {
	var out []Slot
	for _, s := range slots {
		if !s.Active || s.DayOfWeek != dayOfWeek {
			continue
		}
		startMin, err := ToMinutes(s.StartTime)
		if err != nil {
			return nil, err
		}
		endMin, err := ToMinutes(s.EndTime)
		if err != nil {
			return nil, err
		}
		for m := startMin; m+MatrixSlotMinutes <= endMin; m += MatrixSlotMinutes {
			start, err := DateAndTimeToUTC(date, MinutesToHHMM(m), zone)
			if err != nil {
				return nil, err
			}
			out = append(out, Slot{StartUTC: start, EndUTC: start.Add(MatrixSlotMinutes * time.Minute)})
		}
	}
	return out, nil
}

// MatchWeeklySlot finds the entry covering a local instant with aligned
// offset (was findMatchingWeeklySlot). Returns the entry or nil.
func MatchWeeklySlot(slots []WeeklySlot, dayOfWeek, minuteOfDay int) *WeeklySlot {
	for i := range slots {
		s := &slots[i]
		if !s.Active || s.DayOfWeek != dayOfWeek {
			continue
		}
		startMin, err1 := ToMinutes(s.StartTime)
		endMin, err2 := ToMinutes(s.EndTime)
		if err1 != nil || err2 != nil {
			continue
		}
		if minuteOfDay < startMin || minuteOfDay >= endMin {
			continue
		}
		if (minuteOfDay-startMin)%s.Duration != 0 {
			continue
		}
		if minuteOfDay+s.Duration > endMin {
			continue
		}
		return s
	}
	return nil
}

// WithinWindow checks same-local-day containment of [start,end) in a slot
// entry (was isRangeWithinAvailabilityWindow).
func WithinWindow(start, end time.Time, zone string, s *WeeklySlot) bool {
	sc := ZonedClock(start, zone)
	ec := ZonedClock(end.Add(-time.Millisecond), zone)
	if sc.ISODate != ec.ISODate {
		return false
	}
	startMin, _ := ToMinutes(s.StartTime)
	endMin, _ := ToMinutes(s.EndTime)
	return sc.MinuteOfDay >= startMin && ec.MinuteOfDay < endMin
}
