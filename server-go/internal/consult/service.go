package consult

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
	"github.com/wizzyszn/Telemex/internal/auth"
	"github.com/wizzyszn/Telemex/internal/files"
	"github.com/wizzyszn/Telemex/internal/platform/postgres"
)

// Consultation types and statuses (contract unions).
const (
	TypeChat  = "CHAT"
	TypeAudio = "AUDIO"
	TypeVideo = "VIDEO"
	TypeMeet  = "MEETADOCTOR"
	TypeHome  = "HOMESERVICE"

	StatusPending     = "PENDING"
	StatusActive      = "ACTIVE"
	StatusCompleted   = "COMPLETED"
	StatusCanceled    = "CANCELED"
	StatusRescheduled = "RESCHEDULED"
	StatusOpen        = "OPEN"
	StatusInProgress  = "IN_PROGRESS"
	StatusAddended    = "ADDENDED"
)

var validTypes = map[string]bool{
	TypeChat: true, TypeAudio: true, TypeVideo: true,
	TypeMeet: true, TypeHome: true,
}

// Service owns the consultation lifecycle and history reads (M13).
// Clinical stage writes land in M14. Files serves investigation image
// uploads (M17); nil means unconfigured and uploads 503 (Nest parity).
type Service struct {
	DB    *postgres.Pool
	Files files.Provider
}

func (s *Service) q() *gen.Queries { return gen.New(s.DB.Inner()) }

var refAlphabet = []rune("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")

// Reference mints {TYPE}-{10 alphanumerics} (was createConsultationString).
func Reference(consultType string) (string, error) {
	var sb strings.Builder
	sb.WriteString(consultType)
	sb.WriteByte('-')
	for i := 0; i < 10; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(refAlphabet))))
		if err != nil {
			return "", err
		}
		sb.WriteRune(refAlphabet[n.Int64()])
	}
	return sb.String(), nil
}

// --- JSON views -------------------------------------------------------------

