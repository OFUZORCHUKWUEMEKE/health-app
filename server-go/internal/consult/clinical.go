package consult

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/notify"
)

// clinical.go implements M14 stage writes: every clinical section with
// doctor-ownership enforcement, singleton guards, dupe guards, and
// patient-safe notification fan-out (ids + counts only, never drug/test
// names — see the PHI rule in internal/notify).

// ownedWorkspace loads a consultation for doctor writes: 404 when missing,
// 401 'You are not authorized to perform this action' on owner mismatch
// (Nest verbatim for the clinical write paths).
func (s *Service) ownedWorkspace(ctx context.Context, doctorID, consultationID string) (gen.Consultation, error) {
	var cid pgtype.UUID
	if err := cid.Scan(consultationID); err != nil {
		return gen.Consultation{}, auth.BadRequest("Invalid consultation")
	}
	c, err := s.q().GetConsultationByID(ctx, cid)
	if err != nil {
		return gen.Consultation{}, auth.NotFound("Consultation not found")
	}
	if !c.DoctorID.Valid || c.DoctorID.String() != doctorID {
		return gen.Consultation{}, auth.Unauthorized("You are not authorized to perform this action")
	}
	return c, nil
}

func (s *Service) notifyPerson(ctx context.Context, doctorID pgtype.UUID) *notify.Person {
	if !doctorID.Valid {
		return &notify.Person{}
	}
	if doc, err := s.q().GetDoctorByID(ctx, doctorID); err == nil {
		return &notify.Person{FirstName: doc.FirstName, LastName: doc.LastName,
			FullName: textStr(doc.FullName)}
	}
	return &notify.Person{}
}

func (s *Service) notifyPatientPerson(ctx context.Context, patientID pgtype.UUID) *notify.Person {
	if !patientID.Valid {
		return &notify.Person{FirstName: "A patient"}
	}
	if user, err := s.q().GetPatientByID(ctx, patientID); err == nil {
		return &notify.Person{FirstName: user.FirstName, LastName: user.LastName,
			FullName: textStr(user.FullName)}
	}
	return &notify.Person{FirstName: "A patient"}
}

func (s *Service) storeNotification(ctx context.Context, spec notify.Spec) {
	data, _ := jsonMarshal(spec.Data)
	_ = s.q().CreateNotification(ctx, gen.CreateNotificationParams{
		RecipientID: uuidPG(spec.RecipientID), RecipientType: spec.RecipientType,
		Type: spec.Type, Category: spec.Category, Title: spec.Title, Body: spec.Body,
		Data:           data,
		AppointmentID:  uuidPG(spec.AppointmentID),
		ConsultationID: uuidPG(spec.ConsultationID),
		ActorID:        uuidPG(spec.ActorID),
		ActorType:      textOrEmpty(spec.ActorType),
		DeepLink:       textOrEmpty(spec.DeepLink),
		EventKey:       spec.EventKey,
	})
}

func uuidPG(id string) pgtype.UUID {
	var uid pgtype.UUID
	if id == "" {
		return uid
	}
	_ = uid.Scan(id)
	return uid
}

// --- complaint history (patient-owned) --------------------------------------

// CompliantInput mirrors the complaint-history payload.
type CompliantInput struct {
	PastMedicalHistory string
	Medication         string
	Allergy            string
	Family             string
	Travel             string
	Occupation         string
	Social             string
}

// CreateCompliantHistory stores one patient complaint-history row (201).
func (s *Service) CreateCompliantHistory(ctx context.Context, patientID, consultationID string, in CompliantInput) (map[string]any, error) {
	cid, c, err := s.ownedConsultation(ctx, patientID, consultationID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.PastMedicalHistory) == "" {
		return nil, auth.BadRequest("past_medical_history is required")
	}
	row, err := s.q().CreateCompliantHistory(ctx, gen.CreateCompliantHistoryParams{
		ConsultationID: cid, PatientID: c.PatientID, DoctorID: c.DoctorID,
		PastMedicalHistory: in.PastMedicalHistory,
		Medication:         textOrEmpty(in.Medication), Allergy: textOrEmpty(in.Allergy),
		Family: textOrEmpty(in.Family), Travel: textOrEmpty(in.Travel),
		Occupation: textOrEmpty(in.Occupation), Social: textOrEmpty(in.Social),
	})
	if err != nil {
		return nil, err
	}
	return compliantJSON(row), nil
}

// CompliantHistories returns one consultation's rows (patient-scoped).
func (s *Service) CompliantHistories(ctx context.Context, patientID, consultationID string) ([]map[string]any, error) {
	cid, _, err := s.ownedConsultation(ctx, patientID, consultationID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q().CompliantHistoriesByConsultation(ctx, cid)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, compliantJSON(r))
	}
	return out, nil
}

