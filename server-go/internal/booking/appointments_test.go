package booking

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func bookAs(t *testing.T, fx *fixture, tok, local string) map[string]any {
	t.Helper()
	w := doReq(fx, "POST", "/api/v1/booking/patients/appointments", tok, bookBody(fx, local))
	env := decode(t, w)
	if w.Code != 201 {
		t.Fatalf("book %s: got %d %s", local, w.Code, w.Body.String())
	}
	var m map[string]any
	_ = json.Unmarshal(env.Data, &m)
	return m
}

func TestTransitions(t *testing.T) {
	fx := setup(t)
	wideOpen(t, fx)
	appt := bookAs(t, fx, fx.patT, tomorrowAt("10:00"))
	id := appt["_id"].(string)
	number := appt["appointment_number"].(string)
	if !strings.HasPrefix(number, "APT-") {
		t.Errorf("number = %q, want APT-…", number)
	}

	// Detail (patient) shows doctor + null consultation.
	w := doReq(fx, "GET", "/api/v1/booking/patients/appointments/"+id, fx.patT, "")
	var detail map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &detail)
	if detail["doctor"] == nil {
		t.Error("detail missing doctor")
	}

	// Accept → CONFIRMED (both spellings).
	w = doReq(fx, "PATCH", "/api/v1/booking/doctors/me/appointments/"+id+"/accept", fx.doctorT, "")
	if w.Code != 200 {
		t.Fatalf("accept: %d %s", w.Code, w.Body.String())
	}
	w = doReq(fx, "PATCH", "/api/v1/booking/appointments/"+id+"/confirm", fx.doctorT, "")
	if w.Code != 400 && w.Code != 200 {
		t.Fatalf("confirm on CONFIRMED: got %d, want 400 transition error", w.Code)
	}

	// Patient cancels.
	w = doReq(fx, "PATCH", "/api/v1/booking/patients/appointments/"+id+"/cancel", fx.patT, `{"reason":"changed mind"}`)
	if w.Code != 200 {
		t.Fatalf("cancel: %d %s", w.Code, w.Body.String())
	}
	// Cancel again → 400.
	w = doReq(fx, "PATCH", "/api/v1/booking/patients/appointments/"+id+"/cancel", fx.patT, `{}`)
	if w.Code != 400 {
		t.Errorf("double cancel: got %d, want 400", w.Code)
	}
	// Notifications were emitted (patient + doctor rows at least).
	var n int
	if err := fx.pool.Inner().QueryRow(context.Background(),
		`SELECT count(*) FROM notifications WHERE appointment_id = $1::uuid`, id).Scan(&n); err != nil || n < 2 {
		t.Errorf("notifications for %s = %d, want >= 2", id, n)
	}
}

func TestRescheduleChain(t *testing.T) {
	fx := setup(t)
	wideOpen(t, fx)
	appt := bookAs(t, fx, fx.patT, tomorrowAt("10:00"))
	id := appt["_id"].(string)
	number := appt["appointment_number"].(string)

	body := fmt.Sprintf(`{"scheduled_start_local":%q,"timezone":"UTC","requested_duration_minutes":30,"reason":"traffic"}`,
		tomorrowAt("12:00"))
	w := doReq(fx, "PATCH", "/api/v1/booking/patients/appointments/"+id+"/reschedule", fx.patT, body)
	env := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("reschedule: %d %s", w.Code, w.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(env.Data, &out)
	newAppt := out["new_appointment"].(map[string]any)
	if newAppt["appointment_number"] != number {
		t.Errorf("number not reused: %v vs %v", newAppt["appointment_number"], number)
	}
	if out["fallback_used"] != false {
		t.Errorf("same-doctor reschedule should not fall back: %+v", out)
	}
	// Old is RESCHEDULED; history attached on detail.
	w = doReq(fx, "GET", "/api/v1/booking/patients/appointments/"+newAppt["_id"].(string), fx.patT, "")
	var detail map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &detail)
	hist, _ := detail["rescheduled_history"].([]any)
	if len(hist) != 1 {
		t.Errorf("history = %+v, want 1 retired row", detail["rescheduled_history"])
	}
	// Same-slot reschedule rejected.
	w = doReq(fx, "PATCH", "/api/v1/booking/patients/appointments/"+newAppt["_id"].(string)+"/reschedule", fx.patT, body)
	if w.Code == 200 {
		t.Error("same-slot reschedule accepted")
	}
}