func consultationBase(c gen.Consultation) map[string]any {
	return map[string]any{
		"_id": c.ID.String(), "appointment_id": uuidOrNull(c.AppointmentID),
		"consultation_id": c.Reference, "type": c.Type,
		"user_id": uuidOrNull(c.PatientID), "doctor_id": uuidOrNull(c.DoctorID),
		"consoltation_for": c.ConsoltationFor, "title": c.Title,
		"details": c.Details, "session_number": textOrNull(c.SessionNumber),
		"parent_consultation_id": textOrNull(c.ParentConsultationID),
		"treatment_plan":         textOrNull(c.TreatmentPlan), "status": c.Status,
		"createdAt": isoOrNull(c.CreatedAt), "updatedAt": isoOrNull(c.UpdatedAt),
	}
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

func strs(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

func doctorCard(d gen.Doctor) map[string]any {
	return map[string]any{
		"_id": d.ID.String(), "first_name": d.FirstName, "last_name": d.LastName,
		"full_name": textOrNull(d.FullName), "email": d.Email,
		"phone_number":        textOrNull(d.PhoneNumber),
		"specializations":     strs(d.Specializations),
		"profile_picture_url": textOrNull(d.ProfilePictureUrl),
	}
}

func doctorBrief(d gen.Doctor) map[string]any {
	return map[string]any{
		"_id": d.ID.String(), "first_name": d.FirstName, "last_name": d.LastName,
		"full_name": textOrNull(d.FullName), "email": d.Email,
		"specializations":     strs(d.Specializations),
		"profile_picture_url": textOrNull(d.ProfilePictureUrl),
	}
}

func patientCard(u gen.Patient) map[string]any {
	return map[string]any{
		"_id": u.ID.String(), "first_name": u.FirstName, "last_name": u.LastName,
		"full_name": textOrNull(u.FullName), "email": u.Email,
		"phone_number": textOrNull(u.PhoneNumber), "gender": textOrNull(u.Gender),
		"date_of_birth":       dateOrNull(u.DateOfBirth),
		"profile_picture_url": textOrNull(u.ProfilePictureUrl),
	}
}

func dateOrNull(v pgtype.Date) any {
	if v.Valid {
		return v.Time.Format("2006-01-02")
	}
	return nil
}

func appointmentCard(a gen.Appointment) map[string]any {
	return map[string]any{
		"_id": a.ID.String(), "appointment_number": a.AppointmentNumber,
		"scheduled_start_at_utc": isoOrNull(a.ScheduledStartAtUtc),
		"scheduled_end_at_utc":   isoOrNull(a.ScheduledEndAtUtc),
		"status":                 a.Status, "reason_for_visit": a.ReasonForVisit,
		"timezone_snapshot": a.TimezoneSnapshot,
	}
}

func medicationJSON(m gen.Medication) map[string]any {
	return map[string]any{
		"_id": m.ID.String(), "consultation_id": uuidOrNull(m.ConsultationID),
		"user_id": uuidOrNull(m.PatientID), "doctor_id": uuidOrNull(m.DoctorID),
		"formulary": m.Formulary, "medication": m.Medication,
		"dose": m.Dose, "unit": m.Unit, "interval": m.Interval,
		"duration": m.Duration, "duration_unit": m.DurationUnit,
		"order_instruction": textOrNull(m.OrderInstruction),
		"start_date":        textOrNull(m.StartDate),
		"assign_to_patient": m.AssignToPatient, "status": m.Status,
		"createdAt": isoOrNull(m.CreatedAt), "updatedAt": isoOrNull(m.UpdatedAt),
	}
}

func investigationListJSON(r gen.InvestigationList) map[string]any {
	return map[string]any{
		"_id": r.ID.String(), "consultation_id": uuidOrNull(r.ConsultationID),
		"user_id": uuidOrNull(r.PatientID), "doctor_id": uuidOrNull(r.DoctorID),
		"name": r.Name, "category": textOrNull(r.Category),
		"test_requested": textOrNull(r.TestRequested), "priority": r.Priority,
		"specimen": r.Specimen, "assign_to_patient": r.AssignToPatient,
		"result_images": strs(r.ResultImages),
		"createdAt":     isoOrNull(r.CreatedAt), "updatedAt": isoOrNull(r.UpdatedAt),
	}
}

func diagnosisJSON(d gen.Diagnosis) map[string]any {
	return map[string]any{
		"_id": d.ID.String(), "consultation_id": uuidOrNull(d.ConsultationID),
		"user_id": uuidOrNull(d.PatientID), "doctor_id": uuidOrNull(d.DoctorID),
		"title": d.Title, "description": d.Description, "status": d.Status,
		"createdAt": isoOrNull(d.CreatedAt), "updatedAt": isoOrNull(d.UpdatedAt),
	}
}

func diagnosisFormJSON(d gen.DiagnosisForm) map[string]any {
	return map[string]any{
		"_id": d.ID.String(), "consultation_id": uuidOrNull(d.ConsultationID),
		"user_id": uuidOrNull(d.PatientID), "doctor_id": uuidOrNull(d.DoctorID),
		"provisional_diagnosis": strs(d.ProvisionalDiagnosis),
		"final_diagnosis":       strs(d.FinalDiagnosis),
		"status":                d.Status,
		"createdAt":             isoOrNull(d.CreatedAt), "updatedAt": isoOrNull(d.UpdatedAt),
	}
}

func referralJSON(r gen.Referral) map[string]any {
	return map[string]any{
		"_id": r.ID.String(), "consultation_id": uuidOrNull(r.ConsultationID),
		"user_id": uuidOrNull(r.PatientID), "doctor_id": uuidOrNull(r.DoctorID),
		"referred_doctor_name": textOrNull(r.ReferredDoctorName),
		"specialist_name":      r.SpecialistName, "specialty": textOrNull(r.Specialty),
		"hospital": r.Hospital, "hospital_address": strs(r.HospitalAddress),
		"attachment_investigation_ids": strs(r.AttachmentInvestigationIds),
		"referral_details":             r.ReferralDetails, "assign_to_patient": r.AssignToPatient,
		"createdAt": isoOrNull(r.CreatedAt), "updatedAt": isoOrNull(r.UpdatedAt),
	}
}

// --- lifecycle --------------------------------------------------------------

// StartInput mirrors Partial<CreateConsultationDto>.
type StartInput struct {
	Type, ConsoltationFor, Title, Details, TreatmentPlan string
}

// Start opens the consultation workspace for a CONFIRMED appointment owned
// by the doctor. Existing workspaces resume: CANCELED/COMPLETED → 409,
// otherwise reactivated to ACTIVE with supplied fields merged.
func (s *Service) Start(ctx context.Context, doctorID, appointmentID string, in StartInput) (map[string]any, error) {
	var aid pgtype.UUID
	if err := aid.Scan(appointmentID); err != nil {
		return nil, auth.BadRequest("Invalid appointment id")
	}
	appt, err := s.q().GetAppointmentByID(ctx, aid)
	if err != nil {
		return nil, auth.NotFound("Appointment not found for this doctor")
	}
	if !appt.DoctorID.Valid || appt.DoctorID.String() != doctorID {
		return nil, auth.NotFound("Appointment not found for this doctor")
	}
	if appt.Status != "CONFIRMED" {
		return nil, auth.Conflict("Consultation can only be started from a confirmed appointment")
	}
	if existing, err := s.q().GetConsultationByAppointment(ctx, aid); err == nil {
		switch existing.Status {
		case StatusCanceled, StatusCompleted:
			return nil, auth.Conflict(fmt.Sprintf("Consultation is already %s", strings.ToLower(existing.Status)))
		}
		title, details := existing.Title, existing.Details
		if strings.TrimSpace(in.Title) != "" {
			title = strings.TrimSpace(in.Title)
		}
		if strings.TrimSpace(in.Details) != "" {
			details = strings.TrimSpace(in.Details)
		}
		updated, err := s.q().UpdateConsultationWorkspace(ctx, gen.UpdateConsultationWorkspaceParams{
			ID: existing.ID, DoctorID: appt.DoctorID, PatientID: appt.PatientID,
			Title: title, Details: details,
			TreatmentPlan: textOrEmpty(in.TreatmentPlan),
		})
		if err != nil {
			return nil, err
		}
		return s.DoctorDetail(ctx, doctorID, updated.ID.String())
	}
	consultType := in.Type
	if !validTypes[consultType] {
		consultType = TypeVideo
	}
	forWho := in.ConsoltationFor
	if forWho != "SELF" && forWho != "OTHERS" {
		forWho = "SELF"
	}
	title := in.Title
	if title == "" {
		title = "Consultation from booking"
	}
	ref, err := Reference(consultType)
	if err != nil {
		return nil, err
	}
	for i := 0; i < 5; i++ {
		created, err := s.q().CreateConsultation(ctx, gen.CreateConsultationParams{
			AppointmentID: aid, Reference: ref, Type: consultType,
			PatientID: appt.PatientID, DoctorID: appt.DoctorID,
			ConsoltationFor: forWho, Title: title,
			Details: in.Details, SessionNumber: textOrEmpty("1"),
			TreatmentPlan: textOrEmpty(in.TreatmentPlan),
			Status:        StatusActive, Meta: []byte("{}"),
		})
		if err == nil {
			return s.DoctorDetail(ctx, doctorID, created.ID.String())
		}
		if !isUniqueViolation(err) {
			return nil, err
		}
		if ref, err = Reference(consultType); err != nil {
			return nil, err
		}
	}
	return nil, auth.Conflict("Could not start consultation")
}

func textOrEmpty(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "SQLSTATE 23505")
}

// Complete marks the workspace COMPLETED, completes a linked active
// appointment, and emits the patient summary notification.
func (s *Service) Complete(ctx context.Context, doctorID, consultationID string) (map[string]any, error) {
	var cid pgtype.UUID
	if err := cid.Scan(consultationID); err != nil {
		return nil, auth.BadRequest("Invalid consultation id")
	}
	c, err := s.q().GetConsultationByID(ctx, cid)
	if err != nil {
		return nil, auth.NotFound("Consultation not found for this doctor")
	}
	if !c.DoctorID.Valid || c.DoctorID.String() != doctorID {
		return nil, auth.NotFound("Consultation not found for this doctor")
	}
	switch c.Status {
	case StatusCanceled:
		return nil, auth.Conflict("Canceled consultation cannot be completed")
	case StatusCompleted:
		return nil, auth.Conflict("Consultation is already completed")
	}
	updated, err := s.q().UpdateConsultationStatus(ctx, gen.UpdateConsultationStatusParams{ID: cid, Status: StatusCompleted})
	if err != nil {
		return nil, err
	}
	if updated.AppointmentID.Valid {
		if appt, err := s.q().GetAppointmentByID(ctx, updated.AppointmentID); err == nil {
			if appt.Status == "PENDING" || appt.Status == "CONFIRMED" {
				_, _ = s.q().UpdateAppointmentStatus(ctx, gen.UpdateAppointmentStatusParams{ID: appt.ID, Status: StatusCompleted})
			}
		}
	}
	s.emitSummary(ctx, updated)
	return map[string]any{"message": "Consultation completed"}, nil
}

func (s *Service) emitSummary(ctx context.Context, c gen.Consultation) {
	if !c.PatientID.Valid {
		return
	}
	data, _ := jsonMarshal(map[string]any{"consultation_id": c.ID.String(), "status": c.Status})
	_ = s.q().CreateNotification(ctx, gen.CreateNotificationParams{
		RecipientID: c.PatientID, RecipientType: "patient",
		Type: "CONSULTATION_SUMMARY_AVAILABLE", Category: "CONSULTATION",
		Title: "Consultation summary available",
		Body:  "Your consultation is complete. The summary is ready to view.",
		Data:  data, ConsultationID: c.ID,
		ActorID: c.DoctorID, ActorType: textOrEmpty("doctor"),
		DeepLink: textOrEmpty("/consultations/" + c.ID.String()),
		EventKey: "consultation_summary:" + c.ID.String() + ":patient:" + c.PatientID.String(),
	})
}

// func textStr(v pgtype.Text) string {
// 	if v.Valid {
// 		return v.String
// 	}
// 	return ""
// }

// --- listings ---------------------------------------------------------------

func pagePerPage(page, perPage int) (int, int) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 10
	}
	return page, perPage
}