// DeleteCompliantHistory removes one owned row.
func (s *Service) DeleteCompliantHistory(ctx context.Context, patientID, id string) error {
	var rid pgtype.UUID
	if err := rid.Scan(id); err != nil {
		return auth.NotFound("Compliant history not found")
	}
	rows, err := s.q().CompliantHistoriesByConsultation(ctx, pgtype.UUID{})
	_ = rows
	_ = err
	// Scope via consultation ownership: find the row's consultation first.
	var consultationID pgtype.UUID
	found := false
	consults, err := s.q().PatientHistoryConsultations(ctx, mustPatientUUID(patientID))
	if err != nil {
		return err
	}
	for _, c := range consults {
		histories, err := s.q().CompliantHistoriesByConsultation(ctx, c.ID)
		if err != nil {
			continue
		}
		for _, h := range histories {
			if h.ID == rid {
				consultationID, found = c.ID, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		return auth.NotFound("Compliant history not found")
	}
	_ = consultationID
	n, err := s.q().DeleteCompliantHistory(ctx, rid)
	if err != nil || n == 0 {
		return auth.NotFound("Compliant history not found")
	}
	return nil
}

func mustPatientUUID(id string) pgtype.UUID {
	var uid pgtype.UUID
	_ = uid.Scan(id)
	return uid
}

func compliantJSON(r gen.ComplaintHistory) map[string]any {
	return map[string]any{
		"_id": r.ID.String(), "consultation_id": uuidOrNull(r.ConsultationID),
		"past_medical_history": r.PastMedicalHistory,
		"medication":           textOrNull(r.Medication), "allergy": textOrNull(r.Allergy),
		"family": textOrNull(r.Family), "travel": textOrNull(r.Travel),
		"occupation": textOrNull(r.Occupation), "social": textOrNull(r.Social),
		"createdAt": isoOrNull(r.CreatedAt), "updatedAt": isoOrNull(r.UpdatedAt),
	}
}

// --- singleton stages (doctor-owned) ----------------------------------------

// HistoryTakingInput mirrors CreateHistoryTakingDto.
type HistoryTakingInput struct {
	PresentComplaint               string
	HistoryOfPresentingComplaint   string
	PastMedicalSurgicalHistory     string
	MedicationHistory              string
	AllergyHistory                 []string
	FamilyHistory                  string
	TravelHistory                  string
	Occupation                     string
	SocialHistory                  string
	ObstetricGynaecologicalHistory string
	Others                         string
	Status                         string
}

func validStageStatus(st string) string {
	if st == "COMPLETED" || st == "INCOMPLETE" {
		return st
	}
	return "INCOMPLETE"
}

// CreateHistoryTaking enforces present_complaint + singleton.
func (s *Service) CreateHistoryTaking(ctx context.Context, doctorID, consultationID string, in HistoryTakingInput) (map[string]any, error) {
	c, err := s.ownedWorkspace(ctx, doctorID, consultationID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.PresentComplaint) == "" {
		return nil, auth.BadRequest("present_complaint is required")
	}
	if _, err := s.q().GetHistoryTaking(ctx, c.ID); err == nil {
		return nil, auth.Conflict("History taking already exists for this consultation")
	}
	row, err := s.q().CreateHistoryTaking(ctx, gen.CreateHistoryTakingParams{
		ConsultationID: c.ID, PatientID: c.PatientID, DoctorID: c.DoctorID,
		PresentComplaint:               in.PresentComplaint,
		HistoryOfPresentingComplaint:   textOrEmpty(in.HistoryOfPresentingComplaint),
		PastMedicalSurgicalHistory:     textOrEmpty(in.PastMedicalSurgicalHistory),
		MedicationHistory:              textOrEmpty(in.MedicationHistory),
		AllergyHistory:                 orEmpty(in.AllergyHistory),
		FamilyHistory:                  textOrEmpty(in.FamilyHistory),
		TravelHistory:                  textOrEmpty(in.TravelHistory),
		Occupation:                     textOrEmpty(in.Occupation),
		SocialHistory:                  textOrEmpty(in.SocialHistory),
		ObstetricGynaecologicalHistory: textOrEmpty(in.ObstetricGynaecologicalHistory),
		Others:                         textOrEmpty(in.Others),
		Status:                         validStageStatus(in.Status),
	})
	if err != nil {
		return nil, err
	}
	return historyTakingJSON(row), nil
}

// PhysicalExamInput mirrors CreatePhysicalExamDto (all optional systems).
type PhysicalExamInput struct {
	Systems map[string]string
	Status  string
}

// CreatePhysicalExam enforces the singleton.
func (s *Service) CreatePhysicalExam(ctx context.Context, doctorID, consultationID string, in PhysicalExamInput) (map[string]any, error) {
	c, err := s.ownedWorkspace(ctx, doctorID, consultationID)
	if err != nil {
		return nil, err
	}
	if _, err := s.q().GetPhysicalExam(ctx, c.ID); err == nil {
		return nil, auth.Conflict("Physical exam already exists for this consultation")
	}
	get := func(k string) pgtype.Text { return textOrEmpty(in.Systems[k]) }
	row, err := s.q().CreatePhysicalExam(ctx, gen.CreatePhysicalExamParams{
		ConsultationID: c.ID, PatientID: c.PatientID, DoctorID: c.DoctorID,
		GeneralPhysical: get("general_physical"), NervousSystem: get("nervous_system"),
		RespiratorySystem: get("respiratory_system"), CardiovascularSystem: get("cardiovascular_system"),
		GastrointestinalSystem: get("gastrointestinal_system"),
		GenitourinarySystem:    get("genitourinary_system"),
		MusculoskeletalSystem:  get("musculoskeletal_system"), Ent: get("ent"),
		ObstetricGynaecological: get("obstetric_gynaecological"), Others: get("others"),
		Status: validStageStatus(in.Status),
	})
	if err != nil {
		return nil, err
	}
	return physicalExamJSON(row), nil
}

// InvestigationResultInput mirrors CreateInvestigationResultDto.
type InvestigationResultInput struct {
	Fields map[string]string
	Status string
}

// CreateInvestigationResult enforces the singleton.
func (s *Service) CreateInvestigationResult(ctx context.Context, doctorID, consultationID string, in InvestigationResultInput) (map[string]any, error) {
	c, err := s.ownedWorkspace(ctx, doctorID, consultationID)
	if err != nil {
		return nil, err
	}
	if _, err := s.q().GetInvestigationResult(ctx, c.ID); err == nil {
		return nil, auth.Conflict("Investigation result already exists for this consultation")
	}
	get := func(k string) pgtype.Text { return textOrEmpty(in.Fields[k]) }
	row, err := s.q().CreateInvestigationResult(ctx, gen.CreateInvestigationResultParams{
		ConsultationID: c.ID, PatientID: c.PatientID, DoctorID: c.DoctorID,
		BloodTest: get("blood_test"), Microbiology: get("microbiology"),
		Radiology: get("radiology"), Cardiovascular: get("cardiovascular"),
		Procedures: get("procedures"), Others: get("others"),
		Status: validStageStatus(in.Status),
	})
	if err != nil {
		return nil, err
	}
	return investigationResultJSON(row), nil
}

// TreatmentPlanInput mirrors CreateTreatmentPlanDto.
type TreatmentPlanInput struct {
	Details string
	Status  string
}

// CreateTreatmentPlan enforces the singleton.
func (s *Service) CreateTreatmentPlan(ctx context.Context, doctorID, consultationID string, in TreatmentPlanInput) (map[string]any, error) {
	c, err := s.ownedWorkspace(ctx, doctorID, consultationID)
	if err != nil {
		return nil, err
	}
	if _, err := s.q().GetTreatmentPlan(ctx, c.ID); err == nil {
		return nil, auth.Conflict("Treatment plan already exists for this consultation")
	}
	row, err := s.q().CreateTreatmentPlan(ctx, gen.CreateTreatmentPlanParams{
		ConsultationID: c.ID, PatientID: c.PatientID, DoctorID: c.DoctorID,
		TreatmentPlanDetails: textOrEmpty(in.Details),
		Status:               validStageStatus(in.Status),
	})
	if err != nil {
		return nil, err
	}
	return treatmentPlanJSON(row), nil
}

// DiagnosisFormInput mirrors CreateDiagnosisFormDto.
type DiagnosisFormInput struct {
	Provisional []string
	Final       []string
	Status      string
}

// CreateDiagnosisForm enforces the singleton.
func (s *Service) CreateDiagnosisForm(ctx context.Context, doctorID, consultationID string, in DiagnosisFormInput) (map[string]any, error) {
	c, err := s.ownedWorkspace(ctx, doctorID, consultationID)
	if err != nil {
		return nil, err
	}
	if _, err := s.q().GetDiagnosisForm(ctx, c.ID); err == nil {
		return nil, auth.Conflict("Diagnosis form already exists for this consultation")
	}
	row, err := s.q().CreateDiagnosisForm(ctx, gen.CreateDiagnosisFormParams{
		ConsultationID: c.ID, PatientID: c.PatientID, DoctorID: c.DoctorID,
		ProvisionalDiagnosis: orEmpty(in.Provisional),
		FinalDiagnosis:       orEmpty(in.Final),
		Status:               validStageStatus(in.Status),
	})
	if err != nil {
		return nil, err
	}
	return diagnosisFormJSON(row), nil
}

func orEmpty(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// --- singleton reads/updates/deletes ----------------------------------------

// StageRecord fetches one singleton row scoped to an owned workspace.
func (s *Service) StageRecord(ctx context.Context, doctorID, consultationID, stage string) (map[string]any, error) {
	c, err := s.ownedWorkspace(ctx, doctorID, consultationID)
	if err != nil {
		return nil, err
	}
	switch stage {
	case "history-taking":
		r, err := s.q().GetHistoryTaking(ctx, c.ID)
		if err != nil {
			return nil, auth.NotFound("History taking not found")
		}
		return historyTakingJSON(r), nil
	case "physical-exam":
		r, err := s.q().GetPhysicalExam(ctx, c.ID)
		if err != nil {
			return nil, auth.NotFound("Physical exam not found")
		}
		return physicalExamJSON(r), nil
	case "investigation-result":
		r, err := s.q().GetInvestigationResult(ctx, c.ID)
		if err != nil {
			return nil, auth.NotFound("Investigation result not found")
		}
		return investigationResultJSON(r), nil
	case "treatment-plan":
		r, err := s.q().GetTreatmentPlan(ctx, c.ID)
		if err != nil {
			return nil, auth.NotFound("Treatment plan not found")
		}
		return treatmentPlanJSON(r), nil
	case "diagnosis-form":
		r, err := s.q().GetDiagnosisForm(ctx, c.ID)
		if err != nil {
			return nil, auth.NotFound("Diagnosis form not found")
		}
		return diagnosisFormJSON(r), nil
	}
	return nil, auth.BadRequest("Unknown stage")
}

// UpdateStageRecord patches one singleton row (record must belong to an
// owned workspace).
// UpdateStageRecord patches one singleton row. Missing keys merge from the
// stored row first, so NOT NULL columns always receive real values while
// nullable columns keep NULL (COALESCE keeps stored) when untouched.
func (s *Service) UpdateStageRecord(ctx context.Context, doctorID, recordID string, stage string, patch map[string]any) (map[string]any, error) {
	cid, err := s.recordConsultation(ctx, doctorID, stage, recordID)
	if err != nil {
		return nil, err
	}
	current, err := s.StageRecord(ctx, doctorID, cid.String(), stage)
	if err != nil {
		return nil, err
	}
	merged := map[string]any{}
	for k, v := range current {
		merged[k] = v
	}
	for k, v := range patch {
		merged[k] = v
	}
	var rid pgtype.UUID
	_ = rid.Scan(recordID)
	switch stage {
	case "history-taking":
		return s.updateHistoryTakingFull(ctx, rid, merged)
	case "physical-exam":
		return s.updatePhysicalExamFull(ctx, rid, merged)
	case "investigation-result":
		return s.updateInvestigationResultFull(ctx, rid, merged)
	case "treatment-plan":
		return s.updateTreatmentPlanFull(ctx, rid, merged)
	case "diagnosis-form":
		return s.updateDiagnosisFormFull(ctx, rid, merged)
	}
	return nil, auth.BadRequest("Unknown stage")
}

// merged-field readers: values are string / []string / bool / nil after
// the merge (stored JSON uses []string; patch JSON uses []any).
func mstr(v any) string {
	switch t := v.(type) {
	case string:
		return t
	}
	return ""
}

func mtext(v any) pgtype.Text {
	if str, ok := v.(string); ok {
		return pgtype.Text{String: str, Valid: true}
	}
	return pgtype.Text{}
}

func marr(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := []string{}
		for _, item := range t {
			if str, ok := item.(string); ok {
				out = append(out, str)
			}
		}
		return out
	}
	return nil
}

func mbool(v any) bool {
	b, _ := v.(bool)
	return b
}

func mstatus(v any) string {
	if str, ok := v.(string); ok && (str == "COMPLETED" || str == "INCOMPLETE") {
		return str
	}
	return "INCOMPLETE"
}

func (s *Service) updateHistoryTakingFull(ctx context.Context, rid pgtype.UUID, m map[string]any) (map[string]any, error) {
	r, err := s.q().UpdateHistoryTaking(ctx, gen.UpdateHistoryTakingParams{
		ID:                             rid,
		PresentComplaint:               mstr(m["present_complaint"]),
		HistoryOfPresentingComplaint:   mtext(m["history_of_presenting_complaint"]),
		PastMedicalSurgicalHistory:     mtext(m["past_medical_surgical_history"]),
		MedicationHistory:              mtext(m["medication_history"]),
		AllergyHistory:                 marr(m["allergy_history"]),
		FamilyHistory:                  mtext(m["family_history"]),
		TravelHistory:                  mtext(m["travel_history"]),
		Occupation:                     mtext(m["occupation"]),
		SocialHistory:                  mtext(m["social_history"]),
		ObstetricGynaecologicalHistory: mtext(m["obstetric_gynaecological_history"]),
		Others:                         mtext(m["others"]),
		Status:                         mstatus(m["status"]),
	})
	if err != nil {
		return nil, err
	}
	return historyTakingJSON(r), nil
}

func (s *Service) updatePhysicalExamFull(ctx context.Context, rid pgtype.UUID, m map[string]any) (map[string]any, error) {
	r, err := s.q().UpdatePhysicalExam(ctx, gen.UpdatePhysicalExamParams{
		ID:                      rid,
		GeneralPhysical:         mtext(m["general_physical"]),
		NervousSystem:           mtext(m["nervous_system"]),
		RespiratorySystem:       mtext(m["respiratory_system"]),
		CardiovascularSystem:    mtext(m["cardiovascular_system"]),
		GastrointestinalSystem:  mtext(m["gastrointestinal_system"]),
		GenitourinarySystem:     mtext(m["genitourinary_system"]),
		MusculoskeletalSystem:   mtext(m["musculoskeletal_system"]),
		Ent:                     mtext(m["ent"]),
		ObstetricGynaecological: mtext(m["obstetric_gynaecological"]),
		Others:                  mtext(m["others"]),
		Status:                  mstatus(m["status"]),
	})
	if err != nil {
		return nil, err
	}
	return physicalExamJSON(r), nil
}

func (s *Service) updateInvestigationResultFull(ctx context.Context, rid pgtype.UUID, m map[string]any) (map[string]any, error) {
	r, err := s.q().UpdateInvestigationResult(ctx, gen.UpdateInvestigationResultParams{
		ID:        rid,
		BloodTest: mtext(m["blood_test"]), Microbiology: mtext(m["microbiology"]),
		Radiology: mtext(m["radiology"]), Cardiovascular: mtext(m["cardiovascular"]),
		Procedures: mtext(m["procedures"]), Others: mtext(m["others"]),
		Status: mstatus(m["status"]),
	})
	if err != nil {
		return nil, err
	}
	return investigationResultJSON(r), nil
}

func (s *Service) updateTreatmentPlanFull(ctx context.Context, rid pgtype.UUID, m map[string]any) (map[string]any, error) {
	r, err := s.q().UpdateTreatmentPlan(ctx, gen.UpdateTreatmentPlanParams{
		ID:                   rid,
		TreatmentPlanDetails: mtext(m["treatment_plan_details"]),
		Status:               mstatus(m["status"]),
	})
	if err != nil {
		return nil, err
	}
	return treatmentPlanJSON(r), nil
}

func (s *Service) updateDiagnosisFormFull(ctx context.Context, rid pgtype.UUID, m map[string]any) (map[string]any, error) {
	r, err := s.q().UpdateDiagnosisForm(ctx, gen.UpdateDiagnosisFormParams{
		ID:                   rid,
		ProvisionalDiagnosis: marr(m["provisional_diagnosis"]),
		FinalDiagnosis:       marr(m["final_diagnosis"]),
		Status:               mstatus(m["status"]),
	})
	if err != nil {
		return nil, err
	}
	return diagnosisFormJSON(r), nil
}

// --- medications ------------------------------------------------------------

// MedicationInput mirrors MedicationItemDto.
type MedicationInput struct {
	Formulary        string
	Medication       string
	Dose             float64
	Unit             string
	Interval         string
	Duration         float64
	DurationUnit     string
	OrderInstruction string
	StartDate        string
	AssignToPatient  bool
	Status           string
}

// CreateMedications stores a batch; rows are patient-visible only when
// assign_to_patient, and one notification covers the whole batch.
func (s *Service) CreateMedications(ctx context.Context, doctorID, consultationID string, items []MedicationInput) ([]map[string]any, error) {
	c, err := s.ownedWorkspace(ctx, doctorID, consultationID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, auth.BadRequest("medications must not be empty")
	}
	created := make([]map[string]any, 0, len(items))
	visible := 0
	for _, in := range items {
		if err := validateMedication(in); err != nil {
			return nil, err
		}
		var patientID pgtype.UUID
		if in.AssignToPatient {
			patientID = c.PatientID
		}
		status := in.Status
		if status == "" {
			status = "ACTIVE"
		}
		dose, derr := numericOf(in.Dose)
		if derr != nil {
			return nil, auth.BadRequest("dose must be a non-negative number")
		}
		duration, derr := numericOf(in.Duration)
		if derr != nil {
			return nil, auth.BadRequest("duration must be a non-negative number")
		}
		row, err := s.q().CreateMedication(ctx, gen.CreateMedicationParams{
			ConsultationID: c.ID, PatientID: patientID, DoctorID: c.DoctorID,
			Formulary: in.Formulary, Medication: in.Medication,
			Dose: dose, Unit: in.Unit, Interval: in.Interval,
			Duration: duration, DurationUnit: in.DurationUnit,
			OrderInstruction: textOrEmpty(in.OrderInstruction),
			StartDate:        textOrEmpty(in.StartDate),
			AssignToPatient:  in.AssignToPatient, Status: status,
		})
		if err != nil {
			return nil, mapCheckError(err)
		}
		if in.AssignToPatient {
			visible++
		}
		created = append(created, medicationJSON(row))
	}
	if visible > 0 && c.PatientID.Valid {
		s.storeNotification(ctx, notify.PrescriptionReady(notify.PrescriptionReadyArgs{
			PatientID: c.PatientID.String(), ConsultationID: c.ID.String(),
			Doctor: s.notifyPerson(ctx, c.DoctorID), DoctorID: c.DoctorID.String(),
			Count: visible,
			Data:  map[string]any{"consultation_id": c.ID.String(), "count": visible},
		}))
	}
	return created, nil
}

func validateMedication(in MedicationInput) error {
	if strings.TrimSpace(in.Formulary) == "" || strings.TrimSpace(in.Medication) == "" ||
		strings.TrimSpace(in.Unit) == "" || strings.TrimSpace(in.Interval) == "" ||
		strings.TrimSpace(in.DurationUnit) == "" {
		return auth.BadRequest("formulary, medication, unit, interval and duration_unit are required")
	}
	if in.Dose < 0 || in.Duration < 0 {
		return auth.BadRequest("dose and duration must be non-negative")
	}
	return nil
}

func numericOf(f float64) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	if err := n.Scan(fmt.Sprintf("%v", f)); err != nil {
		return n, err
	}
	return n, nil
}

// mapCheckError maps enum violations to 400 (CHECK), unique to 409.
func mapCheckError(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if strings.Contains(msg, "SQLSTATE 23514") {
		return auth.BadRequest("Invalid enum value for medication field")
	}
	return err
}

// UpdateMedication patches one owned row.
// recordConsultation resolves a record to its consultation and enforces
// doctor ownership of the workspace.
func (s *Service) recordConsultation(ctx context.Context, doctorID, stage, recordID string) (pgtype.UUID, error) {
	var rid pgtype.UUID
	if err := rid.Scan(recordID); err != nil {
		return rid, auth.NotFound("Record not found")
	}
	cid, err := s.recordConsultationID(ctx, stage, rid)
	if err != nil {
		return rid, err
	}
	c, err := s.q().GetConsultationByID(ctx, cid)
	if err != nil {
		return rid, auth.NotFound("Record not found")
	}
	if !c.DoctorID.Valid || c.DoctorID.String() != doctorID {
		return rid, auth.Unauthorized("You are not authorized to perform this action")
	}
	return cid, nil
}

func (s *Service) recordConsultationID(ctx context.Context, stage string, rid pgtype.UUID) (pgtype.UUID, error) {
	fail := func() (pgtype.UUID, error) { return rid, auth.NotFound("Record not found") }
	switch stage {
	case "history-taking":
		rows, err := s.q().HistoryTakingByID(ctx, rid)
		if err != nil {
			return fail()
		}
		return rows.ConsultationID, nil
	case "physical-exam":
		rows, err := s.q().PhysicalExamByID(ctx, rid)
		if err != nil {
			return fail()
		}
		return rows.ConsultationID, nil
	case "investigation-result":
		rows, err := s.q().InvestigationResultByID(ctx, rid)
		if err != nil {
			return fail()
		}
		return rows.ConsultationID, nil
	case "treatment-plan":
		rows, err := s.q().TreatmentPlanByID(ctx, rid)
		if err != nil {
			return fail()
		}
		return rows.ConsultationID, nil
	case "diagnosis-form":
		rows, err := s.q().DiagnosisFormByID(ctx, rid)
		if err != nil {
			return fail()
		}
		return rows.ConsultationID, nil
	case "medication":
		rows, err := s.q().GetMedicationByID(ctx, rid)
		if err != nil {
			return fail()
		}
		return rows.ConsultationID, nil
	case "investigation-list":
		rows, err := s.q().GetInvestigationList(ctx, rid)
		if err != nil {
			return fail()
		}
		return rows.ConsultationID, nil
	case "referral":
		rows, err := s.q().GetReferralByID(ctx, rid)
		if err != nil {
			return fail()
		}
		return rows.ConsultationID, nil
	}
	return fail()
}

// DeleteStageRecord removes one row scoped to an owned workspace.
func (s *Service) DeleteStageRecord(ctx context.Context, doctorID, recordID, stage string) error {
	if _, err := s.recordConsultation(ctx, doctorID, stage, recordID); err != nil {
		return err
	}
	var rid pgtype.UUID
	_ = rid.Scan(recordID)
	var n int64
	var err error
	switch stage {
	case "history-taking":
		n, err = s.q().DeleteHistoryTaking(ctx, rid)
	case "physical-exam":
		n, err = s.q().DeletePhysicalExam(ctx, rid)
	case "investigation-result":
		n, err = s.q().DeleteInvestigationResult(ctx, rid)
	case "treatment-plan":
		n, err = s.q().DeleteTreatmentPlan(ctx, rid)
	case "diagnosis-form":
		n, err = s.q().DeleteDiagnosisForm(ctx, rid)
	case "medication":
		n, err = s.q().DeleteMedication(ctx, rid)
	case "investigation-list":
		n, err = s.q().DeleteInvestigationList(ctx, rid)
	case "referral":
		n, err = s.q().DeleteReferral(ctx, rid)
	default:
		return auth.BadRequest("Unknown stage")
	}
	if err != nil || n == 0 {
		return auth.NotFound("Record not found")
	}
	return nil
}

// UpdateMedication patches one owned row (missing keys merge from stored).
func (s *Service) UpdateMedication(ctx context.Context, doctorID, id string, patch map[string]any) (map[string]any, error) {
	cid, err := s.recordConsultation(ctx, doctorID, "medication", id)
	if err != nil {
		return nil, err
	}
	var rid pgtype.UUID
	_ = rid.Scan(id)
	current, err := s.q().GetMedicationByID(ctx, rid)
	if err != nil {
		return nil, auth.NotFound("Medication not found")
	}
	_ = cid
	merged := medicationJSON(current)
	for k, v := range patch {
		merged[k] = v
	}
	num := func(k string) pgtype.Numeric {
		if f, ok := merged[k].(float64); ok && f >= 0 {
			if n, err := numericOf(f); err == nil {
				return n
			}
		}
		// stored dose/duration arrive as pgtype.Numeric; keep them.
		if n, ok := merged[k].(pgtype.Numeric); ok {
			return n
		}
		return pgtype.Numeric{}
	}
	row, err := s.q().UpdateMedication(ctx, gen.UpdateMedicationParams{
		ID:        rid,
		Formulary: mstr(merged["formulary"]), Medication: mstr(merged["medication"]),
		Dose: num("dose"), Unit: mstr(merged["unit"]), Interval: mstr(merged["interval"]),
		Duration: num("duration"), DurationUnit: mstr(merged["duration_unit"]),
		OrderInstruction: mtext(merged["order_instruction"]), StartDate: mtext(merged["start_date"]),
		AssignToPatient: mbool(merged["assign_to_patient"]), Status: mstr(merged["status"]),
	})
	if err != nil {
		return nil, mapCheckError(err)
	}
	return medicationJSON(row), nil
}

func (s *Service) MedicationsGroupedDoctor(ctx context.Context, doctorID string, page, perPage int) (map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	ids, err := s.q().DoctorMedicationConsultationIDs(ctx, uid)
	if err != nil {
		return nil, err
	}
	total := int64(len(ids))
	pages := 0
	if perPage > 0 {
		pages = int((total + int64(perPage) - 1) / int64(perPage))
	}
	start, end := (page-1)*perPage, page*perPage
	if start > len(ids) {
		start = len(ids)
	}
	if end > len(ids) {
		end = len(ids)
	}
	groups := make([]map[string]any, 0)
	pageIDs := ids[start:end]
	allMeds, err := s.q().MedicationsByConsultations(ctx, pageIDs)
	if err != nil {
		return nil, err
	}
	medsByCID := map[string][]gen.Medication{}
	for _, m := range allMeds {
		k := m.ConsultationID.String()
		medsByCID[k] = append(medsByCID[k], m)
	}
	consults := map[string]gen.Consultation{}
	if cs, err := s.q().GetConsultationsByIDs(ctx, pageIDs); err == nil {
		for _, c := range cs {
			consults[c.ID.String()] = c
		}
	}
	for _, cid := range pageIDs {
		meds := medsByCID[cid.String()]
		if len(meds) == 0 {
			continue
		}
		out := make([]map[string]any, 0, len(meds))
		for _, m := range meds {
			if !m.DoctorID.Valid || m.DoctorID.String() != doctorID {
				continue
			}
			out = append(out, medicationJSON(m))
		}
		if len(out) == 0 {
			continue
		}
		g := map[string]any{"medication_count": len(out), "medications": out}
		if c, ok := consults[cid.String()]; ok {
			g["consultation"] = consultationBase(c)
		}
		groups = append(groups, g)
	}
	return map[string]any{
		"groups": groups,
		"pagination": map[string]any{
			"total": total, "page": page, "perPage": perPage, "total_pages": pages,
		},
	}, nil
}

// MedicationOne returns one doctor-owned medication row.
func (s *Service) MedicationOne(ctx context.Context, doctorID, id string) (map[string]any, error) {
	if _, err := s.recordConsultation(ctx, doctorID, "medication", id); err != nil {
		return nil, err
	}
	var rid pgtype.UUID
	_ = rid.Scan(id)
	m, err := s.q().GetMedicationByID(ctx, rid)
	if err != nil {
		return nil, auth.NotFound("Medication not found")
	}
	return medicationJSON(m), nil
}

// ConsultationInvestigationLists returns one consultation's lists
// (workspace ownership already checked by callers that need it).
func (s *Service) ConsultationInvestigationLists(ctx context.Context, consultationID string) ([]map[string]any, error) {
	var cid pgtype.UUID
	if err := cid.Scan(consultationID); err != nil {
		return nil, auth.NotFound("Consultation not found")
	}
	rows, err := s.q().InvestigationListsByConsultation(ctx, cid)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, investigationListJSON(r))
	}
	return out, nil
}

