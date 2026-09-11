package booking

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/auth"
)

// Matrix resolves the date range from the four calling conventions
// (startDate/endDate | from/to | days_ahead | default next 14 days) and
// aggregates the fixed 15-minute grid per response-zone day.
func (s *Service) Matrix(ctx context.Context, startDate, endDate, from, to string, daysAhead int, timezone string) (map[string]any, error) {
	responseZone := strings.TrimSpace(timezone)
	if responseZone == "" {
		responseZone = "UTC"
	}
	if !ValidIANA(responseZone) {
		return nil, auth.BadRequest(fmt.Sprintf("Invalid IANA timezone: %s", timezone))
	}
	var rangeStart, rangeEnd time.Time
	switch {
	case daysAhead > 0:
		if daysAhead > 60 {
			return nil, auth.BadRequest("days_ahead must be between 1 and 60")
		}
		today := time.Now().UTC()
		rangeStart = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
		rangeEnd = rangeStart.Add(time.Duration(daysAhead) * 24 * time.Hour)
	case startDate != "" || endDate != "" || from != "" || to != "":
		startStr := firstNonEmpty(startDate, from)
		endStr := firstNonEmpty(endDate, to)
		if startStr == "" && endStr != "" {
			return nil, auth.BadRequest("startDate/from is required when endDate/to is provided")
		}
		if !ValidDateOnly(startStr) {
			return nil, auth.BadRequest("Invalid date. Expected format: YYYY-MM-DD")
		}
		var err error
		rangeStart, err = time.Parse("2006-01-02", startStr)
		if err != nil {
			return nil, auth.BadRequest("Invalid date range")
		}
		if endStr == "" {
			rangeEnd = rangeStart.Add(14 * 24 * time.Hour)
		} else {
			if !ValidDateOnly(endStr) {
				return nil, auth.BadRequest("Invalid date range")
			}
			var endDay time.Time
			endDay, err = time.Parse("2006-01-02", endStr)
			if err != nil {
				return nil, auth.BadRequest("Invalid date range")
			}
			rangeEnd = endDay.Add(24 * time.Hour)
		}
		if rangeEnd.Before(rangeStart) {
			return nil, auth.BadRequest("startDate/from must be before or equal to endDate/to")
		}
	default:
		today := time.Now().UTC()
		rangeStart = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
		rangeEnd = rangeStart.Add(14 * 24 * time.Hour)
	}

	avails, err := s.q().ListAvailabilitiesWithSlots(ctx)
	if err != nil {
		return nil, err
	}
	type fitted struct {
		avail gen.DoctorAvailability
		doc   gen.Doctor
		slots []WeeklySlot
		zone  string
	}
	var docs []fitted
	for _, a := range avails {
		if !a.DoctorID.Valid {
			continue
		}
		row, err := s.q().GetActiveDoctorByID(ctx, a.DoctorID)
		if err != nil {
			continue
		}
		zone := a.Timezone
		if zone == "" {
			zone = "UTC"
		}
		slots, err := WeeklySlotsJSON(a.WeeklySlots)
		if err != nil {
			continue
		}
		docs = append(docs, fitted{a, row, slots, zone})
	}
	if len(docs) == 0 {
		return map[string]any{}, nil
	}
	// Bulk conflicts once for the whole range.
	conflictStart := rangeStart.Add(-24 * time.Hour)
	conflictEnd := rangeEnd.Add(24 * time.Hour)
	type conflicts struct {
		appts []Busy
		one   []Blackout
		rec   []Blackout
	}
	// One round trip per conflict type across all doctors (was 3D).
	ids := make([]pgtype.UUID, 0, len(docs))
	for _, d := range docs {
		ids = append(ids, d.doc.ID)
	}
	apptsRows, _ := s.q().OverlappingDoctorAppointmentsBulk(ctx, gen.OverlappingDoctorAppointmentsBulkParams{
		DoctorIds: ids,
		NewStart:  pgtype.Timestamptz{Time: conflictStart, Valid: true},
		NewEnd:    pgtype.Timestamptz{Time: conflictEnd, Valid: true},
	})
	oneRows, _ := s.q().ListOneTimeBlackoutsBulk(ctx, gen.ListOneTimeBlackoutsBulkParams{
		DoctorIds: ids,
		NewStart:  pgtype.Timestamptz{Time: conflictStart, Valid: true},
		NewEnd:    pgtype.Timestamptz{Time: conflictEnd, Valid: true},
	})
	recRows, _ := s.q().ListRecurringBlackoutsBulk(ctx, ids)
	byDoctor := map[string]*conflicts{}
	for _, r := range apptsRows {
		if r.ScheduledStartAtUtc.Valid && r.ScheduledEndAtUtc.Valid {
			c := byDoctor[r.DoctorID.String()]
			if c == nil {
				c = &conflicts{}
				byDoctor[r.DoctorID.String()] = c
			}
			c.appts = append(c.appts, Busy{StartUTC: r.ScheduledStartAtUtc.Time, EndUTC: r.ScheduledEndAtUtc.Time})
		}
	}
	for k, v := range groupBlackouts(oneRows) {
		c := byDoctor[k]
		if c == nil {
			c = &conflicts{}
			byDoctor[k] = c
		}
		c.one = v
	}
	for k, v := range groupBlackouts(recRows) {
		c := byDoctor[k]
		if c == nil {
			c = &conflicts{}
			byDoctor[k] = c
		}
		c.rec = v
	}

	days := GenerateDateRange(rangeStart, rangeEnd.Add(-time.Millisecond))
	result := map[string]any{}
	for _, dateStr := range days {
		respStart, respEnd, err := DayBoundsUTC(dateStr, responseZone)
		if err != nil {
			continue
		}
		type instant struct{ start, end time.Time }
		union := map[string]instant{}
		freeByDoctor := map[string]map[string]bool{}
		for _, d := range docs {
			id := d.doc.ID.String()
			var daySlots []WeeklySlot
			for _, localDate := range CandidateLocalDates(respStart, respEnd, d.zone) {
				if !WithinEffectiveRangeDate(localDate, pgDate(d.avail.EffectiveFrom), pgDate(d.avail.EffectiveTo), d.zone) {
					continue
				}
				dayStart, _, derr := DayBoundsUTC(localDate, d.zone)
				if derr != nil {
					continue
				}
				dow := ZonedClock(dayStart, d.zone).DayOfWeek
				for _, sl := range d.slots {
					if sl.Active && sl.DayOfWeek == dow {
						daySlots = append(daySlots, sl)
					}
				}
			}
			if len(daySlots) == 0 {
				continue
			}
			blocks, err := MatrixBlocksForDates([]string{dateStr}, d.zone, daySlots, respStart, respEnd, responseZone)
			if err != nil {
				continue
			}
			c := byDoctor[id]
			if c == nil {
				c = &conflicts{}
			}
			free := map[string]bool{}
			for _, b := range blocks {
				key := b.StartUTC.Format(time.RFC3339Nano)
				union[key] = instant{b.StartUTC, b.EndUTC}
				blocked := false
				for _, o := range c.one {
					if Overlaps(b.StartUTC, b.EndUTC, o.StartUTC, o.EndUTC) {
						blocked = true
						break
					}
				}
				if !blocked && OverlapsRecurring(b.StartUTC, b.EndUTC, c.rec, d.zone) {
					blocked = true
				}
				if !blocked {
					for _, ap := range c.appts {
						if Overlaps(b.StartUTC, b.EndUTC, ap.StartUTC, ap.EndUTC) {
							blocked = true
							break
						}
					}
				}
				if !blocked {
					free[key] = true
				}
			}
			freeByDoctor[id] = free
		}
		if len(union) == 0 {
			continue
		}
		keys := make([]string, 0, len(union))
		for k := range union {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		slots := make([]map[string]any, 0, len(keys))
		for _, k := range keys {
			iv := union[k]
			available := 0
			best := 0
			for _, free := range freeByDoctor {
				if !free[k] {
					continue
				}
				available++
				run := 1
				cur := iv.end
				for run < MaxBookableConsecutiveSlots {
					nk := cur.Format(time.RFC3339Nano)
					next, ok := union[nk]
					if !ok || !free[nk] || !next.start.Equal(cur) {
						break
					}
					run++
					cur = next.end
				}
				if run > best {
					best = run
				}
			}
			loc, _ := time.LoadLocation(responseZone)
			slots = append(slots, map[string]any{
				"time":                  iv.start.In(loc).Format("03:04 PM"),
				"available_doctors":     available,
				"max_consecutive_slots": best,
			})
		}
		dayKey := ZonedClock(respStart, responseZone).ISODate
		result[dayKey] = map[string]any{"slots": slots}
	}
	return result, nil
}

// MatrixBlocksForDates expands entries for the given local dates, keeping
// blocks inside [respStart, respEnd).
func MatrixBlocksForDates(localDates []string, doctorZone string, slots []WeeklySlot, respStart, respEnd time.Time, _ string) ([]Slot, error) {
	var out []Slot
	seen := map[string]bool{}
	for _, localDate := range localDates {
		dayStart, _, err := DayBoundsUTC(localDate, doctorZone)
		if err != nil {
			return nil, err
		}
		dow := ZonedClock(dayStart, doctorZone).DayOfWeek
		blocks, err := MatrixBlocks(localDate, doctorZone, slots, dow)
		if err != nil {
			return nil, err
		}
		for _, b := range blocks {
			if b.StartUTC.Before(respStart) || !b.StartUTC.Before(respEnd) {
				continue
			}
			k := b.StartUTC.Format(time.RFC3339Nano)
			if !seen[k] {
				seen[k] = true
				out = append(out, b)
			}
		}
	}
	return out, nil
}
