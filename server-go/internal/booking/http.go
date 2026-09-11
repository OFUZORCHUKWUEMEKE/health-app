package booking

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/response"
)

// Handler serves booking routes.
type Handler struct {
	svc    *Service
	issuer *auth.Issuer
	users  middleware.UserResolver
}

func NewHandler(svc *Service, issuer *auth.Issuer, users middleware.UserResolver) *Handler {
	return &Handler{svc: svc, issuer: issuer, users: users}
}

func (h *Handler) fail(c *gin.Context, err error) {
	if svcErr, ok := err.(*auth.Error); ok {
		if svcErr.Status == http.StatusBadRequest {
			response.FailValidation(c, svcErr.Message, []string{svcErr.Message})
			return
		}
		response.Fail(c, svcErr.Status, svcErr.Message, svcErr.Message)
		return
	}
	response.Fail(c, http.StatusInternalServerError, "An error encountered", "An error encountered")
}

func (h *Handler) me(c *gin.Context) (middleware.CurrentUser, bool) {
	u, ok := middleware.CurrentUserFrom(c)
	if !ok {
		h.fail(c, auth.Unauthorized("Invalid or expired token"))
		return middleware.CurrentUser{}, false
	}
	return u, true
}

// Register mounts /booking routes. Literal segments precede :params.
func (h *Handler) Register(rg *gin.RouterGroup) {
	b := rg.Group("/booking")
	patient := middleware.Authenticate(h.issuer, h.users, auth.RolePatient)
	doctor := middleware.Authenticate(h.issuer, h.users, auth.RoleDoctor)
	// Discovery (patient).
	b.GET("/doctors/search", patient, h.searchDoctors(false))
	b.GET("/doctors/available", patient, h.searchDoctors(true))
	b.GET("/doctors/find-optimal", patient, h.findOptimal)
	b.GET("/doctors/:doctorId/check-availability", patient, h.checkAvailability)
	b.GET("/doctors/:doctorId/slots", patient, h.daySlots)

	// Patient appointments.
	b.POST("/patients/appointments", patient, h.book)
	b.POST("/patients/appointments/auto-book", patient, h.autoBook)
	b.GET("/patients/appointments", patient, h.listPatient)
	b.GET("/patients/appointments/approved", patient, h.approvedPatient)
	b.GET("/patients/appointments/all", patient, h.allPatient)
	b.GET("/patients/appointments/number/:appointmentNumber", patient, h.byNumber)
	b.GET("/patients/appointments/:id", patient, h.detailPatient)
	b.PATCH("/patients/appointments/:id/cancel", patient, h.cancelPatient)
	b.PATCH("/patients/appointments/:id/reschedule", patient, h.reschedulePatient)
	b.GET("/patients/schedule", patient, h.schedulePatient)

	// Shared reads (admin/doctor/patient) + shared doctor actions.
	b.GET("/slots/availability",
		middleware.Authenticate(h.issuer, h.users, auth.RoleAdmin, auth.RoleDoctor, auth.RolePatient),
		h.matrix)
	b.PATCH("/appointments/:id/confirm", doctor, h.accept)
	b.PATCH("/appointments/:id/cancel", doctor, h.cancelDoctorShared)
	b.PATCH("/appointments/:id/complete", doctor, h.complete)
	b.PATCH("/appointments/:id/no-show", doctor, h.noShow)

	// Doctor self-service.
	b.PUT("/doctors/me/availability", doctor, h.upsertAvailability)
	b.GET("/doctors/me/availability", doctor, h.getAvailability)
	b.POST("/doctors/me/blackouts", doctor, h.createBlackouts)
	b.GET("/doctors/me/blackouts", doctor, h.listBlackouts)
	b.DELETE("/doctors/me/blackouts/:id", doctor, h.deleteBlackout)
	b.GET("/doctors/me/schedule", doctor, h.scheduleDoctor)
	b.GET("/doctors/me/appointments", doctor, h.listDoctor)
	b.GET("/doctors/me/appointments/approved", doctor, h.approvedDoctor)
	b.GET("/doctors/me/appointments/all", doctor, h.allDoctor)
	b.GET("/doctors/me/appointments/number/:appointmentNumber", doctor, h.byNumber)
	b.GET("/doctors/me/appointments/:id", doctor, h.detailDoctor)
	b.GET("/doctors/me/patients", doctor, h.doctorPatients)
	b.POST("/doctors/me/availability/test-24-7", doctor, h.testAvailability)
	b.GET("/doctors/me/appointments/:id/accept", doctor, h.accept)
	b.PATCH("/doctors/me/appointments/:id/accept", doctor, h.accept)
	b.PATCH("/doctors/me/appointments/:id/cancel", doctor, h.cancelDoctor)
	b.PATCH("/doctors/me/appointments/:id/reschedule", doctor, h.rescheduleDoctor)
}