// ConsultationReferralsForDoctor returns one consultation's referrals.
func (s *Service) ConsultationReferralsForDoctor(ctx context.Context, consultationID string) ([]map[string]any, error) {
	var cid pgtype.UUID
	if err := cid.Scan(consultationID); err != nil {
		return nil, auth.NotFound("Consultation not found")
	}
	rows, err := s.q().ReferralsByConsultation(ctx, cid)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, referralJSON(r))
	}
	return out, nil
}

// ReferralOne returns one doctor-owned referral row.
func (s *Service) ReferralOne(ctx context.Context, doctorID, id string) (map[string]any, error) {
	if _, err := s.recordConsultation(ctx, doctorID, "referral", id); err != nil {
		return nil, err
	}
	var rid pgtype.UUID
	_ = rid.Scan(id)
	r, err := s.q().GetReferralByID(ctx, rid)
	if err != nil {
		return nil, auth.NotFound("Referral not found")
	}
	return referralJSON(r), nil
}

// --- investigation lists ----------------------------------------------------

// InvestigationListInput mirrors InvestigationListItemDto.
type InvestigationListInput struct {
	Category      string
	TestRequested string
	Priority      string
	Specimen      string
}

// investigationIdentity normalizes category + test (was
// normalizeInvestigationIdentity).
func investigationIdentity(category, test string) string {
	if strings.TrimSpace(category) == "" {
		category = "Other"
	}
	return strings.ToLower(strings.TrimSpace(category)) + "::" + strings.ToLower(strings.TrimSpace(test))
}