// ListPatient returns {consultation, meta} filtered by owner only (Nest
// accepts q/dates but ignores them — preserved).
func (s *Service) ListPatient(ctx context.Context, patientID string, page, perPage int) (map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	page, perPage = pagePerPage(page, perPage)
	rows, err := s.q().ListPatientConsultations(ctx, gen.ListPatientConsultationsParams{
		PatientID: uid, Limit: int32(perPage), Offset: int32((page - 1) * perPage),
	})
	if err != nil {
		return nil, err
	}
	total, err := s.q().CountPatientConsultations(ctx, uid)
	if err != nil {
		return nil, err
	}
	cp := s.loadCounterparties(ctx, rows)
	items := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		items = append(items, s.withDoctorAndAppointmentBatched(r, cp))
	}
	lastPage := 1
	if total > 0 {
		lastPage = int((total + int64(perPage) - 1) / int64(perPage))
	}
	return map[string]any{
		"consultation": items,
		"meta":         map[string]any{"total": total, "page": page, "lastPage": lastPage},
	}, nil
}

// ListDoctor mirrors ListPatient for doctors.
func (s *Service) ListDoctor(ctx context.Context, doctorID string, page, perPage int) (map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	page, perPage = pagePerPage(page, perPage)
	rows, err := s.q().ListDoctorConsultations(ctx, gen.ListDoctorConsultationsParams{
		DoctorID: uid, Limit: int32(perPage), Offset: int32((page - 1) * perPage),
	})
	if err != nil {
		return nil, err
	}
	total, err := s.q().CountDoctorConsultations(ctx, uid)
	if err != nil {
		return nil, err
	}
	cp := s.loadCounterparties(ctx, rows)
	items := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		items = append(items, s.withPatientAndAppointmentBatched(r, cp))
	}
	lastPage := 1
	if total > 0 {
		lastPage = int((total + int64(perPage) - 1) / int64(perPage))
	}
	return map[string]any{
		"consultation": items,
		"meta":         map[string]any{"total": total, "page": page, "lastPage": lastPage},
	}, nil
}

// AllPatient / AllDoctor return unpaginated arrays.
func (s *Service) AllPatient(ctx context.Context, patientID string) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	rows, err := s.q().PatientHistoryConsultations(ctx, uid)
	if err != nil {
		return nil, err
	}
	cp := s.loadCounterparties(ctx, rows)
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, s.withDoctorAndAppointmentBatched(r, cp))
	}
	return out, nil
}

func (s *Service) AllDoctor(ctx context.Context, doctorID string) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(doctorID); err != nil {
		return nil, auth.NotFound("Doctor not found")
	}
	rows, err := s.q().ListDoctorConsultations(ctx, gen.ListDoctorConsultationsParams{
		DoctorID: uid, Limit: 10000, Offset: 0,
	})
	if err != nil {
		return nil, err
	}
	cp := s.loadCounterparties(ctx, rows)
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, s.withPatientAndAppointmentBatched(r, cp))
	}
	return out, nil
}

