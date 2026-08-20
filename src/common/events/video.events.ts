/**
 * Video event payloads.
 *
 * Only ONE video event exists, and that is deliberate. `getDoctorVideoToken` is polled by
 * the doctor's client, and `markSessionStarted`/`markSessionEnded` are client-self-reported,
 * so most video moments are either repeated or unreliable. The room-opened moment is the one
 * with real value: it is what currently forces the patient to sit on a retry loop against
 * "Doctor hasn't opened the session yet. Please wait."
 *
 * The emit site must gate on room CREATION, not on the endpoint being called — see the
 * `roomExisted` check in video.service.ts.
 */
export interface VideoRoomOpenedEvent {
    appointment_id: string;
    consultation_id: string | null;
    patient_id: string;
    doctor_id: string;
    scheduled_start_at_utc: string | null;
    timezone_snapshot: string | null;
}
