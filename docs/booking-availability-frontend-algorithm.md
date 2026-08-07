# Booking Availability Frontend Algorithm

This document describes how the frontend should consume:

```http
GET /api/v1/booking/slots/availability
```

The endpoint returns a system-wide availability matrix keyed by date. Each slot is a 15-minute start window.

## Query Strategy

Prefer the explicit date range used by the booking wizard:

```http
GET /api/v1/booking/slots/availability?startDate=2026-06-08&endDate=2026-06-14&timezone=America/Edmonton
```

Supported range modes:

- `startDate` + `endDate`: explicit date range.
- `from` + `to`: legacy aliases.
- `days_ahead=N`: next `N` days starting today in UTC.
- No range params: defaults to the next 14 days.

Always pass the user's timezone when possible. If omitted, the backend defaults to `UTC`.

## Response Shape

```json
{
  "success": true,
  "response_code": "00",
  "response_description": "Success",
  "data": {
    "2026-06-08": {
      "slots": [
        {
          "time": "09:00 AM",
          "available_doctors": 3,
          "max_consecutive_slots": 4
        }
      ]
    }
  }
}
```

Field meaning:

- `available_doctors`: number of unique doctors free at this exact 15-minute timestamp.
- `max_consecutive_slots`: maximum number of continuous 15-minute blocks a single doctor can fulfill starting at this exact timestamp. Maximum value is `4`.

## Core UI Rules

Disable a slot button when:

- The slot is missing from the backend response.
- `available_doctors <= 0`.

Allow a user to start a selection from a slot when:

- The slot exists.
- `available_doctors > 0`.

Allow the user to extend a selection only when:

- The selected blocks are consecutive 15-minute windows.
- The number of selected blocks is less than or equal to the starting slot's `max_consecutive_slots`.
- The number of selected blocks is less than or equal to `4`.

Do not validate a multi-slot selection by summing `available_doctors` across slots. Adjacent slots may be available because different doctors are free at each timestamp. A single appointment cannot switch doctors halfway through.

## Recommended State Model

Normalize the API response into a date-keyed lookup:

```ts
type AvailabilitySlot = {
  time: string;
  available_doctors: number;
  max_consecutive_slots: number;
};

type DayAvailability = {
  slots: AvailabilitySlot[];
};

type AvailabilityByDate = Record<string, DayAvailability>;
```

For easier selection logic, also build a map per day:

```ts
type SlotLookup = Record<string, AvailabilitySlot>;
```

Where the key is the display time, for example `"09:00 AM"`.

## Selection Algorithm

Use the first selected slot as the anchor. Its `max_consecutive_slots` controls the entire selection.

```ts
const MAX_UI_BLOCKS = 4;

function canStartSelection(slot?: AvailabilitySlot): boolean {
  return Boolean(slot && slot.available_doctors > 0);
}

function canSelectDurationFromStart(
  startSlot: AvailabilitySlot,
  requestedBlocks: number,
): boolean {
  if (requestedBlocks < 1) return false;
  if (requestedBlocks > MAX_UI_BLOCKS) return false;
  return requestedBlocks <= startSlot.max_consecutive_slots;
}
```

Example:

```ts
const startSlot = {
  time: '11:00 AM',
  available_doctors: 1,
  max_consecutive_slots: 1,
};

canSelectDurationFromStart(startSlot, 1); // true, 15 minutes
canSelectDurationFromStart(startSlot, 2); // false, 30 minutes
```

## Click Flow

1. User opens the booking wizard.
2. Frontend fetches the date range for the visible week.
3. Frontend renders all expected 15-minute UI times.
4. For each expected time:
   - Look up the backend slot.
   - If missing, render disabled.
   - If present with `available_doctors === 0`, render disabled.
   - Otherwise render enabled.
5. When user clicks a start slot:
   - Store `selectedDate`.
   - Store `startTime`.
   - Store `startSlot.max_consecutive_slots`.
   - Default selected duration to 1 block.
6. When user tries to extend duration:
   - Convert desired duration to blocks: `durationMinutes / 15`.
   - Allow only if `blocks <= startSlot.max_consecutive_slots`.
   - Reject immediately if greater.
7. When user proceeds to find/book doctor:
   - Send the chosen start time and duration to the booking endpoint.
   - Treat backend booking validation as final authority.

## Consecutive Slot Example

Backend sees:

- Dr. Emeka: free `09:00-10:00`.
- Dr. Fatima: free `09:00-09:30`.
- Dr. Tunde: free `09:00-09:15`.

Response:

```json
{
  "time": "09:00 AM",
  "available_doctors": 3,
  "max_consecutive_slots": 4
}
```

The frontend may allow a 1-hour booking from `09:00 AM`.

## Doctor-Switching Edge Case

Backend sees:

- Dr. Emeka: free `11:00-11:15`.
- Dr. Fatima: free `11:15-11:30`.

Response:

```json
[
  {
    "time": "11:00 AM",
    "available_doctors": 1,
    "max_consecutive_slots": 1
  },
  {
    "time": "11:15 AM",
    "available_doctors": 1,
    "max_consecutive_slots": 1
  }
]
```

The frontend must not allow a 30-minute booking from `11:00 AM`, even though both visible slot buttons are individually available.

## Missing Slots

If a time is missing from the response, treat it as unavailable.

Example:

```ts
const backendSlot = slotsByTime['03:00 AM'];

if (!backendSlot) {
  disableButton();
}
```

Missing means no doctor has configured availability for that timestamp. It is different from `available_doctors: 0`, which means at least one doctor schedule covers that timestamp but all covering doctors are blocked or booked.

## Refresh Timing

Availability can change while the user is in the wizard. Recommended behavior:

- Fetch when the date/week view opens.
- Refetch when the user changes week/date range.
- Refetch before final booking confirmation.
- If the final booking endpoint rejects availability, refresh the matrix and show the user the updated disabled/available state.