// --- discovery --------------------------------------------------------------

func (h *Handler) searchDoctors(onlyAvailable bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		data, err := h.svc.SearchDoctors(c.Request.Context(),
			c.Query("q"), c.Query("specialization"), onlyAvailable)
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, data, "Success")
	}
}

func (h *Handler) findOptimal(c *gin.Context) {
	duration, ok := h.duration(c)
	if !ok {
		return
	}
	local, zone, ok := h.localZone(c)
	if !ok {
		return
	}
	data, err := h.svc.FindOptimal(c.Request.Context(), local, zone, duration, c.Query("specialization"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) checkAvailability(c *gin.Context) {
	duration, ok := h.duration(c)
	if !ok {
		return
	}
	local, zone, ok := h.localZone(c)
	if !ok {
		return
	}
	data, err := h.svc.CheckDoctorSlot(c.Request.Context(), c.Param("doctorId"), local, zone, duration)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) daySlots(c *gin.Context) {
	date := c.Query("date")
	if !ValidDateOnly(date) {
		h.fail(c, auth.BadRequest("Invalid date. Expected format: YYYY-MM-DD"))
		return
	}
	data, err := h.svc.DaySlots(c.Request.Context(), c.Param("doctorId"), date)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) duration(c *gin.Context) (int, bool) {
	d, err := strconv.Atoi(c.Query("duration"))
	if err != nil || !allowedDurations[d] {
		h.fail(c, auth.BadRequest("duration must be one of 15, 30, 45, 60"))
		return 0, false
	}
	return d, true
}

func (h *Handler) localZone(c *gin.Context) (string, string, bool) {
	local, zone := c.Query("datetime_local"), c.Query("timezone")
	if !ValidLocalDateTime(local) {
		h.fail(c, auth.BadRequest("datetime_local must be like YYYY-MM-DDTHH:mm (no offset)"))
		return "", "", false
	}
	if !ValidIANA(zone) {
		h.fail(c, auth.BadRequest("timezone must be a valid IANA timezone"))
		return "", "", false
	}
	return local, zone, true
}

// --- booking ----------------------------------------------------------------

type bookDTO struct {
	FirstName                string   `json:"first_name" binding:"required"`
	LastName                 string   `json:"last_name" binding:"required"`
	DateOfBirth              string   `json:"date_of_birth"`
	Gender                   string   `json:"gender"`
	MaritalStatus            string   `json:"marital_status"`
	Occupation               string   `json:"occupation"`
	PresentComplaint         string   `json:"present_complaint" binding:"required"`
	ReasonForVisit           string   `json:"reason_for_visit"`
	ComplaintBrief           string   `json:"complaint_brief"`
	DoctorID                 string   `json:"doctor_id"`
	Specialization           string   `json:"specialization"`
	ConsultationType         string   `json:"consultation_type"`
	AppointmentFor           string   `json:"appointment_for"`
	ScheduledStartLocal      string   `json:"scheduled_start_local" binding:"required"`
	Timezone                 string   `json:"timezone" binding:"required"`
	RequestedDurationMinutes int      `json:"requested_duration_minutes" binding:"required"`
	ConfirmAppointment       bool     `json:"confirm_appointment"`
	Allergies                []string `json:"allergies"`
	MedicalConditions        []string `json:"Medical_conditions"`
}

func (h *Handler) bookInput(c *gin.Context) (BookInput, bool) {
	var b bookDTO
	if !response.Bind(c, &b) {
		return BookInput{}, false
	}
	if !ValidLocalDateTime(b.ScheduledStartLocal) {
		h.fail(c, auth.BadRequest("scheduled_start_local must be like YYYY-MM-DDTHH:mm (no offset)"))
		return BookInput{}, false
	}
	if !ValidIANA(b.Timezone) {
		h.fail(c, auth.BadRequest("timezone must be a valid IANA timezone"))
		return BookInput{}, false
	}
	if !allowedDurations[b.RequestedDurationMinutes] {
		h.fail(c, auth.BadRequest("requested_duration_minutes must be one of 15, 30, 45, 60"))
		return BookInput{}, false
	}
	if b.DateOfBirth != "" && !ValidDateOnly(b.DateOfBirth) {
		h.fail(c, auth.BadRequest("date_of_birth must be YYYY-MM-DD"))
		return BookInput{}, false
	}
	in := BookInput{
		FirstName: b.FirstName, LastName: b.LastName, DateOfBirth: b.DateOfBirth,
		Gender: b.Gender, MaritalStatus: b.MaritalStatus, Occupation: b.Occupation,
		PresentComplaint: b.PresentComplaint, ReasonForVisit: b.ReasonForVisit,
		ComplaintBrief: b.ComplaintBrief, DoctorID: b.DoctorID,
		Specialization: b.Specialization, ConsultationType: b.ConsultationType,
		AppointmentFor:      b.AppointmentFor,
		ScheduledStartLocal: b.ScheduledStartLocal, Timezone: b.Timezone,
		RequestedDurationMinutes: b.RequestedDurationMinutes,
		ConfirmAppointment:       b.ConfirmAppointment,
		Allergies:                b.Allergies, MedicalConditions: b.MedicalConditions,
		AllergiesSet: b.Allergies != nil, MedicalSet: b.MedicalConditions != nil,
	}
	return in, true
}

func (h *Handler) book(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	in, ok := h.bookInput(c)
	if !ok {
		return
	}
	data, err := h.svc.Book(c.Request.Context(), u.ID, in)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusCreated, data, "Success")
}

func (h *Handler) autoBook(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	in, ok := h.bookInput(c)
	if !ok {
		return
	}
	data, err := h.svc.AutoBook(c.Request.Context(), u.ID, in)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusCreated, data, "Success")
}

