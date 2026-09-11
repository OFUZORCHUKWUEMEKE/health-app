package consult

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/http/response"
)

// clinical_http.go: M14 stage handlers (doctor writes, patient compliant
// history + image upload).

// --- generic singleton handlers ---------------------------------------------

func (h *Handler) stageCreate(stage string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := h.me(c)
		if !ok {
			return
		}
		var body map[string]any
		_ = c.ShouldBindJSON(&body)
		if body == nil {
			body = map[string]any{}
		}
		var data map[string]any
		var err error
		switch stage {
		case "history-taking":
			data, err = h.doctor.CreateHistoryTaking(c.Request.Context(), u.ID, c.Param("consultation_id"), historyTakingInputOf(body))
		case "physical-exam":
			data, err = h.doctor.CreatePhysicalExam(c.Request.Context(), u.ID, c.Param("consultation_id"), physicalExamInputOf(body))
		case "investigation-result":
			data, err = h.doctor.CreateInvestigationResult(c.Request.Context(), u.ID, c.Param("consultation_id"), investigationResultInputOf(body))
		case "treatment-plan":
			data, err = h.doctor.CreateTreatmentPlan(c.Request.Context(), u.ID, c.Param("consultation_id"), TreatmentPlanInput{
				Details: strField(body, "treatment_plan_details"), Status: strField(body, "status"),
			})
		case "diagnosis-form":
			data, err = h.doctor.CreateDiagnosisForm(c.Request.Context(), u.ID, c.Param("consultation_id"), DiagnosisFormInput{
				Provisional: strList(body, "provisional_diagnosis"),
				Final:       strList(body, "final_diagnosis"),
				Status:      strField(body, "status"),
			})
		default:
			h.fail(c, auth.BadRequest("Unknown stage"))
			return
		}
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusCreated, data, "Success")
	}
}

func (h *Handler) stageGet(stage string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := h.me(c)
		if !ok {
			return
		}
		data, err := h.doctor.StageRecord(c.Request.Context(), u.ID, c.Param("consultation_id"), stage)
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, data, "Success")
	}
}

func (h *Handler) stageUpdate(stage string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := h.me(c)
		if !ok {
			return
		}
		var body map[string]any
		if !response.Bind(c, &body) {
			return
		}
		data, err := h.doctor.UpdateStageRecord(c.Request.Context(), u.ID, c.Param("id"), stage, body)
		if err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, data, "Success")
	}
}

func (h *Handler) stageDelete(stage string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := h.me(c)
		if !ok {
			return
		}
		if err := h.doctor.DeleteStageRecord(c.Request.Context(), u.ID, c.Param("id"), stage); err != nil {
			h.fail(c, err)
			return
		}
		response.Success(c, http.StatusOK, map[string]any{"message": "Deleted successfully"}, "Success")
	}
}

func strField(body map[string]any, k string) string {
	str, _ := body[k].(string)
	return str
}

func strList(body map[string]any, k string) []string {
	raw, ok := body[k].([]any)
	if !ok {
		if s, ok := body[k].([]string); ok {
			return s
		}
		return nil
	}
	out := []string{}
	for _, item := range raw {
		if str, ok := item.(string); ok {
			out = append(out, str)
		}
	}
	return out
}

func historyTakingInputOf(body map[string]any) HistoryTakingInput {
	return HistoryTakingInput{
		PresentComplaint:               strField(body, "present_complaint"),
		HistoryOfPresentingComplaint:   strField(body, "history_of_presenting_complaint"),
		PastMedicalSurgicalHistory:     strField(body, "past_medical_surgical_history"),
		MedicationHistory:              strField(body, "medication_history"),
		AllergyHistory:                 strList(body, "allergy_history"),
		FamilyHistory:                  strField(body, "family_history"),
		TravelHistory:                  strField(body, "travel_history"),
		Occupation:                     strField(body, "occupation"),
		SocialHistory:                  strField(body, "social_history"),
		ObstetricGynaecologicalHistory: strField(body, "obstetric_gynaecological_history"),
		Others:                         strField(body, "others"),
		Status:                         strField(body, "status"),
	}
}

