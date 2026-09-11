// Package notifications serves in-app notification feeds and the
// appointment reminder sweep. Creation paths (booking/consultation emits)
// write rows directly with event_key dedupe; failures there never fail the
// originating operation (callers ignore emit errors by design — that IS the
// dispatcher contract at this scale: synchronous inserts, no bus).
package notifications

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/notify"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
)

// Service owns feeds and the reminder sweep.
type Service struct {
	DB *postgres.Pool
}

func (s *Service) q() *gen.Queries { return gen.New(s.DB.Inner()) }

func notificationJSON(n gen.Notification) map[string]any {
	return map[string]any{
		"_id": n.ID.String(), "recipient_id": uuidStr(n.RecipientID),
		"recipient_type": n.RecipientType, "type": n.Type, "category": n.Category,
		"title": n.Title, "body": n.Body, "data": jsonBytes(n.Data),
		"appointment_id":  uuidOrNull(n.AppointmentID),
		"consultation_id": uuidOrNull(n.ConsultationID),
		"actor_id":        uuidOrNull(n.ActorID), "actor_type": textOrNull(n.ActorType),
		"deep_link": textOrNull(n.DeepLink),
		"is_read":   n.IsRead, "read_at": isoOrNull(n.ReadAt),
		"event_key": n.EventKey,
		"createdAt": isoOrNull(n.CreatedAt), "updatedAt": isoOrNull(n.UpdatedAt),
	}
}

// Feed returns newest-first items with bundled unread count (Nest parity:
// the feed carries unread_count so badges render without a second call).
func (s *Service) Feed(ctx context.Context, recipientID, recipientType, status, category, typ string, page, perPage int) (map[string]any, error) {
	var rid pgtype.UUID
	if err := rid.Scan(recipientID); err != nil {
		return nil, auth.NotFound("Account not found")
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 20
	}
	if perPage > 100 {
		perPage = 100
	}
	rows, err := s.q().ListNotifications(ctx, gen.ListNotificationsParams{
		RecipientID: rid, RecipientType: recipientType,
		Column3: status, Column4: category, Column5: typ,
		Limit: int32(perPage), Offset: int32((page - 1) * perPage),
	})
	if err != nil {
		return nil, err
	}
	total, err := s.q().CountNotifications(ctx, gen.CountNotificationsParams{
		RecipientID: rid, RecipientType: recipientType,
		Column3: status, Column4: category, Column5: typ,
	})
	if err != nil {
		return nil, err
	}
	unread, err := s.q().CountUnread(ctx, gen.CountUnreadParams{
		RecipientID: rid, RecipientType: recipientType,
	})
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		items = append(items, notificationJSON(r))
	}
	pages := 0
	if perPage > 0 {
		pages = int((total + int64(perPage) - 1) / int64(perPage))
	}
	return map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page": page, "perPage": perPage, "total": total, "totalPages": pages,
		},
		"unread_count": unread,
	}, nil
}