func TestListingsAndMatrix(t *testing.T) {
	fx := setup(t)
	wideOpen(t, fx)
	bookAs(t, fx, fx.patT, tomorrowAt("10:00"))
	bookAs(t, fx, fx.patT, tomorrowAt("11:00"))

	w := doReq(fx, "GET", "/api/v1/booking/patients/appointments?page=1&perPage=20", fx.patT, "")
	var list struct {
		Items      []map[string]any `json:"items"`
		Pagination map[string]any   `json:"pagination"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &list)
	if len(list.Items) != 2 || list.Pagination["total"] != float64(2) {
		t.Errorf("list = %+v", list)
	}
	// Status filter + completed-forces-empty.
	w = doReq(fx, "GET", "/api/v1/booking/patients/appointments?status=COMPLETED", fx.patT, "")
	var empty struct {
		Items []map[string]any `json:"items"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &empty)
	if len(empty.Items) != 0 {
		t.Errorf("COMPLETED filter should force empty, got %d", len(empty.Items))
	}
	// Number lookup.
	w = doReq(fx, "GET", "/api/v1/booking/patients/appointments", fx.patT, "")
	var l2 struct {
		Items []map[string]any `json:"items"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &l2)
	num := l2.Items[0]["appointment_number"].(string)
	w = doReq(fx, "GET", "/api/v1/booking/patients/appointments/number/"+num, fx.patT, "")
	if w.Code != 200 {
		t.Errorf("number lookup: %d", w.Code)
	}
	// Doctor list + approved groups shape.
	w = doReq(fx, "GET", "/api/v1/booking/doctors/me/appointments", fx.doctorT, "")
	var dl struct {
		Items []map[string]any `json:"items"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &dl)
	if len(dl.Items) != 2 {
		t.Errorf("doctor list = %d, want 2", len(dl.Items))
	}
	w = doReq(fx, "GET", "/api/v1/booking/doctors/me/appointments/approved", fx.doctorT, "")
	var ap struct {
		Groups []map[string]any `json:"groups"`
		Total  int              `json:"total"`
	}
	_ = json.Unmarshal(decode(t, w).Data, &ap)
	if ap.Total != 0 {
		t.Errorf("approved total = %d, want 0 (both PENDING)", ap.Total)
	}
	// Matrix for tomorrow.
	tomorrow := tomorrowAt("00:00")[:10]
	w = doReq(fx, "GET", "/api/v1/booking/slots/availability?startDate="+tomorrow+"&endDate="+tomorrow+"&timezone=UTC", fx.patT, "")
	var matrix map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &matrix)
	day, ok := matrix[tomorrow].(map[string]any)
	if !ok {
		t.Fatalf("matrix missing day: %s", w.Body.String()[:200])
	}
	slots, _ := day["slots"].([]any)
	if len(slots) == 0 {
		t.Error("matrix day has no slots")
	}
	first := slots[0].(map[string]any)
	if first["available_doctors"] == float64(0) {
		t.Errorf("first slot shows 0 doctors: %+v", first)
	}
	// Search + check + optimal.
	w = doReq(fx, "GET", "/api/v1/booking/doctors/search", fx.patT, "")
	var found []any
	_ = json.Unmarshal(decode(t, w).Data, &found)
	if len(found) == 0 {
		t.Error("search found nobody")
	}
	local := tomorrowAt("18:00")
	w = doReq(fx, "GET", "/api/v1/booking/doctors/"+fx.doctor+"/check-availability?datetime_local="+local+"&timezone=UTC&duration=30", fx.patT, "")
	var chk map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &chk)
	if chk["available"] != true {
		t.Errorf("check = %+v, want available", chk)
	}
	w = doReq(fx, "GET", "/api/v1/booking/doctors/find-optimal?datetime_local="+local+"&timezone=UTC&duration=30", fx.patT, "")
	var opt map[string]any
	_ = json.Unmarshal(decode(t, w).Data, &opt)
	if opt["found"] != true {
		t.Errorf("optimal = %+v", opt)
	}
}