// CreateInvestigationLists stores a batch with dupe guards and one
// notification when assigned.
func (s *Service) CreateInvestigationLists(ctx context.Context, doctorID, consultationID string, items []InvestigationListInput, assignToPatient bool) ([]map[string]any, error) {
	c, err := s.ownedWorkspace(ctx, doctorID, consultationID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, auth.BadRequest("investigations must not be empty")
	}
	seen := map[string]bool{}
	for _, item := range items {
		if strings.TrimSpace(item.Category) == "" || strings.TrimSpace(item.TestRequested) == "" {
			return nil, auth.BadRequest("category and test_requested are required")
		}
		key := investigationIdentity(item.Category, item.TestRequested)
		if seen[key] {
			return nil, auth.Conflict(fmt.Sprintf("Duplicate investigation %q in this request.", strings.TrimSpace(item.TestRequested)))
		}
		seen[key] = true
	}
	pending, err := s.q().PendingInvestigationLists(ctx, c.ID)
	if err != nil {
		return nil, err
	}
	pendingKeys := map[string]bool{}
	for _, r := range pending {
		pendingKeys[investigationIdentity(r.Category.String, r.TestRequested.String)] = true
	}
	created := make([]map[string]any, 0, len(items))
	for _, item := range items {
		key := investigationIdentity(item.Category, item.TestRequested)
		if pendingKeys[key] {
			return nil, auth.Conflict(fmt.Sprintf("Investigation %q is already saved for this consultation and has not been sent to the patient yet.", strings.TrimSpace(item.TestRequested)))
		}
		priority := item.Priority
		if priority == "" {
			priority = "Routine"
		}
		specimen := item.Specimen
		if specimen == "" {
			specimen = "-"
		}
		var patientID pgtype.UUID
		if assignToPatient {
			patientID = c.PatientID
		}
		row, err := s.q().CreateInvestigationListItem(ctx, gen.CreateInvestigationListItemParams{
			ConsultationID: c.ID, PatientID: patientID, DoctorID: c.DoctorID,
			Name: item.TestRequested, Category: textOrEmpty(item.Category),
			TestRequested: textOrEmpty(item.TestRequested),
			Priority:      priority, Specimen: specimen,
			AssignToPatient: assignToPatient, ResultImages: []string{},
		})
		if err != nil {
			return nil, err
		}
		pendingKeys[key] = true
		created = append(created, investigationListJSON(row))
	}
	if assignToPatient && c.PatientID.Valid {
		s.storeNotification(ctx, notify.InvestigationsRequested(notify.InvestigationsRequestedArgs{
			PatientID: c.PatientID.String(), ConsultationID: c.ID.String(),
			Doctor: s.notifyPerson(ctx, c.DoctorID), DoctorID: c.DoctorID.String(),
			Count: len(created),
			Data:  map[string]any{"consultation_id": c.ID.String(), "count": len(created)},
		}))
	}
	return created, nil
}

