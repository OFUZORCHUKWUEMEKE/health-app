/**
 * Every domain event name in the app, in one place.
 *
 * Naming is `<aggregate>.<past-tense-verb>`. Matching is EXACT: `EventEmitterModule.forRoot()`
 * is called with no options in src/app.module.ts, so `wildcard` is false and the dots are
 * plain characters, not separators. `appointment.*` will not match anything — enabling
 * wildcards is a global switch that changes matching semantics for every listener, so
 * design for exact names.
 *
 * These constants live under `common/` so a domain service can import an event name without
 * importing anything the notifications module owns. That is what keeps the dependency graph
 * acyclic: Bookings/Consultations/Video → common/events ← Notifications.
 */
export const AppEvents = {
    APPOINTMENT_CREATED: 'appointment.created',
    APPOINTMENT_CONFIRMED: 'appointment.confirmed',
    APPOINTMENT_CANCELLED: 'appointment.cancelled',
    APPOINTMENT_RESCHEDULED: 'appointment.rescheduled',
    APPOINTMENT_REMINDER_DUE: 'appointment.reminder_due',

    // NOTE: there is deliberately no `consultation.started`. "Doctor has joined the
    // consultation" is served by `video.room_opened`, which is the moment the patient can
    // actually act on. An event with no listener is dead contract.
    CONSULTATION_COMPLETED: 'consultation.completed',
    CONSULTATION_MEDICATIONS_ASSIGNED: 'consultation.medications_assigned',
    CONSULTATION_REFERRAL_ASSIGNED: 'consultation.referral_assigned',
    CONSULTATION_INVESTIGATIONS_REQUESTED: 'consultation.investigations_requested',
    CONSULTATION_INVESTIGATION_RESULTS_UPLOADED:
        'consultation.investigation_results_uploaded',

    VIDEO_ROOM_OPENED: 'video.room_opened',
} as const;

export type AppEventName = (typeof AppEvents)[keyof typeof AppEvents];