func physicalExamInputOf(body map[string]any) PhysicalExamInput {
	systems := map[string]string{}
	for _, k := range []string{"general_physical", "nervous_system", "respiratory_system",
		"cardiovascular_system", "gastrointestinal_system", "genitourinary_system",
		"musculoskeletal_system", "ent", "obstetric_gynaecological", "others"} {
		if str, ok := body[k].(string); ok {
			systems[k] = str
		}
	}
	return PhysicalExamInput{Systems: systems, Status: strField(body, "status")}
}

func investigationResultInputOf(body map[string]any) InvestigationResultInput {
	fields := map[string]string{}
	for _, k := range []string{"blood_test", "microbiology", "radiology",
		"cardiovascular", "procedures", "others"} {
		if str, ok := body[k].(string); ok {
			fields[k] = str
		}
	}
	return InvestigationResultInput{Fields: fields, Status: strField(body, "status")}
}

func (h *Handler) historyTakingCreate(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var body map[string]any
	if !response.Bind(c, &body) {
		return
	}
	data, err := h.doctor.CreateHistoryTaking(c.Request.Context(), u.ID, c.Param("consultation_id"), historyTakingInputOf(body))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusCreated, data, "Success")
}

// --- medications ------------------------------------------------------------

type medicationItemDTO struct {
	Formulary        string  `json:"formulary"`
	Medication       string  `json:"medication"`
	Dose             float64 `json:"dose"`
	Unit             string  `json:"unit"`
	Interval         string  `json:"interval"`
	Duration         float64 `json:"duration"`
	DurationUnit     string  `json:"duration_unit"`
	OrderInstruction string  `json:"order_instruction"`
	StartDate        string  `json:"start_date"`
	AssignToPatient  bool    `json:"assign_to_patient"`
	Status           string  `json:"status"`
}

type medicationsDTO struct {
	Medications []medicationItemDTO `json:"medications" binding:"required"`
}

func (h *Handler) medicationCreate(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	// Accept both {medications:[...]} and a bare array.
	rawBody, _ := c.GetRawData()
	var items []medicationItemDTO
	var wrapped medicationsDTO
	if err := json.Unmarshal(rawBody, &wrapped); err == nil && wrapped.Medications != nil {
		items = wrapped.Medications
	} else if err := json.Unmarshal(rawBody, &items); err != nil {
		h.fail(c, auth.BadRequest("medications must be an array"))
		return
	}
	inputs := make([]MedicationInput, 0, len(items))
	for _, m := range items {
		inputs = append(inputs, MedicationInput{
			Formulary: m.Formulary, Medication: m.Medication, Dose: m.Dose,
			Unit: m.Unit, Interval: m.Interval, Duration: m.Duration,
			DurationUnit: m.DurationUnit, OrderInstruction: m.OrderInstruction,
			StartDate: m.StartDate, AssignToPatient: m.AssignToPatient, Status: m.Status,
		})
	}
	data, err := h.doctor.CreateMedications(c.Request.Context(), u.ID, c.Param("consultation_id"), inputs)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusCreated, data, "Success")
}

func (h *Handler) medicationList(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	// Doctor-scoped med list for one consultation.
	cid := c.Param("consultation_id")
	if _, _, err := h.doctor.ownedConsultation(c.Request.Context(), u.ID, cid); err != nil {
		// ownedConsultation is patient-scoped; use workspace check instead.
		if _, werr := h.doctor.ownedWorkspace(c.Request.Context(), u.ID, cid); werr != nil {
			h.fail(c, werr)
			return
		}
	}
	data, err := h.doctor.ConsultationMedications(c.Request.Context(), cid)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) medicationGrouped(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	cid := c.Param("consultation_id")
	if _, _, err := h.doctor.ownedConsultation(c.Request.Context(), u.ID, cid); err != nil {
		if _, werr := h.doctor.ownedWorkspace(c.Request.Context(), u.ID, cid); werr != nil {
			h.fail(c, werr)
			return
		}
	}
	// Reuse the patient formulary grouping (identical shape).
	rows, err := h.doctor.ConsultationMedications(c.Request.Context(), cid)
	if err != nil {
		h.fail(c, err)
		return
	}
	byForm := map[string][]map[string]any{}
	order := []string{}
	for _, r := range rows {
		f, _ := r["formulary"].(string)
		if _, ok := byForm[f]; !ok {
			order = append(order, f)
		}
		byForm[f] = append(byForm[f], r)
	}
	groups := make([]map[string]any, 0, len(order))
	for _, f := range order {
		groups = append(groups, map[string]any{
			"formulary": f, "count": len(byForm[f]), "medications": byForm[f],
		})
	}
	response.Success(c, http.StatusOK, map[string]any{
		"consultation_id": cid, "total": len(rows), "groups": groups,
	}, "Success")
}