// UpdateInvestigationList patches one owned row.
// UpdateInvestigationList patches one owned row (missing keys merge).
func (s *Service) UpdateInvestigationList(ctx context.Context, doctorID, id string, patch map[string]any) (map[string]any, error) {
	if _, err := s.recordConsultation(ctx, doctorID, "investigation-list", id); err != nil {
		return nil, err
	}
	var rid pgtype.UUID
	_ = rid.Scan(id)
	current, err := s.q().GetInvestigationList(ctx, rid)
	if err != nil {
		return nil, auth.NotFound("Investigation not found")
	}
	merged := investigationListJSON(current)
	for k, v := range patch {
		merged[k] = v
	}
	row, err := s.q().UpdateInvestigationList(ctx, gen.UpdateInvestigationListParams{
		ID:   rid,
		Name: mstr(merged["name"]), Category: mtext(merged["category"]),
		TestRequested: mtext(merged["test_requested"]), Priority: mstr(merged["priority"]),
		Specimen: mstr(merged["specimen"]), AssignToPatient: mbool(merged["assign_to_patient"]),
		ResultImages: marr(merged["result_images"]),
	})
	if err != nil {
		return nil, err
	}
	return investigationListJSON(row), nil
}

// UploadInvestigationImages stores each blob via the file provider and
// appends the returned URLs. Unconfigured provider (nil Files included)
// → controlled 503; provider failures → 500 (Nest parity:
// 'Failed to upload image to Cloudinary').
func (s *Service) UploadInvestigationImages(ctx context.Context, patientID, listID string, blobs []files.Upload) (map[string]any, error) {
	var lid pgtype.UUID
	if err := lid.Scan(listID); err != nil {
		return nil, auth.NotFound("Investigation not found")
	}
	row, err := s.q().GetInvestigationList(ctx, lid)
	if err != nil {
		return nil, auth.NotFound("Investigation not found")
	}
	if !row.PatientID.Valid || row.PatientID.String() != patientID {
		return nil, auth.Unauthorized("Invalid User")
	}
	if len(blobs) == 0 {
		return nil, auth.BadRequest("At least one result image is required")
	}
	if s.Files == nil {
		return nil, &auth.Error{Status: 503, Message: "Cloudinary is not configured"}
	}
	urls := make([]string, 0, len(blobs))
	for _, b := range blobs {
		u, uerr := s.Files.UploadInvestigationImage(ctx, b.Data, b.ContentType, patientID, listID)
		if uerr != nil {
			if files.IsNotConfigured(uerr) {
				return nil, &auth.Error{Status: 503, Message: uerr.Error()}
			}
			return nil, &auth.Error{Status: 500, Message: "Failed to upload image to Cloudinary"}
		}
		urls = append(urls, u)
	}
	return s.AppendInvestigationImages(ctx, patientID, listID, urls)
}

