#!/usr/bin/env bash
# Booking latency probe against seeded bench data.
#
# Seed (once): 25 benchdoc* doctors with Mon/Tue 09:00-17:00 UTC availability,
# docs 1-24 blocked on 2026-09-14, one benchpat patient.
#
# Usage:
#   TOKEN=<patient-jwt> DID=<doctor-uuid> ./scripts/bench-booking.sh [base-url]
#
# Prints p50/p95 for day-slots, 7-day matrix, and worst-case find-optimal.
set -euo pipefail
BASE_URL="${1:-http://localhost:4181/api/v1}"
: "${TOKEN:?set TOKEN to a patient JWT}"
: "${DID:?set DID to a doctor UUID}"

hit() { # path [count]
  local path="$1" count="${2:-10}"
  for _ in $(seq 1 "$count"); do
    curl -s -o /dev/null -w "%{time_total}\n" "$BASE_URL$path" -H "Authorization: Bearer $TOKEN"
  done | python3 -c "
import sys
ts = sorted(float(l) for l in sys.stdin if l.strip())
print(f'n={len(ts)} p50={ts[len(ts)//2]*1000:.0f}ms p95={ts[int(len(ts)*0.95)-1]*1000:.0f}ms max={ts[-1]*1000:.0f}ms')"
}

echo -n "day-slots 10x:  "; hit "/booking/doctors/$DID/slots?date=2026-09-14" 10
echo -n "matrix 7d 5x:   "; hit "/booking/slots/availability?startDate=2026-09-14&endDate=2026-09-20&timezone=UTC" 5
echo -n "optimal wc 5x:  "; hit "/booking/doctors/find-optimal?datetime_local=2026-09-14T10:00&timezone=UTC&duration=30" 5