func (h *Handler) medicationOne(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.doctor.MedicationOne(c.Request.Context(), u.ID, c.Param("medication_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) medicationUpdate(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var body map[string]any
	if !response.Bind(c, &body) {
		return
	}
	data, err := h.doctor.UpdateMedication(c.Request.Context(), u.ID, c.Param("medication_id"), body)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) medicationDelete(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	if err := h.doctor.DeleteStageRecord(c.Request.Context(), u.ID, c.Param("medication_id"), "medication"); err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, map[string]any{"message": "Deleted successfully"}, "Success")
}

func (h *Handler) medicationsGroupedDoctor(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	page, perPage := pageParams(c)
	data, err := h.doctor.MedicationsGroupedDoctor(c.Request.Context(), u.ID, page, perPage)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

// --- investigation lists ----------------------------------------------------

type investigationListDTO struct {
	Investigations []struct {
		Category      string `json:"category"`
		TestRequested string `json:"test_requested"`
		Priority      string `json:"priority"`
		Specimen      string `json:"specimen"`
	} `json:"investigations"`
	AssignToPatient bool `json:"assign_to_patient"`
}

func (h *Handler) investigationListCreate(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b investigationListDTO
	if !response.Bind(c, &b) {
		return
	}
	items := make([]InvestigationListInput, 0, len(b.Investigations))
	for _, it := range b.Investigations {
		items = append(items, InvestigationListInput{
			Category: it.Category, TestRequested: it.TestRequested,
			Priority: it.Priority, Specimen: it.Specimen,
		})
	}
	data, err := h.doctor.CreateInvestigationLists(c.Request.Context(), u.ID, c.Param("consultation_id"), items, b.AssignToPatient)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusCreated, data, "Success")
}

func (h *Handler) investigationListGet(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	// Doctor-scoped list for one consultation.
	cid := c.Param("consultation_id")
	if _, err := h.doctor.ownedWorkspace(c.Request.Context(), u.ID, cid); err != nil {
		h.fail(c, err)
		return
	}
	data, err := h.doctor.ConsultationInvestigationLists(c.Request.Context(), cid)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) investigationListUpdate(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var body map[string]any
	if !response.Bind(c, &body) {
		return
	}
	data, err := h.doctor.UpdateInvestigationList(c.Request.Context(), u.ID, c.Param("id"), body)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) investigationListDelete(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	if err := h.doctor.DeleteStageRecord(c.Request.Context(), u.ID, c.Param("id"), "investigation-list"); err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, map[string]any{"message": "Deleted successfully"}, "Success")
}

// --- referrals --------------------------------------------------------------

type referralDTO struct {
	SpecialistName             string   `json:"specialist_name"`
	Specialty                  string   `json:"specialty"`
	Hospital                   string   `json:"hospital"`
	HospitalAddress            []string `json:"hospital_address"`
	AttachmentInvestigationIDs []string `json:"attachment_investigation_ids"`
	ReferralDetails            string   `json:"referral_details"`
	ReferredDoctorName         string   `json:"referred_doctor_name"`
	AssignToPatient            bool     `json:"assign_to_patient"`
}