func (s *Service) AppendInvestigationImages(ctx context.Context, patientID, listID string, urls []string) (map[string]any, error) {
	var lid pgtype.UUID
	if err := lid.Scan(listID); err != nil {
		return nil, auth.NotFound("Investigation not found")
	}
	row, err := s.q().GetInvestigationList(ctx, lid)
	if err != nil {
		return nil, auth.NotFound("Investigation not found")
	}
	if !row.PatientID.Valid || row.PatientID.String() != patientID {
		return nil, auth.Unauthorized("Invalid User")
	}
	if len(urls) == 0 {
		return nil, auth.BadRequest("At least one result image is required")
	}
	updated, err := s.q().AppendInvestigationImages(ctx, gen.AppendInvestigationImagesParams{
		ID: lid, ArrayCat: urls,
	})
	if err != nil {
		return nil, err
	}
	if updated.DoctorID.Valid {
		s.storeNotification(ctx, notify.InvestigationResultsUploaded(notify.InvestigationResultsUploadedArgs{
			DoctorID: updated.DoctorID.String(), PatientID: patientID,
			Patient:             s.notifyPatientPerson(ctx, updated.PatientID),
			ConsultationID:      updated.ConsultationID.String(),
			InvestigationListID: updated.ID.String(),
			ImageCount:          len(urls),
			Data:                map[string]any{"investigation_list_id": updated.ID.String(), "image_count": len(urls)},
		}))
	}
	return investigationListJSON(updated), nil
}