// counterparties holds batch-loaded relations for a page of
// consultations: 3 fixed queries instead of up to 3 per row (N+1).
type counterparties struct {
	doctors  map[string]gen.Doctor
	patients map[string]gen.Patient
	appts    map[string]gen.Appointment
}

func (s *Service) loadCounterparties(ctx context.Context, rows []gen.Consultation) counterparties {
	cp := counterparties{
		doctors: map[string]gen.Doctor{}, patients: map[string]gen.Patient{},
		appts: map[string]gen.Appointment{},
	}
	var dids, pids, aids []pgtype.UUID
	seenD, seenP, seenA := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, r := range rows {
		if r.DoctorID.Valid && !seenD[r.DoctorID.String()] {
			seenD[r.DoctorID.String()] = true
			dids = append(dids, r.DoctorID)
		}
		if r.PatientID.Valid && !seenP[r.PatientID.String()] {
			seenP[r.PatientID.String()] = true
			pids = append(pids, r.PatientID)
		}
		if r.AppointmentID.Valid && !seenA[r.AppointmentID.String()] {
			seenA[r.AppointmentID.String()] = true
			aids = append(aids, r.AppointmentID)
		}
	}
	if len(dids) > 0 {
		if docs, err := s.q().GetDoctorsByIDs(ctx, dids); err == nil {
			for _, d := range docs {
				cp.doctors[d.ID.String()] = d
			}
		}
	}
	if len(pids) > 0 {
		if us, err := s.q().GetPatientsByIDs(ctx, pids); err == nil {
			for _, u := range us {
				cp.patients[u.ID.String()] = u
			}
		}
	}
	if len(aids) > 0 {
		if as, err := s.q().GetAppointmentsByIDs(ctx, aids); err == nil {
			for _, a := range as {
				cp.appts[a.ID.String()] = a
			}
		}
	}
	return cp
}

func (s *Service) withDoctorAndAppointmentBatched(r gen.Consultation, cp counterparties) map[string]any {
	item := consultationBase(r)
	if r.DoctorID.Valid {
		if doc, ok := cp.doctors[r.DoctorID.String()]; ok {
			item["doctor_id"] = doctorBrief(doc)
		}
	}
	if r.AppointmentID.Valid {
		if appt, ok := cp.appts[r.AppointmentID.String()]; ok {
			item["appointment_id"] = appointmentCard(appt)
		}
	}
	return item
}

func (s *Service) withPatientAndAppointmentBatched(r gen.Consultation, cp counterparties) map[string]any {
	item := consultationBase(r)
	if r.PatientID.Valid {
		if user, ok := cp.patients[r.PatientID.String()]; ok {
			item["user_id"] = patientCard(user)
		}
	}
	if r.AppointmentID.Valid {
		if appt, ok := cp.appts[r.AppointmentID.String()]; ok {
			item["appointment_id"] = appointmentCard(appt)
		}
	}
	if r.DoctorID.Valid {
		if doc, ok := cp.doctors[r.DoctorID.String()]; ok {
			item["doctor_id"] = doctorCard(doc)
		}
	}
	return item
}

func (s *Service) withDoctorAndAppointment(ctx context.Context, r gen.Consultation) map[string]any {
	return s.withDoctorAndAppointmentBatched(r, s.loadCounterparties(ctx, []gen.Consultation{r}))
}

func (s *Service) withPatientAndAppointment(ctx context.Context, r gen.Consultation) map[string]any {
	return s.withPatientAndAppointmentBatched(r, s.loadCounterparties(ctx, []gen.Consultation{r}))
}

// --- singles ----------------------------------------------------------------

// PatientDetail populates clinical children; 401 on owner mismatch.
func (s *Service) PatientDetail(ctx context.Context, patientID, consultationID string) (map[string]any, error) {
	var cid pgtype.UUID
	if err := cid.Scan(consultationID); err != nil {
		return nil, auth.BadRequest("Invalid consultation id")
	}
	c, err := s.q().GetConsultationByID(ctx, cid)
	if err != nil {
		return nil, auth.NotFound("Consultation not found")
	}
	if !c.PatientID.Valid || c.PatientID.String() != patientID {
		return nil, auth.Unauthorized("Invalid User")
	}
	return s.fullDetail(ctx, c), nil
}

// DoctorDetail mirrors PatientDetail for doctors.
func (s *Service) DoctorDetail(ctx context.Context, doctorID, consultationID string) (map[string]any, error) {
	var cid pgtype.UUID
	if err := cid.Scan(consultationID); err != nil {
		return nil, auth.BadRequest("Invalid consultation id")
	}
	c, err := s.q().GetConsultationByID(ctx, cid)
	if err != nil {
		return nil, auth.NotFound("Consultation not found")
	}
	if !c.DoctorID.Valid || c.DoctorID.String() != doctorID {
		return nil, auth.Unauthorized("Invalid User")
	}
	return s.fullDetail(ctx, c), nil
}

