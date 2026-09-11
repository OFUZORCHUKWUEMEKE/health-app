-- Clinical stage writes + grouped reads (Milestone 14). Reads used by M13
-- history live in consultations.sql; everything here is stage CRUD plus
-- doctor-scoped grouping.

-- name: CreateCompliantHistory :one
INSERT INTO complaint_histories (
    consultation_id, patient_id, doctor_id, past_medical_history,
    medication, allergy, family, travel, occupation, social
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;

-- name: CompliantHistoriesByConsultation :many
SELECT * FROM complaint_histories WHERE consultation_id = $1 ORDER BY created_at DESC;

-- name: DeleteCompliantHistory :execrows
DELETE FROM complaint_histories WHERE id = $1;

-- name: CreateHistoryTaking :one
INSERT INTO history_takings (
    consultation_id, patient_id, doctor_id, present_complaint,
    history_of_presenting_complaint, past_medical_surgical_history,
    medication_history, allergy_history, family_history, travel_history,
    occupation, social_history, obstetric_gynaecological_history, others, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
RETURNING *;

-- name: UpdateHistoryTaking :one
UPDATE history_takings SET
    present_complaint = COALESCE($2, present_complaint),
    history_of_presenting_complaint = COALESCE($3, history_of_presenting_complaint),
    past_medical_surgical_history = COALESCE($4, past_medical_surgical_history),
    medication_history = COALESCE($5, medication_history),
    allergy_history = COALESCE($6, allergy_history),
    family_history = COALESCE($7, family_history),
    travel_history = COALESCE($8, travel_history),
    occupation = COALESCE($9, occupation),
    social_history = COALESCE($10, social_history),
    obstetric_gynaecological_history = COALESCE($11, obstetric_gynaecological_history),
    others = COALESCE($12, others),
    status = COALESCE($13, status),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: DeleteHistoryTaking :execrows
DELETE FROM history_takings WHERE id = $1;

-- name: CreatePhysicalExam :one
INSERT INTO physical_exams (
    consultation_id, patient_id, doctor_id, general_physical, nervous_system,
    respiratory_system, cardiovascular_system, gastrointestinal_system,
    genitourinary_system, musculoskeletal_system, ent,
    obstetric_gynaecological, others, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING *;

-- name: UpdatePhysicalExam :one
UPDATE physical_exams SET
    general_physical = COALESCE($2, general_physical),
    nervous_system = COALESCE($3, nervous_system),
    respiratory_system = COALESCE($4, respiratory_system),
    cardiovascular_system = COALESCE($5, cardiovascular_system),
    gastrointestinal_system = COALESCE($6, gastrointestinal_system),
    genitourinary_system = COALESCE($7, genitourinary_system),
    musculoskeletal_system = COALESCE($8, musculoskeletal_system),
    ent = COALESCE($9, ent),
    obstetric_gynaecological = COALESCE($10, obstetric_gynaecological),
    others = COALESCE($11, others),
    status = COALESCE($12, status),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: DeletePhysicalExam :execrows
DELETE FROM physical_exams WHERE id = $1;

-- name: CreateInvestigationResult :one
INSERT INTO investigation_results (
    consultation_id, patient_id, doctor_id, blood_test, microbiology,
    radiology, cardiovascular, procedures, others, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;

-- name: UpdateInvestigationResult :one
UPDATE investigation_results SET
    blood_test = COALESCE($2, blood_test),
    microbiology = COALESCE($3, microbiology),
    radiology = COALESCE($4, radiology),
    cardiovascular = COALESCE($5, cardiovascular),
    procedures = COALESCE($6, procedures),
    others = COALESCE($7, others),
    status = COALESCE($8, status),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: DeleteInvestigationResult :execrows
DELETE FROM investigation_results WHERE id = $1;

-- name: CreateTreatmentPlan :one
INSERT INTO treatment_plans (
    consultation_id, patient_id, doctor_id, treatment_plan_details, status
) VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: UpdateTreatmentPlan :one
UPDATE treatment_plans SET
    treatment_plan_details = COALESCE($2, treatment_plan_details),
    status = COALESCE($3, status),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: DeleteTreatmentPlan :execrows
DELETE FROM treatment_plans WHERE id = $1;

-- name: CreateDiagnosisForm :one
INSERT INTO diagnosis_forms (
    consultation_id, patient_id, doctor_id, provisional_diagnosis,
    final_diagnosis, status
) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: UpdateDiagnosisForm :one
UPDATE diagnosis_forms SET
    provisional_diagnosis = COALESCE($2, provisional_diagnosis),
    final_diagnosis = COALESCE($3, final_diagnosis),
    status = COALESCE($4, status),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: DeleteDiagnosisForm :execrows
DELETE FROM diagnosis_forms WHERE id = $1;

-- name: CreateMedication :one
INSERT INTO medications (
    consultation_id, patient_id, doctor_id, formulary, medication, dose,
    unit, interval, duration, duration_unit, order_instruction, start_date,
    assign_to_patient, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING *;

-- name: UpdateMedication :one
UPDATE medications SET
    formulary = COALESCE($2, formulary),
    medication = COALESCE($3, medication),
    dose = COALESCE($4, dose),
    unit = COALESCE($5, unit),
    interval = COALESCE($6, interval),
    duration = COALESCE($7, duration),
    duration_unit = COALESCE($8, duration_unit),
    order_instruction = COALESCE($9, order_instruction),
    start_date = COALESCE($10, start_date),
    assign_to_patient = COALESCE($11, assign_to_patient),
    status = COALESCE($12, status),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: DeleteMedication :execrows
DELETE FROM medications WHERE id = $1;

-- name: DoctorMedicationConsultationIDs :many
SELECT m.consultation_id FROM medications m
JOIN consultations c ON c.id = m.consultation_id
WHERE m.doctor_id = $1 GROUP BY m.consultation_id ORDER BY max(c.created_at) DESC;

-- name: CreateInvestigationListItem :one
INSERT INTO investigation_lists (
    consultation_id, patient_id, doctor_id, name, category, test_requested,
    priority, specimen, assign_to_patient, result_images
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;

-- name: GetInvestigationList :one
SELECT * FROM investigation_lists WHERE id = $1;

-- name: PendingInvestigationLists :many
SELECT * FROM investigation_lists
WHERE consultation_id = $1 AND assign_to_patient = false;

-- name: UpdateInvestigationList :one
UPDATE investigation_lists SET
    name = COALESCE($2, name),
    category = COALESCE($3, category),
    test_requested = COALESCE($4, test_requested),
    priority = COALESCE($5, priority),
    specimen = COALESCE($6, specimen),
    assign_to_patient = COALESCE($7, assign_to_patient),
    result_images = COALESCE($8, result_images),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: DeleteInvestigationList :execrows
DELETE FROM investigation_lists WHERE id = $1;

-- name: AppendInvestigationImages :one
UPDATE investigation_lists SET
    result_images = array_cat(result_images, $2),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: DoctorInvestigationConsultationIDs :many
SELECT l.consultation_id FROM investigation_lists l
JOIN consultations c ON c.id = l.consultation_id
WHERE l.doctor_id = $1 GROUP BY l.consultation_id ORDER BY max(c.created_at) DESC;

-- name: CreateReferral :one
INSERT INTO referrals (
    consultation_id, patient_id, doctor_id, referred_doctor_name,
    specialist_name, specialty, hospital, hospital_address,
    attachment_investigation_ids, referral_details, assign_to_patient
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;

-- name: UpdateReferral :one
UPDATE referrals SET
    referred_doctor_name = COALESCE($2, referred_doctor_name),
    specialist_name = COALESCE($3, specialist_name),
    specialty = COALESCE($4, specialty),
    hospital = COALESCE($5, hospital),
    hospital_address = COALESCE($6, hospital_address),
    attachment_investigation_ids = COALESCE($7, attachment_investigation_ids),
    referral_details = COALESCE($8, referral_details),
    assign_to_patient = COALESCE($9, assign_to_patient),
    updated_at = now()
WHERE id = $1 RETURNING *;

-- name: DeleteReferral :execrows
DELETE FROM referrals WHERE id = $1;

-- name: DoctorReferralConsultationIDs :many
SELECT r.consultation_id FROM referrals r
JOIN consultations c ON c.id = r.consultation_id
WHERE r.doctor_id = $1 GROUP BY r.consultation_id ORDER BY max(c.created_at) DESC;

-- name: HistoryTakingByID :one
SELECT * FROM history_takings WHERE id = $1;

-- name: PhysicalExamByID :one
SELECT * FROM physical_exams WHERE id = $1;

-- name: InvestigationResultByID :one
SELECT * FROM investigation_results WHERE id = $1;

-- name: TreatmentPlanByID :one
SELECT * FROM treatment_plans WHERE id = $1;

-- name: DiagnosisFormByID :one
SELECT * FROM diagnosis_forms WHERE id = $1;