// --- referrals --------------------------------------------------------------

// ReferralInput mirrors the referral payload.
type ReferralInput struct {
	SpecialistName             string
	Specialty                  string
	Hospital                   string
	HospitalAddress            []string
	AttachmentInvestigationIDs []string
	ReferralDetails            string
	ReferredDoctorName         string
	AssignToPatient            bool
}

// CreateReferral stores one letter; assigned letters notify the patient
// without specialist/hospital/detail text (PHI rule).
func (s *Service) CreateReferral(ctx context.Context, doctorID, consultationID string, in ReferralInput) (map[string]any, error) {
	c, err := s.ownedWorkspace(ctx, doctorID, consultationID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.SpecialistName) == "" || strings.TrimSpace(in.Hospital) == "" ||
		strings.TrimSpace(in.ReferralDetails) == "" {
		return nil, auth.BadRequest("specialist_name, hospital and referral_details are required")
	}
	var patientID pgtype.UUID
	if in.AssignToPatient {
		patientID = c.PatientID
	}
	row, err := s.q().CreateReferral(ctx, gen.CreateReferralParams{
		ConsultationID: c.ID, PatientID: patientID, DoctorID: c.DoctorID,
		ReferredDoctorName: textOrEmpty(in.ReferredDoctorName),
		SpecialistName:     in.SpecialistName, Specialty: textOrEmpty(in.Specialty),
		Hospital: in.Hospital, HospitalAddress: orEmpty(in.HospitalAddress),
		AttachmentInvestigationIds: orEmpty(in.AttachmentInvestigationIDs),
		ReferralDetails:            in.ReferralDetails, AssignToPatient: in.AssignToPatient,
	})
	if err != nil {
		return nil, err
	}
	if in.AssignToPatient && c.PatientID.Valid {
		s.storeNotification(ctx, notify.ReferralAvailable(notify.ReferralAvailableArgs{
			PatientID: c.PatientID.String(), ConsultationID: c.ID.String(),
			ReferralID: row.ID.String(),
			Doctor:     s.notifyPerson(ctx, c.DoctorID), DoctorID: c.DoctorID.String(),
			Data: map[string]any{"referral_id": row.ID.String()},
		}))
	}
	return referralJSON(row), nil
}