func (s *Service) fullDetail(ctx context.Context, c gen.Consultation) map[string]any {
	item := consultationBase(c)
	if c.DoctorID.Valid {
		if doc, err := s.q().GetDoctorByID(ctx, c.DoctorID); err == nil {
			item["doctor_id"] = doctorCard(doc)
		}
	}
	if c.PatientID.Valid {
		if user, err := s.q().GetPatientByID(ctx, c.PatientID); err == nil {
			item["user_id"] = patientCard(user)
		}
	}
	if c.AppointmentID.Valid {
		if appt, err := s.q().GetAppointmentByID(ctx, c.AppointmentID); err == nil {
			item["appointment_id"] = appointmentCard(appt)
		}
	}
	if meds, err := s.q().MedicationsByConsultation(ctx, c.ID); err == nil {
		out := make([]map[string]any, 0, len(meds))
		for _, m := range meds {
			out = append(out, medicationJSON(m))
		}
		item["medication_id"] = out
	}
	if lists, err := s.q().InvestigationListsByConsultation(ctx, c.ID); err == nil {
		out := make([]map[string]any, 0, len(lists))
		for _, r := range lists {
			out = append(out, investigationListJSON(r))
		}
		item["investigation_id"] = out
	}
	if diags, err := s.q().DiagnosesByConsultation(ctx, c.ID); err == nil {
		out := make([]map[string]any, 0, len(diags))
		for _, d := range diags {
			out = append(out, diagnosisJSON(d))
		}
		item["diagnosis_id"] = out
	}
	if ht, err := s.q().GetHistoryTaking(ctx, c.ID); err == nil {
		item["history_taking_id"] = historyTakingJSON(ht)
	}
	if pe, err := s.q().GetPhysicalExam(ctx, c.ID); err == nil {
		item["physical_exam_id"] = physicalExamJSON(pe)
	}
	if ir, err := s.q().GetInvestigationResult(ctx, c.ID); err == nil {
		item["investigation_result_id"] = investigationResultJSON(ir)
	}
	if tp, err := s.q().GetTreatmentPlan(ctx, c.ID); err == nil {
		item["treatment_plan_id"] = treatmentPlanJSON(tp)
	}
	if df, err := s.q().GetDiagnosisForm(ctx, c.ID); err == nil {
		item["diagnosis_form_id"] = diagnosisFormJSON(df)
	}
	return item
}

func historyTakingJSON(h gen.HistoryTaking) map[string]any {
	return map[string]any{
		"_id": h.ID.String(), "consultation_id": uuidOrNull(h.ConsultationID),
		"present_complaint":               h.PresentComplaint,
		"history_of_presenting_complaint": textOrNull(h.HistoryOfPresentingComplaint),
		"past_medical_surgical_history":   textOrNull(h.PastMedicalSurgicalHistory),
		"medication_history":              textOrNull(h.MedicationHistory),
		"allergy_history":                 strs(h.AllergyHistory),
		"family_history":                  textOrNull(h.FamilyHistory), "travel_history": textOrNull(h.TravelHistory),
		"occupation": textOrNull(h.Occupation), "social_history": textOrNull(h.SocialHistory),
		"obstetric_gynaecological_history": textOrNull(h.ObstetricGynaecologicalHistory),
		"others":                           textOrNull(h.Others), "status": h.Status,
	}
}

func physicalExamJSON(p gen.PhysicalExam) map[string]any {
	return map[string]any{
		"_id": p.ID.String(), "consultation_id": uuidOrNull(p.ConsultationID),
		"general_physical":        textOrNull(p.GeneralPhysical),
		"nervous_system":          textOrNull(p.NervousSystem),
		"respiratory_system":      textOrNull(p.RespiratorySystem),
		"cardiovascular_system":   textOrNull(p.CardiovascularSystem),
		"gastrointestinal_system": textOrNull(p.GastrointestinalSystem),
		"genitourinary_system":    textOrNull(p.GenitourinarySystem),
		"musculoskeletal_system":  textOrNull(p.MusculoskeletalSystem),
		"ent":                     textOrNull(p.Ent), "obstetric_gynaecological": textOrNull(p.ObstetricGynaecological),
		"others": textOrNull(p.Others), "status": p.Status,
	}
}

func investigationResultJSON(r gen.InvestigationResult) map[string]any {
	return map[string]any{
		"_id": r.ID.String(), "consultation_id": uuidOrNull(r.ConsultationID),
		"blood_test": textOrNull(r.BloodTest), "microbiology": textOrNull(r.Microbiology),
		"radiology": textOrNull(r.Radiology), "cardiovascular": textOrNull(r.Cardiovascular),
		"procedures": textOrNull(r.Procedures), "others": textOrNull(r.Others),
		"status": r.Status,
	}
}

func treatmentPlanJSON(t gen.TreatmentPlan) map[string]any {
	return map[string]any{
		"_id": t.ID.String(), "consultation_id": uuidOrNull(t.ConsultationID),
		"treatment_plan_details": textOrNull(t.TreatmentPlanDetails), "status": t.Status,
	}
}

// --- weekly -----------------------------------------------------------------

// Weekly returns consultations created in the trailing 7 days for the owner.
func (s *Service) Weekly(ctx context.Context, ownerID, role string) ([]map[string]any, error) {
	now := time.Now()
	since := now.Add(-7 * 24 * time.Hour)
	var patientUUID, doctorUUID pgtype.UUID
	if role == "patient" {
		if err := patientUUID.Scan(ownerID); err != nil {
			return nil, auth.NotFound("Patient not found")
		}
	} else {
		if err := doctorUUID.Scan(ownerID); err != nil {
			return nil, auth.NotFound("Doctor not found")
		}
	}
	rows, err := s.q().RecentConsultations(ctx, gen.RecentConsultationsParams{
		Column1: patientUUID, Column2: doctorUUID,
		CreatedAt:   pgtype.Timestamptz{Time: since, Valid: true},
		CreatedAt_2: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	cp := s.loadCounterparties(ctx, rows)
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		if role == "patient" {
			out = append(out, s.withDoctorAndAppointmentBatched(r, cp))
		} else {
			out = append(out, s.withPatientAndAppointmentBatched(r, cp))
		}
	}
	return out, nil
}

// --- doctor patient-history -------------------------------------------------

// PatientHistory returns the patient's consultations with clinical children
// populated (newest first), for the consulting doctor.
func (s *Service) PatientHistory(ctx context.Context, patientID string) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	rows, err := s.q().PatientHistoryConsultations(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, s.fullDetail(ctx, r))
	}
	return out, nil
}

