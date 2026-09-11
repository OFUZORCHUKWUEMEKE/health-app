package booking

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/concurrent"
)

// --- availability documents -----------------------------------------------

// AvailabilityJSON mirrors the doctor discovery shape (contract §booking).
func AvailabilityJSON(doctor map[string]any, avail *gen.DoctorAvailability) map[string]any {
	out := map[string]any{
		"_id": doctor["_id"], "first_name": doctor["first_name"],
		"last_name": doctor["last_name"], "full_name": doctor["full_name"],
		"email": doctor["email"], "profile_picture_url": doctor["profile_picture_url"],
		"specializations": doctor["specializations"], "active": doctor["active"],
		"availability": nil,
	}
	if avail != nil {
		out["availability"] = map[string]any{
			"timezone": avail.Timezone, "weekly_slots": avail.WeeklySlots,
			"effective_from": dateOrNull(avail.EffectiveFrom),
			"effective_to":   dateOrNull(avail.EffectiveTo),
		}
	}
	return out
}

func dateOrNull(v pgtype.Date) any {
	if v.Valid {
		return v.Time.Format("2006-01-02")
	}
	return nil
}

// WeeklySlotsJSON parses the stored jsonb into typed entries.
func WeeklySlotsJSON(raw []byte) ([]WeeklySlot, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var items []struct {
		DayOfWeek int    `json:"day_of_week"`
		StartTime string `json:"start_time"`
		EndTime   string `json:"end_time"`
		Duration  int    `json:"slot_duration_minutes"`
		Active    *bool  `json:"is_active"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	out := make([]WeeklySlot, 0, len(items))
	for _, it := range items {
		active := true
		if it.Active != nil {
			active = *it.Active
		}
		out = append(out, WeeklySlot{
			DayOfWeek: it.DayOfWeek, StartTime: it.StartTime,
			EndTime: it.EndTime, Duration: it.Duration, Active: active,
		})
	}
	return out, nil
}

// SlotsToJSON serializes entries for storage.
func SlotsToJSON(slots []WeeklySlot) []byte {
	items := make([]map[string]any, 0, len(slots))
	for _, s := range slots {
		items = append(items, map[string]any{
			"day_of_week": s.DayOfWeek, "start_time": s.StartTime,
			"end_time": s.EndTime, "slot_duration_minutes": s.Duration,
			"is_active": s.Active,
		})
	}
	raw, _ := json.Marshal(items)
	if raw == nil {
		return []byte("[]")
	}
	return raw
}

// UpsertAvailability validates and replaces the doctor's document.
func (s *Service) UpsertAvailability(ctx context.Context, doctorID, timezone string, slots []WeeklySlot, from, to *time.Time) (map[string]any, error) {
	if !ValidIANA(timezone) {
		return nil, auth.BadRequest(fmt.Sprintf("Invalid IANA timezone: %s", timezone))
	}
	if from != nil && to != nil && to.Before(*from) {
		return nil, auth.BadRequest("effective_from cannot be later than effective_to")
	}
	if err := ValidateWeeklySlots(slots); err != nil {
		return nil, auth.BadRequest(err.Error())
	}
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	var fromD, toD pgtype.Date
	if from != nil {
		fromD = pgtype.Date{Time: *from, Valid: true}
	}
	if to != nil {
		toD = pgtype.Date{Time: *to, Valid: true}
	}
	avail, err := s.q().UpsertAvailability(ctx, gen.UpsertAvailabilityParams{
		DoctorID: uid, Timezone: timezone, WeeklySlots: SlotsToJSON(slots),
		EffectiveFrom: fromD, EffectiveTo: toD,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"_id": avail.ID.String(), "doctor_id": doctorID, "timezone": avail.Timezone,
		"weekly_slots":   avail.WeeklySlots,
		"effective_from": dateOrNull(avail.EffectiveFrom),
		"effective_to":   dateOrNull(avail.EffectiveTo),
	}, nil
}

// GetAvailability returns the doctor's document (404-shaped when missing is
// handled by callers needing [] vs object).
func (s *Service) GetAvailability(ctx context.Context, doctorID string) (*gen.DoctorAvailability, []WeeklySlot, error) {
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, nil, auth.NotFound("Doctor not found")
	}
	avail, err := s.q().GetAvailabilityByDoctor(ctx, uid)
	if err != nil {
		return nil, nil, auth.NotFound("Availability not found")
	}
	slots, err := WeeklySlotsJSON(avail.WeeklySlots)
	if err != nil {
		return nil, nil, err
	}
	return &avail, slots, nil
}

// --- blackouts --------------------------------------------------------------

// BlackoutInput mirrors one entry of the create DTO.
type BlackoutInput struct {
	StartLocal, EndLocal, Timezone, Reason string
	Recurring                              bool
}

// CreateBlackouts validates, overlap-guards, and stores each entry with its
// own timezone (mixed zones allowed).
func (s *Service) CreateBlackouts(ctx context.Context, doctorID string, inputs []BlackoutInput) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	out := make([]map[string]any, 0, len(inputs))
	for _, in := range inputs {
		if !ValidIANA(in.Timezone) {
			return nil, auth.BadRequest(fmt.Sprintf("Invalid IANA timezone: %s", in.Timezone))
		}
		start, err := LocalToUTC(in.StartLocal, in.Timezone)
		if err != nil {
			return nil, auth.BadRequest(err.Error())
		}
		end, err := LocalToUTC(in.EndLocal, in.Timezone)
		if err != nil {
			return nil, auth.BadRequest(err.Error())
		}
		if !start.Before(end) {
			return nil, auth.BadRequest(fmt.Sprintf("start_local must be before end_local for entry starting at %s", in.StartLocal))
		}
		parts := ZonedClock(start, in.Timezone)
		endParts := ZonedClock(end.Add(-time.Millisecond), in.Timezone)
		startMins, endMins := parts.MinuteOfDay, endParts.MinuteOfDay
		if endParts.ISODate != parts.ISODate {
			endMins = 24 * 60
		}
		if in.Recurring {
			dups, err := s.q().ListOverlappingRecurring(ctx, gen.ListOverlappingRecurringParams{
				DoctorID: uid, DayOfWeek: pgtype.Int2{Int16: int16(parts.DayOfWeek), Valid: true},
				NewStartMins: int32(startMins),
				NewEndMins:   int32(endMins),
			})
			if err != nil {
				return nil, err
			}
			_ = dups
			if len(dups) > 0 {
				return nil, auth.Conflict(fmt.Sprintf("Recurring blackout on day %d overlaps an existing recurring blackout", parts.DayOfWeek))
			}
		} else {
			over, err := s.q().ListOneTimeBlackoutsOverlap(ctx, gen.ListOneTimeBlackoutsOverlapParams{
				DoctorID: uid,
				NewStart: pgtype.Timestamptz{Time: start, Valid: true},
				NewEnd:   pgtype.Timestamptz{Time: end, Valid: true},
			})
			if err != nil {
				return nil, err
			}
			if len(over) > 0 {
				return nil, auth.Conflict(fmt.Sprintf("Blackout period starting at %s overlaps an existing blackout", in.StartLocal))
			}
			// One-time vs recurring in-memory check.
			rec, err := s.q().ListRecurringBlackouts(ctx, uid)
			if err != nil {
				return nil, err
			}
			if OverlapsRecurring(start, end, blackoutsFromRows(rec), in.Timezone) {
				return nil, auth.Conflict(fmt.Sprintf("Blackout period starting at %s overlaps an existing blackout", in.StartLocal))
			}
		}
		row, err := s.q().CreateBlackout(ctx, gen.CreateBlackoutParams{
			DoctorID:   uid,
			StartAtUtc: pgtype.Timestamptz{Time: start, Valid: true},
			EndAtUtc:   pgtype.Timestamptz{Time: end, Valid: true},
			Reason:     in.Reason, Reccuring: in.Recurring, Timezone: textOrEmpty(in.Timezone),
			DayOfWeek:        pgtype.Int2{Int16: int16(parts.DayOfWeek), Valid: in.Recurring},
			StartTimeMinutes: pgtype.Int4{Int32: int32(startMins), Valid: in.Recurring},
			EndTimeMinutes:   pgtype.Int4{Int32: int32(endMins), Valid: in.Recurring},
		})
		if err != nil {
			return nil, err
		}
		out = append(out, blackoutJSON(row))
	}
	return out, nil
}

func blackoutJSON(b gen.DoctorBlackout) map[string]any {
	m := map[string]any{
		"_id": b.ID.String(), "doctor_id": uuidOrNull(b.DoctorID),
		"start_at_utc": isoOrNull(b.StartAtUtc), "end_at_utc": isoOrNull(b.EndAtUtc),
		"reason": b.Reason, "reccuring": b.Reccuring,
		"timezone": textOrNull(b.Timezone),
	}
	if b.Reccuring {
		m["day_of_week"] = b.DayOfWeek.Int16
		m["start_time_minutes"] = b.StartTimeMinutes.Int32
		m["end_time_minutes"] = b.EndTimeMinutes.Int32
	}
	return m
}

func blackoutsFromRows(rows []gen.DoctorBlackout) []Blackout {
	out := make([]Blackout, 0, len(rows))
	for _, r := range rows {
		b := Blackout{Recurring: r.Reccuring}
		if r.StartAtUtc.Valid {
			b.StartUTC = r.StartAtUtc.Time
		}
		if r.EndAtUtc.Valid {
			b.EndUTC = r.EndAtUtc.Time
		}
		if r.Timezone.Valid {
			b.Zone = r.Timezone.String
		}
		if r.DayOfWeek.Valid {
			b.DayOfWeek = int(r.DayOfWeek.Int16)
		}
		if r.StartTimeMinutes.Valid {
			b.StartMins = int(r.StartTimeMinutes.Int32)
		}
		if r.EndTimeMinutes.Valid {
			b.EndMins = int(r.EndTimeMinutes.Int32)
		}
		out = append(out, b)
	}
	return out
}

// groupBlackouts indexes bulk-fetched rows by doctor for the
// short-circuit candidate scan (order preserved by caller).
func groupBlackouts(rows []gen.DoctorBlackout) map[string][]Blackout {
	out := map[string][]Blackout{}
	for _, r := range rows {
		k := r.DoctorID.String()
		out[k] = append(out[k], blackoutsFromRows([]gen.DoctorBlackout{r})[0])
	}
	return out
}

func busyFromAppointments(rows []gen.Appointment) []Busy {
	out := make([]Busy, 0, len(rows))
	for _, r := range rows {
		if r.ScheduledStartAtUtc.Valid && r.ScheduledEndAtUtc.Valid {
			out = append(out, Busy{StartUTC: r.ScheduledStartAtUtc.Time, EndUTC: r.ScheduledEndAtUtc.Time})
		}
	}
	return out
}

// --- per-doctor day slots ---------------------------------------------------

// DaySlots expands, then subtracts one-time blackouts (overlapping the day),
// all recurring rules, and PENDING/CONFIRMED appointments.
func (s *Service) DaySlots(ctx context.Context, doctorID, date string) (map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.BadRequest("Invalid doctor id")
	}
	doc, err := s.q().GetActiveDoctorByID(ctx, uid)
	if err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	_ = doc
	avail, slots, err := s.GetAvailability(ctx, doctorID)
	if err != nil {
		return map[string]any{"doctor_id": doctorID, "date": date, "timezone": nil, "slots": []any{}}, nil
	}
	zone := avail.Timezone
	if zone == "" {
		zone = "UTC"
	}
	dayStart, dayEnd, err := DayBoundsUTC(date, zone)
	if err != nil {
		return nil, auth.BadRequest(err.Error())
	}
	parts := ZonedClock(dayStart, zone)
	if !WithinEffectiveRange(dayStart, pgDate(avail.EffectiveFrom), pgDate(avail.EffectiveTo), zone) {
		return map[string]any{"doctor_id": doctorID, "date": date, "timezone": zone, "slots": []any{}}, nil
	}
	expanded, err := ExpandDaySlots(date, zone, slots, parts.DayOfWeek)
	if err != nil {
		return nil, err
	}
	var oneTime []gen.DoctorBlackout
	var rec []gen.DoctorBlackout
	var appts []gen.Appointment
	// The three conflict reads are independent: fan out, merge after.
	if err := concurrent.Do(ctx,
		func(ctx context.Context) error {
			var err error
			oneTime, err = s.q().ListOneTimeBlackoutsOverlap(ctx, gen.ListOneTimeBlackoutsOverlapParams{
				DoctorID: uid,
				NewStart: pgtype.Timestamptz{Time: dayStart, Valid: true},
				NewEnd:   pgtype.Timestamptz{Time: dayEnd, Valid: true},
			})
			return err
		},
		func(ctx context.Context) error {
			var err error
			rec, err = s.q().ListRecurringBlackouts(ctx, uid)
			return err
		},
		func(ctx context.Context) error {
			var err error
			appts, err = s.q().OverlappingDoctorAppointments(ctx, gen.OverlappingDoctorAppointmentsParams{
				DoctorID:  uid,
				NewStart:  pgtype.Timestamptz{Time: dayStart, Valid: true},
				NewEnd:    pgtype.Timestamptz{Time: dayEnd, Valid: true},
				ExcludeID: pgtype.UUID{},
			})
			return err
		},
	); err != nil {
		return nil, err
	}
	free := SubtractBlackouts(expanded, blackoutsFromRows(oneTime), blackoutsFromRows(rec), zone)
	free = SubtractBusy(free, busyFromAppointments(appts))
	items := make([]map[string]any, 0, len(free))
	for _, sl := range free {
		items = append(items, map[string]any{
			"start_at_utc": sl.StartUTC.UTC().Format(time.RFC3339Nano),
			"end_at_utc":   sl.EndUTC.UTC().Format(time.RFC3339Nano),
		})
	}
	return map[string]any{
		"doctor_id": doctorID, "date": date, "timezone": zone, "slots": items,
	}, nil
}

func pgDate(v pgtype.Date) *time.Time {
	if v.Valid {
		t := v.Time
		return &t
	}
	return nil
}

// --- check + optimal --------------------------------------------------------

// SlotCheck is the validated instant + matched entry.
type SlotCheck struct {
	Start, End   time.Time
	Zone         string // doctor zone
	Matched      *WeeklySlot
	Availability *gen.DoctorAvailability
}

// CheckDoctorSlot validates a wall-clock instant against a doctor (pure
// read, mirrors checkDoctorAvailability reasons verbatim).
func (s *Service) CheckDoctorSlot(ctx context.Context, doctorID, local, zone string, duration int) (map[string]any, error) {
	slot, err := s.resolveSlot(ctx, doctorID, local, zone, duration, pgtype.UUID{})
	if err != nil {
		if svcErr, ok := err.(*auth.Error); ok {
			return map[string]any{"available": false, "reason": svcErr.Message}, nil
		}
		return nil, err
	}
	doc, _ := s.q().GetActiveDoctorByID(ctx, mustUUID(doctorID))
	return map[string]any{
		"available": true,
		"doctor": map[string]any{
			"_id": doctorID, "first_name": doc.FirstName, "last_name": doc.LastName,
			"full_name": textOrNull(doc.FullName), "specializations": strs(anyStrings(doc.Specializations)),
		},
		"slot": map[string]any{
			"start_at_utc":     slot.Start.UTC().Format(time.RFC3339Nano),
			"end_at_utc":       slot.End.UTC().Format(time.RFC3339Nano),
			"duration_minutes": duration, "timezone": slot.Zone,
		},
	}, nil
}

func mustUUID(id string) pgtype.UUID {
	var uid pgtype.UUID
	_ = uid.Scan(id)
	return uid
}

// resolveSlot runs the full fit + conflict gauntlet, returning fine-grained
// errors for check vs throw contexts.
func (s *Service) resolveSlot(ctx context.Context, doctorID, local, zone string, duration int, exclude pgtype.UUID) (*SlotCheck, error) {
	if !allowedDurations[duration] {
		return nil, auth.BadRequest("Invalid duration")
	}
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.BadRequest("Invalid doctor id")
	}
	if _, err := s.q().GetActiveDoctorByID(ctx, uid); err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	start, err := LocalToUTC(local, zone)
	if err != nil {
		return nil, auth.BadRequest(err.Error())
	}
	end := start.Add(time.Duration(duration) * time.Minute)
	avail, slots, err := s.GetAvailability(ctx, doctorID)
	if err != nil {
		return nil, auth.BadRequest("Doctor has no configured availability")
	}
	docZone := avail.Timezone
	if docZone == "" {
		docZone = "UTC"
	}
	if !WithinEffectiveRange(start, pgDate(avail.EffectiveFrom), pgDate(avail.EffectiveTo), docZone) {
		return nil, auth.BadRequest("Selected slot is outside doctor availability range")
	}
	parts := ZonedClock(start, docZone)
	matched := MatchWeeklySlot(slots, parts.DayOfWeek, parts.MinuteOfDay)
	if matched == nil {
		return nil, auth.BadRequest("Selected slot is not part of doctor availability")
	}
	if duration%matched.Duration != 0 {
		return nil, auth.BadRequest("Requested duration must align with doctor slot interval")
	}
	if !WithinWindow(start, end, docZone, matched) {
		return nil, auth.BadRequest("Requested duration exceeds available doctor time window")
	}
	var oneTime []gen.DoctorBlackout
	var rec []gen.DoctorBlackout
	var busy []gen.Appointment
	if err := concurrent.Do(ctx,
		func(ctx context.Context) error {
			var err error
			oneTime, err = s.q().ListOneTimeBlackoutsOverlap(ctx, gen.ListOneTimeBlackoutsOverlapParams{
				DoctorID: uid,
				NewStart: pgtype.Timestamptz{Time: start, Valid: true},
				NewEnd:   pgtype.Timestamptz{Time: end, Valid: true},
			})
			return err
		},
		func(ctx context.Context) error {
			var err error
			rec, err = s.q().ListRecurringBlackouts(ctx, uid)
			return err
		},
		func(ctx context.Context) error {
			var err error
			busy, err = s.q().OverlappingDoctorAppointments(ctx, gen.OverlappingDoctorAppointmentsParams{
				DoctorID:  uid,
				NewStart:  pgtype.Timestamptz{Time: start, Valid: true},
				NewEnd:    pgtype.Timestamptz{Time: end, Valid: true},
				ExcludeID: exclude,
			})
			return err
		},
	); err != nil {
		return nil, err
	}
	if len(oneTime) > 0 || OverlapsRecurring(start, end, blackoutsFromRows(rec), docZone) {
		return nil, auth.Conflict("Selected slot is blocked by doctor blackout")
	}
	if len(busy) > 0 {
		return nil, auth.Conflict("Selected slot is already booked")
	}
	return &SlotCheck{Start: start, End: end, Zone: docZone, Matched: matched, Availability: avail}, nil
}

// FindOptimal returns the first free doctor (specialization matches first).
func (s *Service) FindOptimal(ctx context.Context, local, zone string, duration int, specialization string) (map[string]any, error) {
	start, err := LocalToUTC(local, zone)
	if err != nil {
		return nil, auth.BadRequest(err.Error())
	}
	if !allowedDurations[duration] {
		return nil, auth.BadRequest("Invalid duration")
	}
	end := start.Add(time.Duration(duration) * time.Minute)
	avails, err := s.q().ListAvailabilitiesWithSlots(ctx)
	if err != nil {
		return nil, err
	}
	type candidate struct {
		avail gen.DoctorAvailability
		slots []WeeklySlot
	}
	var fits []candidate
	for _, a := range avails {
		docZone := a.Timezone
		if docZone == "" {
			docZone = "UTC"
		}
		slots, err := WeeklySlotsJSON(a.WeeklySlots)
		if err != nil {
			continue
		}
		if !WithinEffectiveRange(start, pgDate(a.EffectiveFrom), pgDate(a.EffectiveTo), docZone) {
			continue
		}
		parts := ZonedClock(start, docZone)
		matched := MatchWeeklySlot(slots, parts.DayOfWeek, parts.MinuteOfDay)
		if matched == nil || duration%matched.Duration != 0 {
			continue
		}
		if !WithinWindow(start, end, docZone, matched) {
			continue
		}
		fits = append(fits, candidate{a, slots})
	}
	if len(fits) == 0 {
		return map[string]any{"found": false, "reason": "No doctors have availability for the requested time slot"}, nil
	}
	// Active doctors only, specialization matches first.
	var dids []pgtype.UUID
	for _, f := range fits {
		if f.avail.DoctorID.Valid {
			dids = append(dids, pgtype.UUID{Bytes: f.avail.DoctorID.Bytes, Valid: true})
		}
	}
	activeRows, err := s.q().GetActiveDoctorsByIDs(ctx, dids)
	if err != nil {
		return nil, err
	}
	activeByID := map[string]gen.Doctor{}
	for _, row := range activeRows {
		activeByID[row.ID.String()] = row
	}
	var docs []docCandidate
	for _, f := range fits {
		if !f.avail.DoctorID.Valid {
			continue
		}
		id := pgtype.UUID{Bytes: f.avail.DoctorID.Bytes, Valid: true}.String()
		row, ok := activeByID[id]
		if !ok {
			continue
		}
		zone := f.avail.Timezone
		if zone == "" {
			zone = "UTC"
		}
		docs = append(docs, docCandidate{id: id, specs: strs(anyStrings(row.Specializations)), row: row, zone: zone})
	}
	if len(docs) == 0 {
		return map[string]any{"found": false, "reason": "No active doctors available for the requested time"}, nil
	}
	sortDoctorsBySpecialization(docs, specialization)
	// One round trip per conflict type across all candidates (was 3N).
	ids := make([]pgtype.UUID, 0, len(docs))
	for _, d := range docs {
		var did pgtype.UUID
		_ = did.Scan(d.id)
		ids = append(ids, did)
	}
	oneRows, _ := s.q().ListOneTimeBlackoutsBulk(ctx, gen.ListOneTimeBlackoutsBulkParams{
		DoctorIds: ids,
		NewStart:  pgtype.Timestamptz{Time: start, Valid: true},
		NewEnd:    pgtype.Timestamptz{Time: end, Valid: true},
	})
	recRows, _ := s.q().ListRecurringBlackoutsBulk(ctx, ids)
	busyRows, _ := s.q().OverlappingDoctorAppointmentsBulk(ctx, gen.OverlappingDoctorAppointmentsBulkParams{
		DoctorIds: ids,
		NewStart:  pgtype.Timestamptz{Time: start, Valid: true},
		NewEnd:    pgtype.Timestamptz{Time: end, Valid: true},
	})
	oneByDoctor := groupBlackouts(oneRows)
	recByDoctor := groupBlackouts(recRows)
	busyByDoctor := map[string][]Busy{}
	for _, r := range busyRows {
		if r.ScheduledStartAtUtc.Valid && r.ScheduledEndAtUtc.Valid {
			k := r.DoctorID.String()
			busyByDoctor[k] = append(busyByDoctor[k], Busy{StartUTC: r.ScheduledStartAtUtc.Time, EndUTC: r.ScheduledEndAtUtc.Time})
		}
	}
	for _, d := range docs {
		if len(oneByDoctor[d.id]) > 0 {
			continue
		}
		if OverlapsRecurring(start, end, recByDoctor[d.id], d.zone) {
			continue
		}
		blocked := false
		for _, b := range busyByDoctor[d.id] {
			if Overlaps(start, end, b.StartUTC, b.EndUTC) {
				blocked = true
				break
			}
		}
		if blocked {
			continue
		}
		return map[string]any{
			"found": true,
			"doctor": map[string]any{
				"_id": d.id, "first_name": d.row.FirstName, "last_name": d.row.LastName,
				"full_name": textOrNull(d.row.FullName), "email": d.row.Email,
				"specializations":     d.specs,
				"profile_picture_url": textOrNull(d.row.ProfilePictureUrl),
			},
			"slot": map[string]any{
				"start_at_utc":     start.UTC().Format(time.RFC3339Nano),
				"end_at_utc":       end.UTC().Format(time.RFC3339Nano),
				"duration_minutes": duration, "timezone": d.zone,
			},
		}, nil
	}
	return map[string]any{"found": false, "reason": "No available doctor found for the requested time slot"}, nil
}

type docCandidate struct {
	id    string
	specs []string
	row   gen.Doctor
	zone  string
}

func sortDoctorsBySpecialization(docs []docCandidate, specialization string) {
	want := strings.ToLower(strings.TrimSpace(specialization))
	if want == "" {
		return
	}
	matches := func(d docCandidate) bool {
		for _, sp := range d.specs {
			if strings.ToLower(sp) == want {
				return true
			}
		}
		return false
	}
	sort.SliceStable(docs, func(i, j int) bool {
		return matches(docs[i]) && !matches(docs[j])
	})
}

// --- discovery --------------------------------------------------------------

// SearchDoctors lists active doctors with optional specialization/q filters,
// each with embedded availability. With onlyAvailable, doctors lacking an
// active-slot document are dropped (the /available variant).
func (s *Service) SearchDoctors(ctx context.Context, q, specialization string, onlyAvailable bool) ([]map[string]any, error) {
	rows, err := s.q().SearchDoctors(ctx, gen.SearchDoctorsParams{
		Column1: specialization, Column2: strings.TrimSpace(q),
	})
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, d := range rows {
		doc := map[string]any{
			"_id": d.ID.String(), "first_name": d.FirstName, "last_name": d.LastName,
			"full_name": textOrNull(d.FullName), "email": d.Email,
			"profile_picture_url": textOrNull(d.ProfilePictureUrl),
			"specializations":     strs(anyStrings(d.Specializations)),
			"active":              d.Active,
		}
		avail, err := s.q().GetAvailabilityByDoctor(ctx, d.ID)
		if err != nil {
			if onlyAvailable {
				continue
			}
			out = append(out, AvailabilityJSON(doc, nil))
			continue
		}
		out = append(out, AvailabilityJSON(doc, &avail))
	}
	return out, nil
}

// ListBlackouts returns all of a doctor's blackouts.
func (s *Service) ListBlackouts(ctx context.Context, doctorID string) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	rows, err := s.q().ListBlackoutsByDoctor(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, blackoutJSON(r))
	}
	return out, nil
}

// DeleteBlackout removes one blackout scoped to the doctor.
func (s *Service) DeleteBlackout(ctx context.Context, doctorID, id string) error {
	var uid, bid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return auth.NotFound("Doctor not found")
	}
	if err := bid.Scan(id); err != nil {
		return auth.NotFound("Blackout not found")
	}
	n, err := s.q().DeleteBlackout(ctx, gen.DeleteBlackoutParams{ID: bid, DoctorID: uid})
	if err != nil {
		return err
	}
	if n == 0 {
		return auth.NotFound("Blackout not found")
	}
	return nil
}
