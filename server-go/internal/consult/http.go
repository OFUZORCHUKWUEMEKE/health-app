package consult

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/http/middleware"
	"github.com/wizzyszn/Telemex/internal/http/response"
)

// Handler serves consultation lifecycle + history routes.
type Handler struct {
	patient *Service
	doctor  *Service
	issuer  *auth.Issuer
	users   middleware.UserResolver
}

func NewHandler(svc *Service, issuer *auth.Issuer, users middleware.UserResolver) *Handler {
	return &Handler{patient: svc, doctor: svc, issuer: issuer, users: users}
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

func pageParams(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("perPage", "10"))
	return page, perPage
}

func limitOffset(c *gin.Context, def int) (int, int) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(def)))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if limit < 1 {
		limit = def
	}
	if page < 1 {
		page = 1
	}
	return limit, (page - 1) * limit
}

// Register mounts patient + doctor consultation routes. Literal segments
// precede :params on both trees (Nest ordering comments preserved).
func (h *Handler) Register(rg *gin.RouterGroup) {
	p := rg.Group("/patients/consultations")
	p.Use(middleware.Authenticate(h.issuer, h.users, auth.RolePatient))

	p.GET("", h.patientList)
	p.GET("/all", h.patientList)
	p.GET("/consultation/weekly", h.patientWeekly)
	p.GET("/medications", h.patientMedications)
	p.GET("/medications/active", h.patientActiveMedications)
	p.GET("/medications/grouped-by-consultation", h.patientMedsGrouped)
	p.GET("/medications/:id", h.patientMedication)
	p.GET("/medication/:consultation_id", h.patientMedsByConsultation)
	p.GET("/investigations/grouped", h.patientInvestigationsGrouped)
	p.GET("/referrals", h.patientReferrals)
	p.GET("/referrals/grouped", h.patientReferralsGrouped)
	p.GET("/referrals/:referral_id", h.patientReferral)
	p.GET("/:consultation_id/medications/grouped", h.patientMedsByFormulary)
	p.POST("/compliant-history/:consultation_id", h.compliantCreate)
	p.GET("/compliant-history/:consultation_id", h.compliantList)
	p.DELETE("/compliant-history/:id", h.compliantDelete)
	p.PATCH("/investigation-list/:id/upload", h.uploadInvestigationImages)
	p.GET("/:consultation_id/investigation-list", h.patientConsultationInvestigations)
	p.GET("/:consultation_id/referrals", h.patientConsultationReferrals)
	p.GET("/:consultation_id", h.patientDetail)

	d := rg.Group("/doctors/consultations")
	d.Use(middleware.Authenticate(h.issuer, h.users, auth.RoleDoctor))

	d.POST("/appointments/:appointment_id/start", h.start)
	d.PATCH("/:consultation_id/complete", h.complete)
	d.GET("", h.doctorList)
	d.GET("/all", h.doctorAll)
	d.GET("/consultation/weekly", h.doctorWeekly)
	d.GET("/patients/:patient_id/history", h.patientHistory)
	d.GET("/patients/:patient_id/history/consultations", h.historyConsultations)
	d.GET("/patients/:patient_id/history/medications", h.historyMedications)
	d.GET("/patients/:patient_id/history/diagnoses", h.historyDiagnoses)
	d.GET("/patients/:patient_id/history/investigations", h.historyInvestigations)
	d.GET("/:consultation_id", h.doctorDetail)
	d.POST("/:consultation_id/medication", h.medicationCreate)
	d.GET("/:consultation_id/medication", h.medicationList)
	d.GET("/:consultation_id/medications/grouped", h.medicationGrouped)
	d.GET("/medication/:medication_id", h.medicationOne)
	d.PATCH("/medication/:medication_id", h.medicationUpdate)
	d.DELETE("/medication/:medication_id", h.medicationDelete)
	d.GET("/medications/grouped-by-consultation", h.medicationsGroupedDoctor)
	d.POST("/:consultation_id/physical-exam", h.stageCreate("physical-exam"))
	d.GET("/:consultation_id/physical-exam", h.stageGet("physical-exam"))
	d.PATCH("/physical-exam/:id", h.stageUpdate("physical-exam"))
	d.DELETE("/physical-exam/:id", h.stageDelete("physical-exam"))
	d.POST("/:consultation_id/history-taking", h.historyTakingCreate)
	d.GET("/:consultation_id/history-taking", h.stageGet("history-taking"))
	d.PATCH("/history-taking/:id", h.stageUpdate("history-taking"))
	d.DELETE("/history-taking/:id", h.stageDelete("history-taking"))
	d.POST("/:consultation_id/investigation-result", h.stageCreate("investigation-result"))
	d.GET("/:consultation_id/investigation-result", h.stageGet("investigation-result"))
	d.PATCH("/investigation-result/:id", h.stageUpdate("investigation-result"))
	d.DELETE("/investigation-result/:id", h.stageDelete("investigation-result"))
	d.POST("/:consultation_id/investigation-list", h.investigationListCreate)
	d.GET("/:consultation_id/investigation-list", h.investigationListGet)
	d.PATCH("/investigation-list/:id", h.investigationListUpdate)
	d.DELETE("/investigation-list/:id", h.investigationListDelete)
	d.POST("/:consultation_id/treatment-plan", h.stageCreate("treatment-plan"))
	d.GET("/:consultation_id/treatment-plan", h.stageGet("treatment-plan"))
	d.PATCH("/treatment-plan/:id", h.stageUpdate("treatment-plan"))
	d.DELETE("/treatment-plan/:id", h.stageDelete("treatment-plan"))
	d.POST("/:consultation_id/diagnosis-form", h.stageCreate("diagnosis-form"))
	d.GET("/:consultation_id/diagnosis-form", h.stageGet("diagnosis-form"))
	d.PATCH("/diagnosis-form/:id", h.stageUpdate("diagnosis-form"))
	d.DELETE("/diagnosis-form/:id", h.stageDelete("diagnosis-form"))
	d.POST("/:consultation_id/referral", h.referralCreate)
	d.GET("/:consultation_id/referral", h.referralList)
	d.GET("/referrals/grouped", h.referralsGroupedDoctor)
	d.GET("/referral/:referral_id", h.referralOne)
	d.PATCH("/referral/:referral_id", h.referralUpdate)
	d.DELETE("/referral/:referral_id", h.referralDelete)
}

