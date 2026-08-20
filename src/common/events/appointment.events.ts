import { AppointmentStatus, Role } from '../enums';

/**
 * Appointment event payloads.
 *
 * Two rules hold across every payload here:
 *
 *  - **Ids are strings, never ObjectId and never a Mongoose document.** Passing a hydrated
 *    document would couple listeners to whatever the emit site happened to have loaded, and
 *    would keep it alive on the heap for the duration of the handler. Listeners re-read what
 *    they need with an explicit projection.
 *  - **Only facts the emit site already holds.** No payload field should require an extra
 *    query at the emit site — that would put notification cost on the request path.
 */

export interface AppointmentCreatedEvent {
    appointment_id: string;
    appointment_number?: string;
    patient_id: string;
    /** Null on an auto-match booking that found no doctor and is awaiting assignment. */
    doctor_id: string | null;
    scheduled_start_at_utc: string;
    scheduled_end_at_utc?: string;
    timezone_snapshot: string;
    /**
     * PENDING means the doctor must still accept — the doctor gets "new request" and the
     * patient gets "request sent". CONFIRMED (auto-match) means both sides are booked.
     */
    status: AppointmentStatus;
}

export interface AppointmentConfirmedEvent {
    appointment_id: string;
    patient_id: string;
    doctor_id: string;
    scheduled_start_at_utc: string;
    timezone_snapshot: string;
    actor_role: Role;
}

export interface AppointmentCancelledEvent {
    appointment_id: string;
    patient_id: string;
    doctor_id: string | null;
    scheduled_start_at_utc: string;
    timezone_snapshot: string;
    /** Drives who gets told: a patient cancelling notifies the doctor, and vice versa. */
    cancelled_by: Role;
    cancelled_reason?: string | null;
}

export interface AppointmentRescheduledEvent {
    old_appointment_id: string;
    new_appointment_id: string;
    patient_id: string;
    previous_doctor_id: string | null;
    new_doctor_id: string | null;
    old_start_at_utc: string;
    new_start_at_utc: string;
    timezone_snapshot: string;
    actor_role: Role;
    reason?: string | null;
    /** True when auto-match reassigned the booking to a different doctor. */
    fallback_used?: boolean;
}

export interface AppointmentReminderDueEvent {
    appointment_id: string;
    patient_id: string;
    doctor_id: string | null;
    scheduled_start_at_utc: string;
    timezone_snapshot: string;
    /**
     * The REAL remaining minutes, not the nominal offset. After an outage the scheduler
     * catches up late, so a "1 hour" reminder may genuinely be 47 minutes out — copy must
     * render this value rather than hardcoding the offset.
     */
    minutes_until_start: number;
    /** Which configured offset produced this, e.g. 1440 or 60. */
    offset_minutes: number;
}
