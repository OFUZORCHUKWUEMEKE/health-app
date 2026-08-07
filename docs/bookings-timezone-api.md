# Bookings API — Timezone Handoff

Frontend-facing reference for the new local-time + IANA-timezone request shape on the bookings module.

## TL;DR

- **Send local wall-clock time plus an IANA timezone.** The backend converts to UTC.
- **Responses still carry UTC instants** (`*_at_utc`) plus a `timezone` hint for display.
- Use the browser's own zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) unless the user explicitly picks another.
- Do **not** do any timezone math on the client before sending. Just send what the user picked + the zone.

## Two field shapes

### Local datetime fields (no offset, no `Z`)

Format: `YYYY-MM-DDTHH:mm[:ss]` — no trailing `Z`, no `±HH:mm`.

Examples: `"2026-04-16T10:00:00"`, `"2026-04-16T10:00"`.

Rejected: `"2026-04-16T10:00:00Z"`, `"2026-04-16T10:00:00-06:00"`, `"2026-04-16 10:00"`.

### Timezone fields

Must be a valid IANA zone name: `"America/Edmonton"`, `"Africa/Lagos"`, `"Europe/London"`, `"UTC"`, etc.

Rejected: `"MDT"`, `"GMT-6"`, `"-06:00"`, `"PST"`.

Get the user's zone with:
```js
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
```

## Endpoint-by-endpoint changes

### Book an appointment

`POST /booking/appointments` and `POST /booking/appointments/auto`

Request body (changed fields only):
```json
{
  "scheduled_start_local": "2026-04-16T10:00:00",
  "timezone": "America/Edmonton",
  "requested_duration_minutes": 30,
  "confirm_appointment": true
  // ... other patient/booking fields unchanged
}
```

The patient's local wall-clock time is interpreted in `timezone` and stored as UTC. The appointment is stored with `scheduled_start_at_utc` and `scheduled_end_at_utc` (UTC ISO) plus a `timezone_snapshot` of the *doctor's* availability zone — so if you need to display the appointment on the doctor's side, use `timezone_snapshot`.

Removed: `scheduled_start_at_utc` (old single UTC field).

### Reschedule an appointment

`PATCH /booking/appointments/:id/reschedule` (patient) / `PATCH /booking/appointments/:id/reschedule-doctor` (doctor)

```json
{
  "scheduled_start_local": "2026-03-26T10:00:00",
  "timezone": "America/Edmonton",
  "requested_duration_minutes": 30,
  "requested_specialization": "Cardiology",
  "reason": "Need a different time"
}
```

Removed: `scheduled_start_at_utc`.

### Check a specific doctor's availability

`GET /booking/doctors/:doctorId/check-availability`

Query params:
```
?datetime_local=2026-04-05T10:00:00
&timezone=America/Edmonton
&duration=30
```

Removed: `datetime` (the old UTC ISO query).

### Find the optimal doctor

`GET /booking/doctors/optimal`

Query params:
```
?datetime_local=2026-04-05T10:00:00
&timezone=America/Edmonton
&duration=30
&specialization=Cardiology   // optional
```

Removed: `datetime`.

### Get a doctor's available slots for a date

`GET /booking/doctors/:doctorId/slots`

Query params (unchanged):
```
?date=2026-03-20
```