// HistoryConsultations returns the 5-latest summary rows.
func (s *Service) HistoryConsultations(ctx context.Context, patientID string) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	rows, err := s.q().HistoryConsultationsLimit5(ctx, uid)
	if err != nil {
		return nil, err
	}
	cp := s.loadCounterparties(ctx, rows)
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		item := map[string]any{
			"_id": r.ID.String(), "title": r.Title, "type": r.Type,
			"consoltation_for": r.ConsoltationFor, "status": r.Status,
			"session_number": textOrNull(r.SessionNumber),
			"createdAt":      isoOrNull(r.CreatedAt), "updatedAt": isoOrNull(r.UpdatedAt),
		}
		if r.DoctorID.Valid {
			if doc, ok := cp.doctors[r.DoctorID.String()]; ok {
				item["doctor_id"] = doctorBrief(doc)
			}
		}
		if r.AppointmentID.Valid {
			if appt, ok := cp.appts[r.AppointmentID.String()]; ok {
				item["appointment_id"] = appointmentCard(appt)
			}
		}
		out = append(out, item)
	}
	return out, nil
}

// HistoryMedications returns the 5-latest patient medications enriched.
func (s *Service) HistoryMedications(ctx context.Context, patientID string) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	rows, err := s.q().MedicationsByPatient(ctx, gen.MedicationsByPatientParams{
		PatientID: uid, Column2: "", Limit: 5, Offset: 0,
	})
	if err != nil {
		return nil, err
	}
	return s.enrichMedications(ctx, rows), nil
}

func (s *Service) enrichMedications(ctx context.Context, rows []gen.Medication) []map[string]any {
	var cids, dids []pgtype.UUID
	seenC, seenD := map[string]bool{}, map[string]bool{}
	for _, m := range rows {
		if m.ConsultationID.Valid && !seenC[m.ConsultationID.String()] {
			seenC[m.ConsultationID.String()] = true
			cids = append(cids, m.ConsultationID)
		}
		if m.DoctorID.Valid && !seenD[m.DoctorID.String()] {
			seenD[m.DoctorID.String()] = true
			dids = append(dids, m.DoctorID)
		}
	}
	consults, doctors := s.consultDoctorLookups(ctx, cids, dids)
	out := make([]map[string]any, 0, len(rows))
	for _, m := range rows {
		item := medicationJSON(m)
		if m.ConsultationID.Valid {
			if c, ok := consults[m.ConsultationID.String()]; ok {
				item["consultation_id"] = consultMini(c)
			}
		}
		if m.DoctorID.Valid {
			if doc, ok := doctors[m.DoctorID.String()]; ok {
				item["doctor_id"] = doctorBrief(doc)
			}
		}
		out = append(out, item)
	}
	return out
}

// consultDoctorLookups batch-loads consultations + doctors for enrichers
// (2 fixed queries instead of up to 2 per row).
func (s *Service) consultDoctorLookups(ctx context.Context, cids, dids []pgtype.UUID) (map[string]gen.Consultation, map[string]gen.Doctor) {
	consults := map[string]gen.Consultation{}
	if len(cids) > 0 {
		if cs, err := s.q().GetConsultationsByIDs(ctx, cids); err == nil {
			for _, c := range cs {
				consults[c.ID.String()] = c
			}
		}
	}
	doctors := map[string]gen.Doctor{}
	if len(dids) > 0 {
		if ds, err := s.q().GetDoctorsByIDs(ctx, dids); err == nil {
			for _, d := range ds {
				doctors[d.ID.String()] = d
			}
		}
	}
	return consults, doctors
}

func consultMini(c gen.Consultation) map[string]any {
	return map[string]any{
		"_id": c.ID.String(), "title": c.Title, "type": c.Type,
		"status": c.Status, "createdAt": isoOrNull(c.CreatedAt),
	}
}

// HistoryDiagnoses reads diagnosis FORMS (not legacy rows, Nest parity).
func (s *Service) HistoryDiagnoses(ctx context.Context, patientID string) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	rows, err := s.q().DiagnosisFormsByPatient(ctx, gen.DiagnosisFormsByPatientParams{PatientID: uid, Limit: 5})
	if err != nil {
		return nil, err
	}
	var cids, dids []pgtype.UUID
	seenC, seenD := map[string]bool{}, map[string]bool{}
	for _, d := range rows {
		if d.ConsultationID.Valid && !seenC[d.ConsultationID.String()] {
			seenC[d.ConsultationID.String()] = true
			cids = append(cids, d.ConsultationID)
		}
		if d.DoctorID.Valid && !seenD[d.DoctorID.String()] {
			seenD[d.DoctorID.String()] = true
			dids = append(dids, d.DoctorID)
		}
	}
	consults, doctors := s.consultDoctorLookups(ctx, cids, dids)
	out := make([]map[string]any, 0, len(rows))
	for _, d := range rows {
		item := diagnosisFormJSON(d)
		if d.ConsultationID.Valid {
			if c, ok := consults[d.ConsultationID.String()]; ok {
				item["consultation_id"] = consultMini(c)
			}
		}
		if d.DoctorID.Valid {
			if doc, ok := doctors[d.DoctorID.String()]; ok {
				item["doctor_id"] = doctorBrief(doc)
			}
		}
		out = append(out, item)
	}
	return out, nil
}

// HistoryInvestigations groups assigned lists by consultation (paginated).
func (s *Service) HistoryInvestigations(ctx context.Context, patientID string, page, perPage int) (map[string]any, error) {
	groups, pagination, err := s.groupedInvestigations(ctx, patientID, page, perPage)
	if err != nil {
		return nil, err
	}
	return map[string]any{"groups": groups, "pagination": pagination}, nil
}