func (h *Handler) referralCreate(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b referralDTO
	if !response.Bind(c, &b) {
		return
	}
	data, err := h.doctor.CreateReferral(c.Request.Context(), u.ID, c.Param("consultation_id"), ReferralInput{
		SpecialistName: b.SpecialistName, Specialty: b.Specialty, Hospital: b.Hospital,
		HospitalAddress: b.HospitalAddress, AttachmentInvestigationIDs: b.AttachmentInvestigationIDs,
		ReferralDetails: b.ReferralDetails, ReferredDoctorName: b.ReferredDoctorName,
		AssignToPatient: b.AssignToPatient,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusCreated, data, "Success")
}

func (h *Handler) referralList(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	cid := c.Param("consultation_id")
	if _, err := h.doctor.ownedWorkspace(c.Request.Context(), u.ID, cid); err != nil {
		h.fail(c, err)
		return
	}
	data, err := h.doctor.ConsultationReferralsForDoctor(c.Request.Context(), cid)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) referralsGroupedDoctor(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	page, perPage := pageParams(c)
	data, err := h.doctor.ReferralsGroupedDoctor(c.Request.Context(), u.ID, page, perPage)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) referralOne(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.doctor.ReferralOne(c.Request.Context(), u.ID, c.Param("referral_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) referralUpdate(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var body map[string]any
	if !response.Bind(c, &body) {
		return
	}
	data, err := h.doctor.UpdateReferral(c.Request.Context(), u.ID, c.Param("referral_id"), body)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func (h *Handler) referralDelete(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	if err := h.doctor.DeleteStageRecord(c.Request.Context(), u.ID, c.Param("referral_id"), "referral"); err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, map[string]any{"message": "Deleted successfully"}, "Success")
}

// --- patient compliant history + image upload -------------------------------

type compliantDTO struct {
	PastMedicalHistory string `json:"past_medical_history"`
	Medication         string `json:"medication"`
	Allergy            string `json:"allergy"`
	Family             string `json:"family"`
	Travel             string `json:"travel"`
	Occupation         string `json:"occupation"`
	Social             string `json:"social"`
}

func (h *Handler) compliantCreate(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	var b compliantDTO
	if !response.Bind(c, &b) {
		return
	}
	data, err := h.patient.CreateCompliantHistory(c.Request.Context(), u.ID, c.Param("consultation_id"), CompliantInput{
		PastMedicalHistory: b.PastMedicalHistory, Medication: b.Medication,
		Allergy: b.Allergy, Family: b.Family, Travel: b.Travel,
		Occupation: b.Occupation, Social: b.Social,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	// Preserved quirk: this POST returns 201.
	response.Success(c, http.StatusCreated, data, "Success")
}

func (h *Handler) compliantList(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	data, err := h.patient.CompliantHistories(c.Request.Context(), u.ID, c.Param("consultation_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	// Preserved quirk: this GET returns 201.
	response.Success(c, http.StatusCreated, data, "Success")
}

func (h *Handler) compliantDelete(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	if err := h.patient.DeleteCompliantHistory(c.Request.Context(), u.ID, c.Param("id")); err != nil {
		h.fail(c, err)
		return
	}
	// Preserved quirk: this DELETE returns 201.
	response.Success(c, http.StatusCreated, map[string]any{"message": "Deleted successfully"}, "Success")
}

func (h *Handler) uploadInvestigationImages(c *gin.Context) {
	u, ok := h.me(c)
	if !ok {
		return
	}
	if !strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		h.fail(c, auth.BadRequest("At least one result image is required"))
		return
	}
	if err := c.Request.ParseMultipartForm(10<<20 + 10*(10<<20)); err != nil {
		h.fail(c, auth.BadRequest("Invalid multipart body"))
		return
	}
	var blobs []files.Upload
	if c.Request.MultipartForm != nil {
		for _, key := range []string{"files", "images", "result_images"} {
			for _, fh := range c.Request.MultipartForm.File[key] {
				if fh.Size > 10<<20 {
					h.fail(c, auth.BadRequest("Each file must be at most 10MB"))
					return
				}
				f, err := fh.Open()
				if err != nil {
					continue
				}
				data, err := io.ReadAll(io.LimitReader(f, (10<<20)+1))
				f.Close()
				if err != nil || len(data) == 0 {
					continue
				}
				blobs = append(blobs, files.Upload{
					Data:        data,
					ContentType: fh.Header.Get("Content-Type"),
					Filename:    fh.Filename,
				})
			}
		}
	}
	if len(blobs) > 10 {
		h.fail(c, auth.BadRequest("At most 10 files are allowed"))
		return
	}
	data, err := h.patient.UploadInvestigationImages(c.Request.Context(), u.ID, c.Param("id"), blobs)
	if err != nil {
		h.fail(c, err)
		return
	}
	response.Success(c, http.StatusOK, data, "Success")
}

func strOrEmpty(v any) string {
	str, _ := v.(string)
	return str
}

var _ = strOrEmpty
var _ = strconv.Itoa
