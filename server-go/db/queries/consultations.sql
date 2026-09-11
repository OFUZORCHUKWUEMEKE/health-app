-- Consultation lifecycle + history reads (Milestone 13). Stage writes land
-- in Milestone 14; reads here already project stage rows for history views.

-- name: GetConsultationByID :one
SELECT * FROM consultations WHERE id = $1;

-- name: GetConsultationsByIDs :many
SELECT * FROM consultations WHERE id = ANY($1::uuid[]);

-- name: CreateConsultation :one
INSERT INTO consultations (
    appointment_id, reference, type, patient_id, doctor_id, consoltation_for,
    title, details, session_number, parent_consultation_id, treatment_plan,
    status, meta
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- name: UpdateConsultationStatus :one
UPDATE consultations SET status = $2, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: UpdateConsultationWorkspace :one
UPDATE consultations SET status = 'ACTIVE', doctor_id = $2, patient_id = $3,
    title = COALESCE($4, title), details = COALESCE($5, details),
    treatment_plan = COALESCE($6, treatment_plan), updated_at = now()
WHERE id = $1 RETURNING *;

-- name: ListPatientConsultations :many
SELECT * FROM consultations
WHERE patient_id = $1
ORDER BY created_at DESC LIMIT $2 OFFSET $3;

-- name: CountPatientConsultations :one
SELECT count(*) FROM consultations WHERE patient_id = $1;

-- name: ListDoctorConsultations :many
SELECT * FROM consultations
WHERE doctor_id = $1
ORDER BY created_at DESC LIMIT $2 OFFSET $3;

-- name: CountDoctorConsultations :one
SELECT count(*) FROM consultations WHERE doctor_id = $1;

-- name: RecentConsultations :many
SELECT * FROM consultations
WHERE (( $1::uuid IS NULL OR patient_id = $1) AND ($2::uuid IS NULL OR doctor_id = $2))
  AND created_at >= $3 AND created_at < $4
ORDER BY created_at DESC;

-- name: PatientHistoryConsultations :many
SELECT * FROM consultations WHERE patient_id = $1 ORDER BY created_at DESC;

-- name: HistoryConsultationsLimit5 :many
SELECT * FROM consultations WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 5;

-- name: MedicationsByConsultation :many
SELECT * FROM medications WHERE consultation_id = $1 ORDER BY created_at DESC;

-- name: MedicationsByConsultations :many
SELECT * FROM medications WHERE consultation_id = ANY($1::uuid[]) ORDER BY created_at DESC;

-- name: MedicationsByPatient :many
SELECT * FROM medications
WHERE patient_id = $1
  AND ($2 = '' OR medication ILIKE '%' || $2 || '%')
ORDER BY created_at DESC LIMIT $3 OFFSET $4;

-- name: ActiveMedicationsByPatient :many
SELECT * FROM medications
WHERE patient_id = $1 AND status = 'ACTIVE'
ORDER BY created_at DESC LIMIT $2 OFFSET $3;

-- name: GetMedicationByID :one
SELECT * FROM medications WHERE id = $1;

-- name: MedicationConsultationIDs :many
SELECT DISTINCT consultation_id FROM medications WHERE patient_id = $1;

-- name: MedsGroupedByFormulary :many
SELECT formulary, count(*) AS count FROM medications
WHERE consultation_id = $1 GROUP BY formulary ORDER BY formulary;

-- name: InvestigationListsByConsultation :many
SELECT * FROM investigation_lists WHERE consultation_id = $1 ORDER BY created_at DESC;

-- name: InvestigationListsByConsultations :many
SELECT * FROM investigation_lists WHERE consultation_id = ANY($1::uuid[]) ORDER BY created_at DESC;

-- name: AssignedInvestigationLists :many
SELECT * FROM investigation_lists
WHERE patient_id = $1 AND assign_to_patient = true
ORDER BY created_at DESC LIMIT $2 OFFSET $3;

-- name: AssignedInvestigationConsultationIDs :many
SELECT DISTINCT consultation_id FROM investigation_lists
WHERE patient_id = $1 AND assign_to_patient = true;

-- name: DiagnosesByConsultation :many
SELECT * FROM diagnoses WHERE consultation_id = $1 ORDER BY created_at DESC;

-- name: DiagnosisFormsByPatient :many
SELECT * FROM diagnosis_forms
WHERE patient_id = $1 ORDER BY created_at DESC LIMIT $2;

-- name: ReferralsByConsultation :many
SELECT * FROM referrals WHERE consultation_id = $1 ORDER BY created_at DESC;

-- name: ReferralsByConsultations :many
SELECT * FROM referrals WHERE consultation_id = ANY($1::uuid[]) ORDER BY created_at DESC;

-- name: ReferralsByPatient :many
SELECT * FROM referrals
WHERE patient_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3;

-- name: GetReferralByID :one
SELECT * FROM referrals WHERE id = $1;

-- name: GetHistoryTaking :one
SELECT * FROM history_takings WHERE consultation_id = $1;

-- name: GetPhysicalExam :one
SELECT * FROM physical_exams WHERE consultation_id = $1;

-- name: GetInvestigationResult :one
SELECT * FROM investigation_results WHERE consultation_id = $1;

-- name: GetTreatmentPlan :one
SELECT * FROM treatment_plans WHERE consultation_id = $1;

-- name: GetDiagnosisForm :one
SELECT * FROM diagnosis_forms WHERE consultation_id = $1;

-- name: GetPatientsByIDs :many
SELECT * FROM patients WHERE id = ANY($1::uuid[]);