func (s *Service) groupedInvestigations(ctx context.Context, patientID string, page, perPage int) ([]map[string]any, map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, nil, auth.NotFound("Patient not found")
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	ids, err := s.q().AssignedInvestigationConsultationIDs(ctx, uid)
	if err != nil {
		return nil, nil, err
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
	pageIDs := ids[start:end]
	allLists, err := s.q().InvestigationListsByConsultations(ctx, pageIDs)
	if err != nil {
		return nil, nil, err
	}
	listsByCID := map[string][]gen.InvestigationList{}
	for _, r := range allLists {
		k := r.ConsultationID.String()
		listsByCID[k] = append(listsByCID[k], r)
	}
	consults := map[string]gen.Consultation{}
	if cs, err := s.q().GetConsultationsByIDs(ctx, pageIDs); err == nil {
		for _, c := range cs {
			consults[c.ID.String()] = c
		}
	}
	var dids, aids []pgtype.UUID
	seenD, seenA := map[string]bool{}, map[string]bool{}
	for _, c := range consults {
		if c.DoctorID.Valid && !seenD[c.DoctorID.String()] {
			seenD[c.DoctorID.String()] = true
			dids = append(dids, c.DoctorID)
		}
		if c.AppointmentID.Valid && !seenA[c.AppointmentID.String()] {
			seenA[c.AppointmentID.String()] = true
			aids = append(aids, c.AppointmentID)
		}
	}
	doctors := map[string]gen.Doctor{}
	if len(dids) > 0 {
		if ds, err := s.q().GetDoctorsByIDs(ctx, dids); err == nil {
			for _, d := range ds {
				doctors[d.ID.String()] = d
			}
		}
	}
	appts := map[string]gen.Appointment{}
	if len(aids) > 0 {
		if as, err := s.q().GetAppointmentsByIDs(ctx, aids); err == nil {
			for _, a := range as {
				appts[a.ID.String()] = a
			}
		}
	}
	groups := make([]map[string]any, 0)
	for _, cid := range pageIDs {
		lists := listsByCID[cid.String()]
		if len(lists) == 0 {
			continue
		}
		assigned := make([]map[string]any, 0, len(lists))
		for _, r := range lists {
			if r.AssignToPatient {
				assigned = append(assigned, investigationListJSON(r))
			}
		}
		if len(assigned) == 0 {
			continue
		}
		g := map[string]any{
			"investigation_count": len(assigned), "investigations": assigned,
		}
		if c, ok := consults[cid.String()]; ok {
			cj := map[string]any{
				"_id": c.ID.String(), "title": c.Title, "type": c.Type,
				"consoltation_for": c.ConsoltationFor, "status": c.Status,
				"session_number":  textOrNull(c.SessionNumber),
				"consultation_id": c.Reference,
			}
			if c.DoctorID.Valid {
				if doc, ok := doctors[c.DoctorID.String()]; ok {
					cj["doctor"] = doctorBrief(doc)
				}
			}
			if c.AppointmentID.Valid {
				if appt, ok := appts[c.AppointmentID.String()]; ok {
					cj["appointment"] = appointmentCard(appt)
				}
			}
			g["consultation"] = cj
		}
		groups = append(groups, g)
	}
	return groups, map[string]any{
		"total": total, "page": page, "perPage": perPage, "total_pages": pages,
	}, nil
}

// ConsultationMedications lists one consultation's medications (legacy
// med-list route; ownership enforced by callers via ownedConsultation).
func (s *Service) ConsultationMedications(ctx context.Context, consultationID string) ([]map[string]any, error) {
	var cid pgtype.UUID
	if err := cid.Scan(consultationID); err != nil {
		return nil, auth.NotFound("Consultation not found")
	}
	rows, err := s.q().MedicationsByConsultation(ctx, cid)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, m := range rows {
		out = append(out, medicationJSON(m))
	}
	return out, nil
}

// --- patient self reads -----------------------------------------------------

// PatientMedications lists with optional name filter (query=all skips it).
func (s *Service) PatientMedications(ctx context.Context, patientID, query string, limit, offset int) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	if strings.TrimSpace(query) == "" || strings.EqualFold(strings.TrimSpace(query), "all") {
		query = ""
	}
	rows, err := s.q().MedicationsByPatient(ctx, gen.MedicationsByPatientParams{
		PatientID: uid, Column2: strings.TrimSpace(query),
		Limit: int32(limit), Offset: int32(offset),
	})
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, m := range rows {
		out = append(out, medicationJSON(m))
	}
	return out, nil
}

// PatientActiveMedications filters status=ACTIVE.
func (s *Service) PatientActiveMedications(ctx context.Context, patientID string, limit, offset int) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	rows, err := s.q().ActiveMedicationsByPatient(ctx, gen.ActiveMedicationsByPatientParams{
		PatientID: uid, Limit: int32(limit), Offset: int32(offset),
	})
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, m := range rows {
		out = append(out, medicationJSON(m))
	}
	return out, nil
}

// PatientMedication returns one owned medication.
func (s *Service) PatientMedication(ctx context.Context, patientID, id string) (map[string]any, error) {
	var mid pgtype.UUID
	if err := mid.Scan(id); err != nil {
		return nil, auth.NotFound("Medication not found")
	}
	m, err := s.q().GetMedicationByID(ctx, mid)
	if err != nil {
		return nil, auth.NotFound("Medication not found")
	}
	if !m.PatientID.Valid || m.PatientID.String() != patientID {
		return nil, auth.Unauthorized("Invalid User")
	}
	return medicationJSON(m), nil
}