// --- patient handlers -------------------------------------------------------

func (h *Handler) patientList(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	page, perPage := pageParams(c)
	data, err := h.patient.ListPatient(c.Request.Context(), u.ID, page, perPage)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientDetail(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.patient.PatientDetail(c.Request.Context(), u.ID, c.Param("consultation_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientWeekly(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.patient.Weekly(c.Request.Context(), u.ID, "patient")
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientMedications(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	limit, offset := limitOffset(c, 20)
	data, err := h.patient.PatientMedications(c.Request.Context(), u.ID, c.Query("query"), limit, offset)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientActiveMedications(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	limit, offset := limitOffset(c, 20)
	data, err := h.patient.PatientActiveMedications(c.Request.Context(), u.ID, limit, offset)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientMedication(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.patient.PatientMedication(c.Request.Context(), u.ID, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientMedsGrouped(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	page, perPage := pageParams(c)
	data, err := h.patient.MedicationsGroupedByConsultation(c.Request.Context(), u.ID, page, perPage)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientMedsByConsultation(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	// Legacy med list: all medications of one consultation (owned).
	cid := c.Param("consultation_id")
	if _, _, err := h.patient.ownedConsultation(c.Request.Context(), u.ID, cid); err != nil {
		h.fail(c, err)
		return
	}
	data, err := h.patient.ConsultationMedications(c.Request.Context(), cid)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientMedsByFormulary(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.patient.MedicationsGroupedByFormulary(c.Request.Context(), u.ID, c.Param("consultation_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientInvestigationsGrouped(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	page, perPage := pageParams(c)
	groups, pagination, err := h.patient.groupedInvestigations(c.Request.Context(), u.ID, page, perPage)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, map[string]any{"groups": groups, "pagination": pagination}, "Success")
}

func (h *Handler) patientConsultationInvestigations(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.patient.ConsultationInvestigations(c.Request.Context(), u.ID, c.Param("consultation_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientReferrals(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	limit, offset := limitOffset(c, 20)
	data, err := h.patient.PatientReferrals(c.Request.Context(), u.ID, limit, offset)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientReferralsGrouped(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.patient.ReferralsGroupedByConsultation(c.Request.Context(), u.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientReferral(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.patient.PatientReferral(c.Request.Context(), u.ID, c.Param("referral_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientConsultationReferrals(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.patient.ConsultationReferrals(c.Request.Context(), u.ID, c.Param("consultation_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

// --- doctor handlers --------------------------------------------------------

type startDTO struct {
	Type            string `json:"type"`
	ConsoltationFor string `json:"consoltation_for"`
	Title           string `json:"title"`
	Details         string `json:"details"`
	TreatmentPlan   string `json:"treatment_plan"`
}

func (h *Handler) start(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b startDTO
	_ = c.ShouldBindJSON(&b)
	data, err := h.doctor.Start(c.Request.Context(), u.ID, c.Param("appointment_id"), StartInput{
		Type: b.Type, ConsoltationFor: b.ConsoltationFor,
		Title: b.Title, Details: b.Details, TreatmentPlan: b.TreatmentPlan,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusCreated, data, "Success")
}

func (h *Handler) complete(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.doctor.Complete(c.Request.Context(), u.ID, c.Param("consultation_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) doctorList(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	page, perPage := pageParams(c)
	data, err := h.doctor.ListDoctor(c.Request.Context(), u.ID, page, perPage)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) doctorAll(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.doctor.AllDoctor(c.Request.Context(), u.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) doctorDetail(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.doctor.DoctorDetail(c.Request.Context(), u.ID, c.Param("consultation_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) doctorWeekly(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.doctor.Weekly(c.Request.Context(), u.ID, "doctor")
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) patientHistory(c *gin.Context) {
	if _, ok := h.me(c); !ok {
		return
	}
	data, err := h.doctor.PatientHistory(c.Request.Context(), c.Param("patient_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) historyConsultations(c *gin.Context) {
	if _, ok := h.me(c); !ok {
		return
	}
	data, err := h.doctor.HistoryConsultations(c.Request.Context(), c.Param("patient_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) historyMedications(c *gin.Context) {
	if _, ok := h.me(c); !ok {
		return
	}
	data, err := h.doctor.HistoryMedications(c.Request.Context(), c.Param("patient_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) historyDiagnoses(c *gin.Context) {
	if _, ok := h.me(c); !ok {
		return
	}
	data, err := h.doctor.HistoryDiagnoses(c.Request.Context(), c.Param("patient_id"))
	if err != nil {
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) historyInvestigations(c *gin.Context) {
	if _, ok := h.me(c); !ok {
		return
	}
	page, perPage := pageParams(c)
	data, err := h.doctor.HistoryInvestigations(c.Request.Context(), c.Param("patient_id"), page, perPage)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}
