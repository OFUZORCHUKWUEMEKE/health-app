/**
 * Consultation event payloads. Same rules as appointment.events.ts: string ids only, and
 * only facts the emit site already holds.
 *
 * Note the clinical events carry COUNTS and IDS, never clinical free text. A notification
 * body is intended to feed email and push later, so test names, drug names, diagnoses and
 * referral reasons must not travel in these payloads — the patient opens the app to see
 * detail. See the PHI risk in the plan.
 */

export interface ConsultationCompletedEvent {
    consultation_id: string;
    appointment_id: string | null;
    patient_id: string;
    doctor_id: string;
}

/**
 * `createMedication` creates N medications in one call via Promise.all. This is emitted
 * ONCE with all the ids rather than once per medication — otherwise prescribing four drugs
 * produces four notifications for one clinical action.
 *
 * Only emitted when at least one medication has `assign_to_patient === true`; ids listed
 * here are the patient-visible subset only.
 */
export interface ConsultationMedicationsAssignedEvent {
    consultation_id: string;
    patient_id: string;
    doctor_id: string;
    medication_ids: string[];
    count: number;
}

/** Only emitted when `assign_to_patient === true`. */
export interface ConsultationReferralAssignedEvent {
    consultation_id: string;
    patient_id: string;
    doctor_id: string;
    referral_id: string;
}

/** Only emitted when `assign_to_patient === true`. One event for the whole batch. */
export interface ConsultationInvestigationsRequestedEvent {
    consultation_id: string;
    patient_id: string;
    doctor_id: string;
    investigation_list_ids: string[];
    count: number;
}

/** The one patient → doctor direction: the patient uploaded result images. */
export interface ConsultationInvestigationResultsUploadedEvent {
    consultation_id: string | null;
    investigation_list_id: string;
    patient_id: string;
    doctor_id: string;
    image_count: number;
}