// MedicationsGroupedByConsultation groups all patient meds per consultation.
func (s *Service) MedicationsGroupedByConsultation(ctx context.Context, patientID string, page, perPage int) (map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	ids, err := s.q().MedicationConsultationIDs(ctx, uid)
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
	for _, cid := range ids[start:end] {
		meds, err := s.q().MedicationsByConsultation(ctx, cid)
		if err != nil || len(meds) == 0 {
			continue
		}
		out := make([]map[string]any, 0, len(meds))
		for _, m := range meds {
			out = append(out, medicationJSON(m))
		}
		g := map[string]any{"medication_count": len(out), "medications": out}
		if c, err := s.q().GetConsultationByID(ctx, cid); err == nil {
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

// MedicationsGroupedByFormulary groups one consultation's meds by formulary.
func (s *Service) MedicationsGroupedByFormulary(ctx context.Context, patientID, consultationID string) (map[string]any, error) {
	cid, c, err := s.ownedConsultation(ctx, patientID, consultationID)
	if err != nil {
		return nil, err
	}
	_ = c
	formularies, err := s.q().MedsGroupedByFormulary(ctx, cid)
	if err != nil {
		return nil, err
	}
	meds, err := s.q().MedicationsByConsultation(ctx, cid)
	if err != nil {
		return nil, err
	}
	byForm := map[string][]map[string]any{}
	for _, m := range formularies {
		byForm[m.Formulary] = []map[string]any{}
	}
	for _, m := range meds {
		byForm[m.Formulary] = append(byForm[m.Formulary], medicationJSON(m))
	}
	groups := make([]map[string]any, 0, len(formularies))
	for _, f := range formularies {
		groups = append(groups, map[string]any{
			"formulary": f.Formulary, "count": len(byForm[f.Formulary]),
			"medications": byForm[f.Formulary],
		})
	}
	var total int64
	for _, g := range groups {
		total += int64(g["count"].(int))
	}
	return map[string]any{
		"consultation_id": consultationID, "total": total, "groups": groups,
	}, nil
}

func (s *Service) ownedConsultation(ctx context.Context, patientID, consultationID string) (pgtype.UUID, gen.Consultation, error) {
	var cid pgtype.UUID
	if err := cid.Scan(consultationID); err != nil {
		return cid, gen.Consultation{}, auth.NotFound("Consultation not found")
	}
	c, err := s.q().GetConsultationByID(ctx, cid)
	if err != nil {
		return cid, gen.Consultation{}, auth.NotFound("Consultation not found")
	}
	if !c.PatientID.Valid || c.PatientID.String() != patientID {
		return cid, gen.Consultation{}, auth.Unauthorized("Invalid User")
	}
	return cid, c, nil
}

// ConsultationInvestigations returns one consultation's investigation lists.
func (s *Service) ConsultationInvestigations(ctx context.Context, patientID, consultationID string) (map[string]any, error) {
	cid, c, err := s.ownedConsultation(ctx, patientID, consultationID)
	if err != nil {
		return nil, err
	}
	lists, err := s.q().InvestigationListsByConsultation(ctx, cid)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(lists))
	for _, r := range lists {
		out = append(out, investigationListJSON(r))
	}
	_ = c
	return map[string]any{
		"consultation":        consultationBase(c),
		"investigation_count": len(out), "investigations": out,
	}, nil
}

// ConsultationReferrals lists one consultation's referrals.
func (s *Service) ConsultationReferrals(ctx context.Context, patientID, consultationID string) ([]map[string]any, error) {
	cid, _, err := s.ownedConsultation(ctx, patientID, consultationID)
	if err != nil {
		return nil, err
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

// PatientReferrals lists all patient referrals.
func (s *Service) PatientReferrals(ctx context.Context, patientID string, limit, offset int) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	rows, err := s.q().ReferralsByPatient(ctx, gen.ReferralsByPatientParams{
		PatientID: uid, Limit: int32(limit), Offset: int32(offset),
	})
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, referralJSON(r))
	}
	return out, nil
}

// PatientReferral returns one owned referral.
func (s *Service) PatientReferral(ctx context.Context, patientID, id string) (map[string]any, error) {
	var rid pgtype.UUID
	if err := rid.Scan(id); err != nil {
		return nil, auth.NotFound("Referral not found")
	}
	r, err := s.q().GetReferralByID(ctx, rid)
	if err != nil {
		return nil, auth.NotFound("Referral not found")
	}
	if !r.PatientID.Valid || r.PatientID.String() != patientID {
		return nil, auth.Unauthorized("Invalid User")
	}
	return referralJSON(r), nil
}

// ReferralsGroupedByConsultation groups all patient referrals per consultation.
func (s *Service) ReferralsGroupedByConsultation(ctx context.Context, patientID string) ([]map[string]any, error) {
	var uid pgtype.UUID
	if err := uid.Scan(patientID); err != nil {
		return nil, auth.NotFound("Patient not found")
	}
	rows, err := s.q().ReferralsByPatient(ctx, gen.ReferralsByPatientParams{
		PatientID: uid, Limit: 10000, Offset: 0,
	})
	if err != nil {
		return nil, err
	}
	byCons := map[string][]map[string]any{}
	order := []string{}
	for _, r := range rows {
		key := ""
		if r.ConsultationID.Valid {
			key = r.ConsultationID.String()
		}
		if _, ok := byCons[key]; !ok {
			order = append(order, key)
		}
		byCons[key] = append(byCons[key], referralJSON(r))
	}
	sort.Strings(order)
	groups := make([]map[string]any, 0, len(order))
	for _, key := range order {
		g := map[string]any{"referrals": byCons[key], "referral_count": len(byCons[key])}
		if key != "" {
			var cid pgtype.UUID
			_ = cid.Scan(key)
			if c, err := s.q().GetConsultationByID(ctx, cid); err == nil {
				g["consultation"] = consultationBase(c)
			}
		}
		groups = append(groups, g)
	}
	return groups, nil
}

func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}
