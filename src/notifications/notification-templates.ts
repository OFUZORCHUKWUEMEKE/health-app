import {
    NotificationCategory,
    NotificationRecipientType,
    NotificationType,
} from 'src/common/enums';
import { formatZoned } from 'src/common/utils/timezone.util';
import { NotificationSpec } from './notifications.service';

/**
 * Notification copy. Pure functions — no DI, no I/O — so they are cheap to test
 * exhaustively, which matters because this is where the PHI rule is enforced.
 *
 * THE PHI RULE: title and body carry names, times and counts ONLY. Never a drug name, test
 * name, diagnosis, or referral reason. This text is stored and is explicitly intended to
 * feed email and push later, so anything written here should be assumed to leave the system
 * and land on a lock screen. Detail lives behind the deep link, inside the authenticated app.
 *
 * Icons are deliberately absent: the client maps `type` to 🩺/💊/📅. Keeping presentation
 * out of the database means restyling never needs a migration, and stored text stays clean.
 */

/** A person's display name, degrading gracefully rather than rendering "undefined". */
export function personName(
    person: { first_name?: string; last_name?: string; full_name?: string } | null | undefined,
    fallback: string,
): string {
    if (!person) return fallback;
    const composed = [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
    return composed || person.full_name?.trim() || fallback;
}

export function doctorName(
    doctor: { first_name?: string; last_name?: string; full_name?: string } | null | undefined,
): string {
    const name = personName(doctor, '');
    return name ? `Dr ${name}` : 'your doctor';
}

/**
 * Render an appointment time in the RECIPIENT's own zone, falling back to the timezone the
 * appointment was booked in. A doctor in Lagos and a patient in London must each see their
 * own wall clock for the same instant.
 */
export function appointmentWhen(
    startUtcIso: string,
    recipientTimezone?: string | null,
    timezoneSnapshot?: string | null,
): string {
    return formatZoned(new Date(startUtcIso), recipientTimezone || timezoneSnapshot);
}

/** Deterministic dedupe key. See the event_key comment on the Notification model. */
export function eventKey(
    kind: string,
    subjectId: string,
    recipientType: NotificationRecipientType,
    recipientId: string,
): string {
    return `${kind}:${subjectId}:${recipientType}:${recipientId}`;
}

type Base = Pick<
    NotificationSpec,
    'appointment_id' | 'consultation_id' | 'actor_id' | 'actor_type' | 'deep_link' | 'data'
>;

// ─── Appointments ───────────────────────────────────────

export function patientAppointmentBooked(args: {
    patient_id: string;
    appointment_id: string;
    doctor: any;
    doctor_id: string | null;
    when: string;
    pending: boolean;
    data: Record<string, unknown>;
}): NotificationSpec {
    const base: Base = {
        appointment_id: args.appointment_id,
        actor_id: args.doctor_id,
        actor_type: args.doctor_id ? NotificationRecipientType.DOCTOR : null,
        deep_link: `/appointments/${args.appointment_id}`,
        data: args.data,
    };

    return {
        ...base,
        recipient_id: args.patient_id,
        recipient_type: NotificationRecipientType.PATIENT,
        type: NotificationType.APPOINTMENT_BOOKED,
        category: NotificationCategory.APPOINTMENT,
        title: args.pending ? 'Appointment request sent' : 'Appointment booked',
        body: args.pending
            ? `Your request for ${args.when} is awaiting confirmation.`
            : `Your appointment with ${doctorName(args.doctor)} is booked for ${args.when}.`,
        event_key: eventKey(
            'appointment_booked',
            args.appointment_id,
            NotificationRecipientType.PATIENT,
            args.patient_id,
        ),
    };
}

export function doctorAppointmentRequest(args: {
    doctor_id: string;
    patient_id: string;
    appointment_id: string;
    patient: any;
    when: string;
    pending: boolean;
    data: Record<string, unknown>;
}): NotificationSpec {
    return {
        recipient_id: args.doctor_id,
        recipient_type: NotificationRecipientType.DOCTOR,
        type: args.pending
            ? NotificationType.APPOINTMENT_REQUEST_RECEIVED
            : NotificationType.APPOINTMENT_BOOKED,
        category: NotificationCategory.APPOINTMENT,
        title: args.pending ? 'New consultation request' : 'New appointment booked',
        body: `${personName(args.patient, 'A patient')} — ${args.when}.`,
        appointment_id: args.appointment_id,
        actor_id: args.patient_id,
        actor_type: NotificationRecipientType.PATIENT,
        deep_link: `/appointments/${args.appointment_id}`,
        data: args.data,
        event_key: eventKey(
            'appointment_booked',
            args.appointment_id,
            NotificationRecipientType.DOCTOR,
            args.doctor_id,
        ),
    };
}

export function patientAppointmentConfirmed(args: {
    patient_id: string;
    appointment_id: string;
    doctor: any;
    doctor_id: string;
    when: string;
    data: Record<string, unknown>;
}): NotificationSpec {
    return {
        recipient_id: args.patient_id,
        recipient_type: NotificationRecipientType.PATIENT,
        type: NotificationType.APPOINTMENT_CONFIRMED,
        category: NotificationCategory.APPOINTMENT,
        title: 'Appointment confirmed',
        body: `${doctorName(args.doctor)} confirmed your appointment for ${args.when}.`,
        appointment_id: args.appointment_id,
        actor_id: args.doctor_id,
        actor_type: NotificationRecipientType.DOCTOR,
        deep_link: `/appointments/${args.appointment_id}`,
        data: args.data,
        event_key: eventKey(
            'appointment_confirmed',
            args.appointment_id,
            NotificationRecipientType.PATIENT,
            args.patient_id,
        ),
    };
}

/**
 * Cancellation always notifies the OTHER party — telling someone they cancelled their own
 * appointment is noise. The caller decides who that is from `cancelled_by`.
 */
export function appointmentCancelled(args: {
    recipient_id: string;
    recipient_type: NotificationRecipientType;
    appointment_id: string;
    actor: any;
    actor_id: string | null;
    actor_type: NotificationRecipientType;
    when: string;
    reason?: string | null;
    data: Record<string, unknown>;
}): NotificationSpec {
    const who =
        args.actor_type === NotificationRecipientType.DOCTOR
            ? doctorName(args.actor)
            : personName(args.actor, 'The patient');

    return {
        recipient_id: args.recipient_id,
        recipient_type: args.recipient_type,
        type: NotificationType.APPOINTMENT_CANCELLED,
        category: NotificationCategory.APPOINTMENT,
        title: 'Appointment cancelled',
        body: `${who} cancelled the appointment scheduled for ${args.when}.`,
        appointment_id: args.appointment_id,
        actor_id: args.actor_id,
        actor_type: args.actor_type,
        deep_link: `/appointments/${args.appointment_id}`,
        data: args.data,
        event_key: eventKey(
            'appointment_cancelled',
            args.appointment_id,
            args.recipient_type,
            args.recipient_id,
        ),
    };
}

export function appointmentRescheduled(args: {
    recipient_id: string;
    recipient_type: NotificationRecipientType;
    new_appointment_id: string;
    actor: any;
    actor_id: string | null;
    actor_type: NotificationRecipientType;
    new_when: string;
    data: Record<string, unknown>;
}): NotificationSpec {
    const who =
        args.actor_type === NotificationRecipientType.DOCTOR
            ? doctorName(args.actor)
            : personName(args.actor, 'The patient');

    return {
        recipient_id: args.recipient_id,
        recipient_type: args.recipient_type,
        type: NotificationType.APPOINTMENT_RESCHEDULED,
        category: NotificationCategory.APPOINTMENT,
        title: 'Appointment rescheduled',
        body: `${who} moved the appointment to ${args.new_when}.`,
        appointment_id: args.new_appointment_id,
        actor_id: args.actor_id,
        actor_type: args.actor_type,
        deep_link: `/appointments/${args.new_appointment_id}`,
        data: args.data,
        event_key: eventKey(
            'appointment_rescheduled',
            args.new_appointment_id,
            args.recipient_type,
            args.recipient_id,
        ),
    };
}

/** A reschedule that auto-matched to a different doctor removes it from the old one's list. */
export function doctorAppointmentRemoved(args: {
    doctor_id: string;
    old_appointment_id: string;
    when: string;
    data: Record<string, unknown>;
}): NotificationSpec {
    return {
        recipient_id: args.doctor_id,
        recipient_type: NotificationRecipientType.DOCTOR,
        type: NotificationType.APPOINTMENT_REMOVED,
        category: NotificationCategory.APPOINTMENT,
        title: 'Appointment removed from your schedule',
        body: `The appointment for ${args.when} was rescheduled to another doctor.`,
        appointment_id: args.old_appointment_id,
        deep_link: `/appointments/${args.old_appointment_id}`,
        data: args.data,
        event_key: eventKey(
            'appointment_removed',
            args.old_appointment_id,
            NotificationRecipientType.DOCTOR,
            args.doctor_id,
        ),
    };
}

export function doctorAppointmentAssigned(args: {
    doctor_id: string;
    new_appointment_id: string;
    patient: any;
    patient_id: string;
    when: string;
    data: Record<string, unknown>;
}): NotificationSpec {
    return {
        recipient_id: args.doctor_id,
        recipient_type: NotificationRecipientType.DOCTOR,
        type: NotificationType.APPOINTMENT_REASSIGNED,
        category: NotificationCategory.APPOINTMENT,
        title: 'Appointment added to your schedule',
        body: `${personName(args.patient, 'A patient')} — ${args.when}.`,
        appointment_id: args.new_appointment_id,
        actor_id: args.patient_id,
        actor_type: NotificationRecipientType.PATIENT,
        deep_link: `/appointments/${args.new_appointment_id}`,
        data: args.data,
        event_key: eventKey(
            'appointment_assigned',
            args.new_appointment_id,
            NotificationRecipientType.DOCTOR,
            args.doctor_id,
        ),
    };
}

// ─── Reminders ──────────────────────────────────────────

/**
 * `minutes_until_start` is the REAL remaining time, not the nominal offset. After an outage
 * the scheduler catches up late, so a "1 hour" reminder can genuinely be 47 minutes out —
 * rendering the offset would be a lie. `offset_minutes` only picks the type and the key.
 */
export function appointmentReminder(args: {
    recipient_id: string;
    recipient_type: NotificationRecipientType;
    appointment_id: string;
    counterparty: any;
    when: string;
    minutes_until_start: number;
    offset_minutes: number;
    data: Record<string, unknown>;
}): NotificationSpec {
    const isDoctor = args.recipient_type === NotificationRecipientType.DOCTOR;
    const who = isDoctor
        ? personName(args.counterparty, 'a patient')
        : doctorName(args.counterparty);

    return {
        recipient_id: args.recipient_id,
        recipient_type: args.recipient_type,
        type:
            args.offset_minutes >= 1440
                ? NotificationType.APPOINTMENT_REMINDER_24H
                : NotificationType.APPOINTMENT_REMINDER_1H,
        category: NotificationCategory.REMINDER,
        title: isDoctor ? 'Upcoming appointment' : 'Appointment reminder',
        body: `You have a consultation with ${who} on ${args.when} (${humanizeMinutes(
            args.minutes_until_start,
        )}).`,
        appointment_id: args.appointment_id,
        deep_link: `/appointments/${args.appointment_id}`,
        data: args.data,
        event_key: eventKey(
            `appointment_reminder_${args.offset_minutes}m`,
            args.appointment_id,
            args.recipient_type,
            args.recipient_id,
        ),
    };
}

// ─── Consultations & clinical ───────────────────────────

export function consultationSummaryAvailable(args: {
    patient_id: string;
    consultation_id: string;
    appointment_id: string | null;
    doctor: any;
    doctor_id: string;
    data: Record<string, unknown>;
}): NotificationSpec {
    return {
        recipient_id: args.patient_id,
        recipient_type: NotificationRecipientType.PATIENT,
        type: NotificationType.CONSULTATION_SUMMARY_AVAILABLE,
        category: NotificationCategory.CONSULTATION,
        title: 'Consultation summary available',
        body: `Your consultation with ${doctorName(args.doctor)} is complete. The summary is ready to view.`,
        consultation_id: args.consultation_id,
        appointment_id: args.appointment_id,
        actor_id: args.doctor_id,
        actor_type: NotificationRecipientType.DOCTOR,
        deep_link: `/consultations/${args.consultation_id}`,
        data: args.data,
        event_key: eventKey(
            'consultation_summary',
            args.consultation_id,
            NotificationRecipientType.PATIENT,
            args.patient_id,
        ),
    };
}

/**
 * Counts, never names. "3 investigations" not "FBC, U&E, LFT" — this text is stored and is
 * intended to feed email and push later, so it must be safe on a lock screen.
 */
export function investigationsRequested(args: {
    patient_id: string;
    consultation_id: string;
    doctor: any;
    doctor_id: string;
    count: number;
    data: Record<string, unknown>;
}): NotificationSpec {
    const plural = args.count === 1 ? 'test' : 'tests';
    return {
        recipient_id: args.patient_id,
        recipient_type: NotificationRecipientType.PATIENT,
        type: NotificationType.INVESTIGATIONS_REQUESTED,
        category: NotificationCategory.CLINICAL,
        title: 'Investigations requested',
        body: `${doctorName(args.doctor)} requested ${args.count} ${plural}. Tap to view and upload your results.`,
        consultation_id: args.consultation_id,
        actor_id: args.doctor_id,
        actor_type: NotificationRecipientType.DOCTOR,
        deep_link: `/consultations/${args.consultation_id}/investigations`,
        data: args.data,
        // Keyed on the consultation plus the batch size so a second, larger batch on the
        // same consultation still notifies, while a retry of the same request dedupes.
        event_key: eventKey(
            `consultation_investigations_${args.count}`,
            args.consultation_id,
            NotificationRecipientType.PATIENT,
            args.patient_id,
        ),
    };
}

export function prescriptionReady(args: {
    patient_id: string;
    consultation_id: string;
    doctor: any;
    doctor_id: string;
    count: number;
    data: Record<string, unknown>;
}): NotificationSpec {
    const plural = args.count === 1 ? 'medication' : 'medications';
    return {
        recipient_id: args.patient_id,
        recipient_type: NotificationRecipientType.PATIENT,
        type: NotificationType.PRESCRIPTION_READY,
        category: NotificationCategory.CLINICAL,
        title: 'Prescription ready',
        body: `${doctorName(args.doctor)} prescribed ${args.count} ${plural}. Your prescription form is available.`,
        consultation_id: args.consultation_id,
        actor_id: args.doctor_id,
        actor_type: NotificationRecipientType.DOCTOR,
        deep_link: `/consultations/${args.consultation_id}/medications`,
        data: args.data,
        event_key: eventKey(
            `consultation_meds_${args.count}`,
            args.consultation_id,
            NotificationRecipientType.PATIENT,
            args.patient_id,
        ),
    };
}

export function referralAvailable(args: {
    patient_id: string;
    consultation_id: string;
    referral_id: string;
    doctor: any;
    doctor_id: string;
    data: Record<string, unknown>;
}): NotificationSpec {
    return {
        recipient_id: args.patient_id,
        recipient_type: NotificationRecipientType.PATIENT,
        type: NotificationType.REFERRAL_AVAILABLE,
        category: NotificationCategory.CLINICAL,
        // No specialist name, hospital, or referral_details — those are clinical detail.
        title: 'Referral letter available',
        body: `${doctorName(args.doctor)} issued a referral letter. Tap to view it.`,
        consultation_id: args.consultation_id,
        actor_id: args.doctor_id,
        actor_type: NotificationRecipientType.DOCTOR,
        deep_link: `/referrals/${args.referral_id}`,
        data: args.data,
        event_key: eventKey(
            'referral',
            args.referral_id,
            NotificationRecipientType.PATIENT,
            args.patient_id,
        ),
    };
}

/** The patient → doctor direction. */
export function investigationResultsUploaded(args: {
    doctor_id: string;
    patient_id: string;
    patient: any;
    consultation_id: string | null;
    investigation_list_id: string;
    image_count: number;
    data: Record<string, unknown>;
}): NotificationSpec {
    const plural = args.image_count === 1 ? 'file' : 'files';
    return {
        recipient_id: args.doctor_id,
        recipient_type: NotificationRecipientType.DOCTOR,
        type: NotificationType.INVESTIGATION_RESULTS_UPLOADED,
        category: NotificationCategory.CLINICAL,
        title: 'New investigation result',
        body: `${personName(args.patient, 'A patient')} uploaded ${args.image_count} result ${plural}.`,
        consultation_id: args.consultation_id,
        actor_id: args.patient_id,
        actor_type: NotificationRecipientType.PATIENT,
        deep_link: `/investigations/${args.investigation_list_id}`,
        data: args.data,
        // Keyed with the running total, so each new upload notifies while a retry of the
        // same upload does not.
        event_key: eventKey(
            `investigation_results_${args.image_count}`,
            args.investigation_list_id,
            NotificationRecipientType.DOCTOR,
            args.doctor_id,
        ),
    };
}

// ─── Video ──────────────────────────────────────────────

export function videoRoomOpened(args: {
    patient_id: string;
    appointment_id: string;
    consultation_id: string | null;
    doctor: any;
    doctor_id: string;
    data: Record<string, unknown>;
}): NotificationSpec {
    return {
        recipient_id: args.patient_id,
        recipient_type: NotificationRecipientType.PATIENT,
        type: NotificationType.VIDEO_ROOM_OPENED,
        category: NotificationCategory.VIDEO,
        title: 'Your doctor is ready',
        body: `${doctorName(args.doctor)} has joined the consultation. Tap to join now.`,
        appointment_id: args.appointment_id,
        consultation_id: args.consultation_id,
        actor_id: args.doctor_id,
        actor_type: NotificationRecipientType.DOCTOR,
        deep_link: `/appointments/${args.appointment_id}/video`,
        data: args.data,
        event_key: eventKey(
            'video_room_opened',
            args.appointment_id,
            NotificationRecipientType.PATIENT,
            args.patient_id,
        ),
    };
}

export function humanizeMinutes(minutes: number): string {
    if (minutes <= 1) return 'in under a minute';
    if (minutes < 60) return `in ${minutes} minutes`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours === 1 ? 'in about an hour' : `in about ${hours} hours`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'tomorrow' : `in ${days} days`;
}