// UpdateReferral patches one owned row.
// UpdateReferral patches one owned row (missing keys merge).
func (s *Service) UpdateReferral(ctx context.Context, doctorID, id string, patch map[string]any) (map[string]any, error) {
	if _, err := s.recordConsultation(ctx, doctorID, "referral", id); err != nil {
		return nil, err
	}
	var rid pgtype.UUID
	_ = rid.Scan(id)
	current, err := s.q().GetReferralByID(ctx, rid)
	if err != nil {
		return nil, auth.NotFound("Referral not found")
	}
	merged := referralJSON(current)
	for k, v := range patch {
		merged[k] = v
	}
	row, err := s.q().UpdateReferral(ctx, gen.UpdateReferralParams{
		ID:                 rid,
		ReferredDoctorName: mtext(merged["referred_doctor_name"]),
		SpecialistName:     mstr(merged["specialist_name"]), Specialty: mtext(merged["specialty"]),
		Hospital: mstr(merged["hospital"]), HospitalAddress: marr(merged["hospital_address"]),
		AttachmentInvestigationIds: marr(merged["attachment_investigation_ids"]),
		ReferralDetails:            mstr(merged["referral_details"]),
		AssignToPatient:            mbool(merged["assign_to_patient"]),
	})
	if err != nil {
		return nil, err
	}
	return referralJSON(row), nil
}

func (s *Service) ReferralsGroupedDoctor(ctx context.Context, doctorID string, page, perPage int) (map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	ids, err := s.q().DoctorReferralConsultationIDs(ctx, uid)
	if err != nil {
		return nil, err
	}
	total := int64(len(ids))
	pages := 0
	if perPage > 0 {
		pages = int((total + int64(perPage) - 1) / int64(perPage))
	}
	start, end := (page-1)*perPage, page*perPage
	if start > len(ids) {
		start = len(ids)
	}
	if end > len(ids) {
		end = len(ids)
	}
	groups := make([]map[string]any, 0)
	pageIDs := ids[start:end]
	allRows, err := s.q().ReferralsByConsultations(ctx, pageIDs)
	if err != nil {
		return nil, err
	}
	rowsByCID := map[string][]gen.Referral{}
	for _, r := range allRows {
		k := r.ConsultationID.String()
		rowsByCID[k] = append(rowsByCID[k], r)
	}
	consults := map[string]gen.Consultation{}
	if cs, err := s.q().GetConsultationsByIDs(ctx, pageIDs); err == nil {
		for _, c := range cs {
			consults[c.ID.String()] = c
		}
	}
	for _, cid := range pageIDs {
		rows := rowsByCID[cid.String()]
		if len(rows) == 0 {
			continue
		}
		out := make([]map[string]any, 0, len(rows))
		for _, r := range rows {
			if !r.DoctorID.Valid || r.DoctorID.String() != doctorID {
				continue
			}
			out = append(out, referralJSON(r))
		}
		if len(out) == 0 {
			continue
		}
		g := map[string]any{"referral_count": len(out), "referrals": out}
		if c, ok := consults[cid.String()]; ok {
			g["consultation"] = consultationBase(c)
		}
		groups = append(groups, g)
	}
	return map[string]any{
		"groups": groups,
		"pagination": map[string]any{
			"total": total, "page": page, "perPage": perPage, "total_pages": pages,
		},
	}, nil
}

func textStr(v pgtype.Text) string {
	if v.Valid {
		return v.String
	}
	return ""
}