// --- patient appointments ---------------------------------------------------

func (h *Handler) listFilter(c *gin.Context) (status string, from, to *time.Time, q string, page, perPage int) {
	status = c.Query("status")
	if f := c.Query("from"); f != "" {
		if t, err := time.Parse(time.RFC3339, f); err == nil {
			from = &t
		}
	}
	if t := c.Query("to"); t != "" {
		if parsed, err := time.Parse(time.RFC3339, t); err == nil {
			to = &parsed
		}
	}
	q = c.Query("q")
	page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ = strconv.Atoi(c.DefaultQuery("perPage", "20"))
	return status, from, to, q, page, perPage
}

func (h *Handler) listPatient(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	status, from, to, q, page, perPage := h.listFilter(c)
	data, err := h.svc.ListPatient(c.Request.Context(), u.ID, status, from, to, q, page, perPage)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) allPatient(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	items, err := h.svc.All(c.Request.Context(), u.ID, "patient")
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, items, "Success")
}

func (h *Handler) approvedPatient(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	week, _ := strconv.Atoi(c.Query("weekly"))
	year, _ := strconv.Atoi(c.Query("year"))
	data, err := h.svc.Approved(c.Request.Context(), u.ID, "patient", week, year)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) detailPatient(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.svc.DetailPatient(c.Request.Context(), u.ID, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) byNumber(c *gin.Context) {
	data, err := h.svc.ByNumber(c.Request.Context(), c.Param("appointmentNumber"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

type reasonDTO struct {
	Reason string `json:"reason"`
}

func (h *Handler) cancelPatient(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b reasonDTO
	_ = c.ShouldBindJSON(&b)
	data, err := h.svc.CancelPatient(c.Request.Context(), u.ID, c.Param("id"), b.Reason)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

type rescheduleDTO struct {
	ScheduledStartLocal      string `json:"scheduled_start_local" binding:"required"`
	Timezone                 string `json:"timezone" binding:"required"`
	RequestedDurationMinutes int    `json:"requested_duration_minutes"`
	Reason                   string `json:"reason"`
	RequestedSpecialization  string `json:"requested_specialization"`
}

func (h *Handler) reschedulePatient(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b rescheduleDTO
	if !response.Bind(c, &b) {
		return
	}
	if !ValidLocalDateTime(b.ScheduledStartLocal) || !ValidIANA(b.Timezone) {
		h.fail(c, auth.BadRequest("scheduled_start_local must be local wall-clock with a valid IANA timezone"))
		return
	}
	duration := b.RequestedDurationMinutes
	if duration == 0 {
		duration = 30
	}
	if !allowedDurations[duration] {
		h.fail(c, auth.BadRequest("requested_duration_minutes must be one of 15, 30, 45, 60"))
		return
	}
	appt, err := h.svc.DetailPatient(c.Request.Context(), u.ID, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	_ = appt
	row, err := h.svc.GetForReschedule(c.Request.Context(), u.ID, "patient", c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	data, err := h.svc.Reschedule(c.Request.Context(), row, "PATIENT", RescheduleInput{
		ScheduledStartLocal: b.ScheduledStartLocal, Timezone: b.Timezone,
		RequestedDurationMinutes: duration, Reason: b.Reason,
		RequestedSpecialization: b.RequestedSpecialization,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) schedulePatient(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	week, _ := strconv.Atoi(c.Query("weekly"))
	year, _ := strconv.Atoi(c.Query("year"))
	data, err := h.svc.PatientSchedule(c.Request.Context(), u.ID, week, year)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) matrix(c *gin.Context) {
	daysAhead, _ := strconv.Atoi(c.Query("days_ahead"))
	data, err := h.svc.Matrix(c.Request.Context(),
		c.Query("startDate"), c.Query("endDate"), c.Query("from"), c.Query("to"),
		daysAhead, c.Query("timezone"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

// --- shared doctor actions --------------------------------------------------

func (h *Handler) accept(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.svc.AcceptDoctor(c.Request.Context(), u.ID, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) cancelDoctorShared(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b reasonDTO
	_ = c.ShouldBindJSON(&b)
	data, err := h.svc.CancelDoctor(c.Request.Context(), u.ID, c.Param("id"), b.Reason)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) complete(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.svc.CompleteDoctor(c.Request.Context(), u.ID, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) noShow(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.svc.NoShowDoctor(c.Request.Context(), u.ID, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

// --- doctor self-service ----------------------------------------------------

type availabilityDTO struct {
	Timezone    string `json:"timezone" binding:"required"`
	WeeklySlots []struct {
		DayOfWeek           int    `json:"day_of_week"`
		StartTime           string `json:"start_time"`
		EndTime             string `json:"end_time"`
		SlotDurationMinutes int    `json:"slot_duration_minutes"`
		IsActive            *bool  `json:"is_active"`
	} `json:"weekly_slots" binding:"required"`
	EffectiveFrom string `json:"effective_from"`
	EffectiveTo   string `json:"effective_to"`
}

func (h *Handler) upsertAvailability(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b availabilityDTO
	if !response.Bind(c, &b) {
		return
	}
	slots := make([]WeeklySlot, 0, len(b.WeeklySlots))
	for _, s := range b.WeeklySlots {
		active := true
		if s.IsActive != nil {
			active = *s.IsActive
		}
		slots = append(slots, WeeklySlot{
			DayOfWeek: s.DayOfWeek, StartTime: s.StartTime,
			EndTime: s.EndTime, Duration: s.SlotDurationMinutes, Active: active,
		})
	}
	var from, to *time.Time
	if b.EffectiveFrom != "" {
		if !ValidDateOnly(b.EffectiveFrom) {
			h.fail(c, auth.BadRequest("effective_from must be YYYY-MM-DD"))
			return
		}
		t, _ := time.Parse("2006-01-02", b.EffectiveFrom)
		from = &t
	}
	if b.EffectiveTo != "" {
		if !ValidDateOnly(b.EffectiveTo) {
			h.fail(c, auth.BadRequest("effective_to must be YYYY-MM-DD"))
			return
		}
		t, _ := time.Parse("2006-01-02", b.EffectiveTo)
		to = &t
	}
	data, err := h.svc.UpsertAvailability(c.Request.Context(), u.ID, b.Timezone, slots, from, to)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) getAvailability(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	avail, slots, err := h.svc.GetAvailability(c.Request.Context(), u.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	items := make([]map[string]any, 0, len(slots))
	for _, s := range slots {
		items = append(items, map[string]any{
			"day_of_week": s.DayOfWeek, "start_time": s.StartTime,
			"end_time": s.EndTime, "slot_duration_minutes": s.Duration,
			"is_active": s.Active,
		})
	}
	response.Success(c, http.StatusOK, map[string]any{
		"_id": avail.ID.String(), "doctor_id": u.ID, "timezone": avail.Timezone,
		"weekly_slots":   items,
		"effective_from": dateOrNull(avail.EffectiveFrom),
		"effective_to":   dateOrNull(avail.EffectiveTo),
	}, "Success")
}

type blackoutsDTO struct {
	Blackouts []struct {
		StartLocal string `json:"start_local" binding:"required"`
		EndLocal   string `json:"end_local" binding:"required"`
		Timezone   string `json:"timezone" binding:"required"`
		Reason     string `json:"reason"`
		Reccuring  bool   `json:"reccuring"`
	} `json:"blackouts" binding:"required"`
}

func (h *Handler) createBlackouts(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b blackoutsDTO
	if !response.Bind(c, &b) {
		return
	}
	inputs := make([]BlackoutInput, 0, len(b.Blackouts))
	for _, e := range b.Blackouts {
		inputs = append(inputs, BlackoutInput{
			StartLocal: e.StartLocal, EndLocal: e.EndLocal,
			Timezone: e.Timezone, Reason: e.Reason, Recurring: e.Reccuring,
		})
	}
	data, err := h.svc.CreateBlackouts(c.Request.Context(), u.ID, inputs)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusCreated, data, "Success")
}

func (h *Handler) listBlackouts(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.svc.ListBlackouts(c.Request.Context(), u.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) deleteBlackout(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	if err := h.svc.DeleteBlackout(c.Request.Context(), u.ID, c.Param("id")); err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, map[string]any{"message": "Blackout deleted"}, "Success")
}

func (h *Handler) testAvailability(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	zone := c.Query("timezone")
	if zone == "" {
		zone = "UTC"
	}
	slots := []WeeklySlot{}
	for d := 0; d < 7; d++ {
		slots = append(slots, WeeklySlot{DayOfWeek: d, StartTime: "00:00", EndTime: "23:45", Duration: 15, Active: true})
	}
	data, err := h.svc.UpsertAvailability(c.Request.Context(), u.ID, zone, slots, nil, nil)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) scheduleDoctor(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	week, _ := strconv.Atoi(c.Query("weekly"))
	year, _ := strconv.Atoi(c.Query("year"))
	data, err := h.svc.DoctorSchedule(c.Request.Context(), u.ID, week, year)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) listDoctor(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	status, from, to, q, page, perPage := h.listFilter(c)
	data, err := h.svc.ListDoctor(c.Request.Context(), u.ID, status, from, to, q, page, perPage)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) allDoctor(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	items, err := h.svc.All(c.Request.Context(), u.ID, "doctor")
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, items, "Success")
}

func (h *Handler) approvedDoctor(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	week, _ := strconv.Atoi(c.Query("weekly"))
	year, _ := strconv.Atoi(c.Query("year"))
	data, err := h.svc.Approved(c.Request.Context(), u.ID, "doctor", week, year)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) detailDoctor(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.svc.DetailDoctor(c.Request.Context(), u.ID, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) doctorPatients(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	// Booking-side alias of the doctor patient feed (same shape as
	// GET /doctors/patients; overlaps by design, see M1 contract).
	data, err := h.svc.PatientFeed(c.Request.Context(), u.ID, c.Query("q"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) cancelDoctor(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b reasonDTO
	_ = c.ShouldBindJSON(&b)
	data, err := h.svc.CancelDoctor(c.Request.Context(), u.ID, c.Param("id"), b.Reason)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) rescheduleDoctor(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b rescheduleDTO
	if !response.Bind(c, &b) {
		return
	}
	if !ValidLocalDateTime(b.ScheduledStartLocal) || !ValidIANA(b.Timezone) {
		h.fail(c, auth.BadRequest("scheduled_start_local must be local wall-clock with a valid IANA timezone"))
		return
	}
	duration := b.RequestedDurationMinutes
	if duration == 0 {
		duration = 30
	}
	row, err := h.svc.GetForReschedule(c.Request.Context(), u.ID, "doctor", c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	data, err := h.svc.Reschedule(c.Request.Context(), row, "DOCTOR", RescheduleInput{
		ScheduledStartLocal: b.ScheduledStartLocal, Timezone: b.Timezone,
		RequestedDurationMinutes: duration, Reason: b.Reason,
		RequestedSpecialization: b.RequestedSpecialization,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}
