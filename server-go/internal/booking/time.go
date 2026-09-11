// Package booking rebuilds scheduling on PostgreSQL: weekly availability,
// blackouts, slot discovery, appointment lifecycle, and rescheduling.
// Timezone handling below ports timezone.util.ts: clients send local
// wall-clock plus IANA zone, the server stores UTC, DST is observed per
// zone at conversion time (never with fixed offsets).
package booking

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// localDateTimeRe validates YYYY-MM-DDTHH:mm[:ss[.mmm]] with no offset, no
// space (was is-iso-local-datetime.decorator.ts).
var localDateTimeRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$`)

// dateOnlyRe validates YYYY-MM-DD.
var dateOnlyRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ValidLocalDateTime reports whether s is an offset-less local datetime.
func ValidLocalDateTime(s string) bool { return localDateTimeRe.MatchString(s) }

// ValidDateOnly reports whether s is YYYY-MM-DD.
func ValidDateOnly(s string) bool { return dateOnlyRe.MatchString(s) }

// ValidIANA reports whether zone loads (rejects MDT/GMT-6/-06:00 like Nest).
func ValidIANA(zone string) bool {
	if strings.TrimSpace(zone) == "" {
		return false
	}
	_, err := time.LoadLocation(zone)
	return err == nil
}

// LocalToUTC converts wall-clock in zone to UTC (was localToUtc). Invalid
// zone/datetime yield descriptive errors for the 400 envelope.
func LocalToUTC(local, zone string) (time.Time, error) {
	if !ValidIANA(zone) {
		return time.Time{}, fmt.Errorf("Invalid IANA timezone: %s", zone)
	}
	if !ValidLocalDateTime(local) {
		return time.Time{}, fmt.Errorf("Invalid local datetime %q for zone %q: want YYYY-MM-DDTHH:mm[:ss]", local, zone)
	}
	loc, _ := time.LoadLocation(zone)
	layouts := []string{"2006-01-02T15:04:05.000", "2006-01-02T15:04:05", "2006-01-02T15:04"}
	var parsed time.Time
	var err error
	for _, layout := range layouts {
		if parsed, err = time.ParseInLocation(layout, local, loc); err == nil {
			break
		}
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("Invalid local datetime %q for zone %q: %v", local, zone, err)
	}
	return parsed.UTC(), nil
}

// ZonedParts decomposes an instant in zone (was zonedClock).
type ZonedParts struct {
	DayOfWeek   int // 0=Sun..6=Sat (luxon weekday%7)
	MinuteOfDay int
	ISODate     string // YYYY-MM-DD
}

// ZonedClock observes DST via the zone database.
func ZonedClock(t time.Time, zone string) ZonedParts {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		loc = time.UTC
	}
	z := t.In(loc)
	return ZonedParts{
		DayOfWeek:   int(z.Weekday()),
		MinuteOfDay: z.Hour()*60 + z.Minute(),
		ISODate:     z.Format("2006-01-02"),
	}
}

// DayBoundsUTC returns [start,end) of a zone-local calendar date in UTC
// (was start/endOfZonedDayUtc).
func DayBoundsUTC(date, zone string) (time.Time, time.Time, error) {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("Invalid IANA timezone: %s", zone)
	}
	day, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("Invalid date. Expected format: YYYY-MM-DD")
	}
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc).UTC()
	return start, start.Add(24 * time.Hour), nil
}

// DateAndTimeToUTC converts a zone-local date + HH:mm wall time to UTC
// (was zonedDateAndTimeToUtc — DST-correct by construction).
func DateAndTimeToUTC(date, hhmm, zone string) (time.Time, error) {
	return LocalToUTC(date+"T"+hhmm, zone)
}

// ToMinutes parses HH:mm to minutes since midnight.
func ToMinutes(hhmm string) (int, error) {
	var h, m int
	if _, err := fmt.Sscanf(hhmm, "%d:%d", &h, &m); err != nil {
		return 0, fmt.Errorf("bad time %q", hhmm)
	}
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, fmt.Errorf("bad time %q", hhmm)
	}
	return h*60 + m, nil
}

// MinutesToHHMM formats minutes since midnight.
func MinutesToHHMM(mins int) string {
	return fmt.Sprintf("%02d:%02d", mins/60, mins%60)
}

// Overlaps reports half-open interval overlap (was overlapsAny).
func Overlaps(aStart, aEnd, bStart, bEnd time.Time) bool {
	return aStart.Before(bEnd) && bStart.Before(aEnd)
}

// WithinEffectiveRange checks the availability window by calendar-date
// strings in the doctor zone (was isWithinEffectiveRange).
func WithinEffectiveRange(day time.Time, from, to *time.Time, zone string) bool {
	dayStr := ZonedClock(day, zone).ISODate
	if from != nil && ZonedClock(*from, zone).ISODate > dayStr {
		return false
	}
	if to != nil && ZonedClock(*to, zone).ISODate < dayStr {
		return false
	}
	return true
}

// WithinEffectiveRangeDate checks a YYYY-MM-DD string (matrix path).
func WithinEffectiveRangeDate(dateStr string, from, to *time.Time, zone string) bool {
	if from != nil && ZonedClock(*from, zone).ISODate > dateStr {
		return false
	}
	if to != nil && ZonedClock(*to, zone).ISODate < dateStr {
		return false
	}
	return true
}

// CandidateLocalDates returns the 1-2 doctor-local dates overlapped by a UTC
// range (was getCandidateLocalDatesForUtcRange — cross-zone spill).
func CandidateLocalDates(start, end time.Time, zone string) []string {
	first := ZonedClock(start, zone).ISODate
	last := ZonedClock(end.Add(-time.Millisecond), zone).ISODate
	if first == last {
		return []string{first}
	}
	return []string{first, last}
}

// ISOWeekStart returns Monday 00:00 UTC of ISO week (was getIsoWeekStartUtc).
func ISOWeekStart(year, week int) time.Time {
	// Jan 4 is always in ISO week 1; back up to Monday.
	jan4 := time.Date(year, 1, 4, 0, 0, 0, 0, time.UTC)
	weekday := int(jan4.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	monday := jan4.AddDate(0, 0, -(weekday - 1))
	return monday.AddDate(0, 0, (week-1)*7)
}

// GenerateDateRange lists YYYY-MM-DD from..to inclusive (UTC days).
func GenerateDateRange(from, to time.Time) []string {
	var out []string
	day := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
	end := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, time.UTC)
	for !day.After(end) {
		out = append(out, day.Format("2006-01-02"))
		day = day.Add(24 * time.Hour)
	}
	return out
}