// UnreadCount returns the badge number.
func (s *Service) UnreadCount(ctx context.Context, recipientID, recipientType string) (map[string]any, error) {
	var rid pgtype.UUID
	if err := rid.Scan(recipientID); err != nil {
		return nil, auth.NotFound("Account not found")
	}
	n, err := s.q().CountUnread(ctx, gen.CountUnreadParams{
		RecipientID: rid, RecipientType: recipientType,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"unread": n}, nil
}

// MarkRead flips one owned row (404 when foreign/missing).
func (s *Service) MarkRead(ctx context.Context, recipientID, recipientType, id string) (map[string]any, error) {
	var rid, nid pgtype.UUID
	if err := rid.Scan(recipientID); err != nil {
		return nil, auth.NotFound("Account not found")
	}
	if err := nid.Scan(id); err != nil {
		return nil, auth.NotFound("Notification not found")
	}
	row, err := s.q().MarkNotificationRead(ctx, gen.MarkNotificationReadParams{
		ID: nid, RecipientID: rid, RecipientType: recipientType,
	})
	if err != nil {
		return nil, auth.NotFound("Notification not found")
	}
	return notificationJSON(row), nil
}

// MarkAllRead flips every unread owned row, reporting the modified count.
func (s *Service) MarkAllRead(ctx context.Context, recipientID, recipientType string) (map[string]any, error) {
	var rid pgtype.UUID
	if err := rid.Scan(recipientID); err != nil {
		return nil, auth.NotFound("Account not found")
	}
	n, err := s.q().MarkAllNotificationsRead(ctx, gen.MarkAllNotificationsReadParams{
		RecipientID: rid, RecipientType: recipientType,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"modified": n}, nil
}

// Delete removes one owned row (404 when foreign/missing — the frontend
// treats that as already-gone).
func (s *Service) Delete(ctx context.Context, recipientID, recipientType, id string) (map[string]any, error) {
	var rid, nid pgtype.UUID
	if err := rid.Scan(recipientID); err != nil {
		return nil, auth.NotFound("Account not found")
	}
	if err := nid.Scan(id); err != nil {
		return nil, auth.NotFound("Notification not found")
	}
	n, err := s.q().DeleteNotification(ctx, gen.DeleteNotificationParams{
		ID: nid, RecipientID: rid, RecipientType: recipientType,
	})
	if err != nil || n == 0 {
		return nil, auth.NotFound("Notification not found")
	}
	return map[string]any{"deleted": true}, nil
}

// --- reminder sweep ---------------------------------------------------------

// SweepResult counts claimed + notified rows per offset.
type SweepResult struct {
	Dispatched24H int `json:"dispatched_24h"`
	Dispatched1H  int `json:"dispatched_1h"`
}

// Dispatch claims due reminders atomically (UPDATE…WHERE sent_at IS NULL…]'
// RETURNING — concurrent sweepers cannot double-claim) and emits patient +
// doctor rows. Reruns are no-ops via the claim columns + event_key dedupe.
func (s *Service) Dispatch(ctx context.Context) (SweepResult, error) {
	var out SweepResult
	for _, offset := range []int{1440, 60} {
		claimed, err := s.claim(ctx, offset)
		if err != nil {
			return out, err
		}
		for _, appt := range claimed {
			s.remind(ctx, appt, offset)
		}
		if offset == 1440 {
			out.Dispatched24H = len(claimed)
		} else {
			out.Dispatched1H = len(claimed)
		}
	}
	return out, nil
}

func (s *Service) claim(ctx context.Context, offset int) ([]gen.Appointment, error) {
	if offset == 1440 {
		return s.q().ClaimReminder24H(ctx)
	}
	return s.q().ClaimReminder1H(ctx)
}

func (s *Service) remind(ctx context.Context, appt gen.Appointment, offset int) {
	if !appt.PatientID.Valid || !appt.DoctorID.Valid || !appt.ScheduledStartAtUtc.Valid {
		return
	}
	start := appt.ScheduledStartAtUtc.Time
	minutes := int(time.Until(start).Minutes())
	if minutes < 0 {
		minutes = 0
	}
	zone := appt.TimezoneSnapshot
	if zone == "" {
		zone = "UTC"
	}
	patientID := appt.PatientID.String()
	doctorID := appt.DoctorID.String()
	// Counterparty names + recipient zones (best-effort; fallbacks inside).
	var doctorName, patientName, patientZone, doctorZone string
	patientZone = zone
	doctorZone = zone
	if doc, err := s.q().GetDoctorByID(ctx, appt.DoctorID); err == nil {
		doctorName = strings.TrimSpace(doc.FirstName + " " + doc.LastName)
		if doc.Timezone.Valid && doc.Timezone.String != "" {
			doctorZone = doc.Timezone.String
		}
	}
	if user, err := s.q().GetPatientByID(ctx, appt.PatientID); err == nil {
		patientName = strings.TrimSpace(user.FirstName + " " + user.LastName)
		if user.Timezone.Valid && user.Timezone.String != "" {
			patientZone = user.Timezone.String
		}
	}
	data := map[string]any{
		"appointment_id": appt.ID.String(), "offset_minutes": offset,
	}
	emit := func(spec notify.Spec) {
		raw, _ := jsonMarshal(spec.Data)
		_ = s.q().CreateNotification(ctx, gen.CreateNotificationParams{
			RecipientID: uuidMust(spec.RecipientID), RecipientType: spec.RecipientType,
			Type: spec.Type, Category: spec.Category, Title: spec.Title, Body: spec.Body,
			Data:           raw,
			AppointmentID:  appt.ID,
			ConsultationID: pgtype.UUID{},
			ActorID:        pgtype.UUID{},
			ActorType:      pgtype.Text{},
			DeepLink:       pgtype.Text{String: spec.DeepLink, Valid: spec.DeepLink != ""},
			EventKey:       spec.EventKey,
		})
	}
	emit(notify.AppointmentReminder(notify.AppointmentReminderArgs{
		RecipientID: patientID, RecipientType: notify.RecipientPatient,
		AppointmentID:     appt.ID.String(),
		Counterparty:      &notify.Person{FullName: doctorName},
		When:              notify.FormatWhen(start, patientZone, zone),
		MinutesUntilStart: minutes, OffsetMinutes: offset, Data: data,
	}))
	emit(notify.AppointmentReminder(notify.AppointmentReminderArgs{
		RecipientID: doctorID, RecipientType: notify.RecipientDoctor,
		AppointmentID:     appt.ID.String(),
		Counterparty:      &notify.Person{FullName: patientName},
		When:              notify.FormatWhen(start, doctorZone, zone),
		MinutesUntilStart: minutes, OffsetMinutes: offset, Data: data,
	}))
}

func uuidMust(id string) pgtype.UUID {
	var uid pgtype.UUID
	_ = uid.Scan(id)
	return uid
}

func uuidStr(v pgtype.UUID) string {
	if v.Valid {
		return v.String()
	}
	return ""
}

func uuidOrNull(v pgtype.UUID) any {
	if v.Valid {
		return v.String()
	}
	return nil
}

func textOrNull(v pgtype.Text) any {
	if v.Valid {
		return v.String
	}
	return nil
}

func isoOrNull(v pgtype.Timestamptz) any {
	if v.Valid {
		return v.Time.UTC().Format(time.RFC3339Nano)
	}
	return nil
}

func jsonBytes(raw []byte) any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return map[string]any{}
	}
	return v
}

func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

var _ = strings.TrimSpace