`date` is a local calendar date (`YYYY-MM-DD`) **in the doctor's availability timezone** — it is not adjusted to the patient's zone. The response includes `timezone` (the doctor's zone) so you can render the slots correctly.

Response:
```json
{
  "doctor_id": "67d4f0be0dc8b8aa6d9f0aaa",
  "date": "2026-03-20",
  "timezone": "Africa/Lagos",
  "slots": [
    { "start_at_utc": "2026-03-20T08:00:00.000Z", "end_at_utc": "2026-03-20T08:30:00.000Z" }
  ]
}
```

To display a slot in the patient's zone, convert `start_at_utc` client-side:
```js
new Date(slot.start_at_utc).toLocaleString('en-US', { timeZone: userTz });
```

### Doctor availability config (upsert)

`PUT /booking/doctors/me/availability`

```json
{
  "timezone": "Africa/Lagos",
  "weekly_slots": [
    { "day_of_week": 1, "start_time": "09:00", "end_time": "13:00", "slot_duration_minutes": 30, "is_active": true }
  ],
  "effective_from": "2026-03-20",
  "effective_to": "2026-12-31"
}
```

Important: `day_of_week` (0=Sun…6=Sat) and `start_time`/`end_time` are **local** to the `timezone` on this document. The backend handles DST automatically — a 09:00 slot stays at 09:00 local across spring-forward / fall-back transitions.

### Doctor blackouts (create)

`POST /booking/doctors/me/blackouts`

```json
{
  "blackouts": [
    {
      "start_local": "2026-03-25T08:00:00",
      "end_local":   "2026-03-25T17:00:00",
      "timezone":    "Africa/Lagos",
      "reason":      "Conference",
      "reccuring":   true
    }
  ]
}
```

Removed: `start_at_utc`, `end_at_utc`.

Each blackout carries its own `timezone` — mixed zones across a doctor's blackout list are fine.

Response carries both the stored UTC instants *and* the timezone used:
```json
{
  "_id": "...",
  "doctor_id": "...",
  "start_at_utc": "2026-03-25T07:00:00.000Z",
  "end_at_utc":   "2026-03-25T16:00:00.000Z",
  "timezone":     "Africa/Lagos",
  "reason":       "Conference",
  "reccuring":    true
}
```

### Appointment listings (`from`/`to` filters)

`GET /booking/appointments?from=…&to=…` and doctor/patient schedule endpoints

Unchanged: `from` and `to` are UTC ISO strings (`2026-03-01T00:00:00.000Z`). These are machine-generated window bounds, not user-picked times, so they stay UTC.

## Responses — what the frontend receives

All date fields returned by the API are one of:

| Field | Format | Example |
| --- | --- | --- |
| `scheduled_start_at_utc`, `scheduled_end_at_utc` | UTC ISO | `"2026-04-16T16:00:00.000Z"` |
| `start_at_utc`, `end_at_utc` (blackouts) | UTC ISO | `"2026-03-25T07:00:00.000Z"` |
| `timezone`, `timezone_snapshot` | IANA zone | `"America/Edmonton"` |
| `date` (slot queries) | Local `YYYY-MM-DD` | `"2026-03-20"` |
| `effective_from`, `effective_to` | Calendar date | `"2026-03-20"` |
| `date_of_birth` | Calendar date | `"1994-05-11"` |

To render a UTC instant in a specific zone:
```js
new Intl.DateTimeFormat('en-US', {
  timeZone: appointment.timezone_snapshot,
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(appointment.scheduled_start_at_utc));
```

## Canonical walk-through

Edmonton patient books a Thursday 10:00 AM consult on 2026-04-16:

1. Client sends:
   ```json
   { "scheduled_start_local": "2026-04-16T10:00:00", "timezone": "America/Edmonton", ... }
   ```
2. Server stores `scheduled_start_at_utc = 2026-04-16T16:00:00.000Z` (MDT, UTC-6) and `timezone_snapshot = "Africa/Lagos"` (if doctor's availability is in Lagos).
3. Patient app reads the appointment back and renders:
   ```
   Thu, Apr 16 · 10:00 AM (America/Edmonton)
   ```
4. Doctor app reads the same record and renders:
   ```
   Thu, Apr 16 · 5:00 PM (Africa/Lagos)
   ```

Both sides display the same instant correctly without any client-side zone math beyond `Intl.DateTimeFormat`.

## Validation errors you may see

- `scheduled_start_local must be an ISO 8601 local datetime without a timezone offset` — client sent `Z` or an offset; strip it before sending.
- `timezone must be a valid IANA timezone` — likely got `"MDT"` / `"GMT-6"` / a raw offset; use `Intl...resolvedOptions().timeZone` instead.
- `Cannot book a past timeslot` — after converting to UTC the instant is in the past. Double-check the user actually picked a future time in their zone.
- `Doctor does not have a slot at this day/time` — the requested instant (converted to UTC and then back into the doctor's zone) doesn't match a `weekly_slots` entry. Surface the slot picker from `GET /doctors/:id/slots` instead of free-form datetime entry where possible.
