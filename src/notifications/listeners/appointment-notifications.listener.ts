import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
    AppEvents,
    AppointmentCancelledEvent,
    AppointmentConfirmedEvent,
    AppointmentCreatedEvent,
    AppointmentReminderDueEvent,
    AppointmentRescheduledEvent,
} from 'src/common/events';
import { AppointmentStatus, NotificationRecipientType, Role } from 'src/common/enums';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { UserRepository } from 'src/users/user.repository';
import * as T from '../notification-templates';
import { NotificationSpec, NotificationsService } from '../notifications.service';

/**
 * Turns appointment events into notification rows.
 *
 * Handlers never throw out: @nestjs/event-emitter wraps every handler and defaults
 * `suppressErrors` to true, so a failure here is logged and the originating HTTP request is
 * untouched. Never register these with `{ suppressErrors: false }` — that would let a
 * notification bug fail a booking.
 *
 * Lookups are projected. Feeds are read far more often than written, but these run inline on
 * the emit tick, and the Render instance has a 384 MB heap — pulling whole documents to read
 * two name fields is waste that compounds under load.
 */
@Injectable()
export class AppointmentNotificationsListener {
    private readonly logger = new Logger(AppointmentNotificationsListener.name);

    private static readonly NAME_FIELDS = {
        first_name: 1,
        last_name: 1,
        full_name: 1,
        timezone: 1,
    };

    constructor(
        private readonly notificationsService: NotificationsService,
        private readonly userRepository: UserRepository,
        private readonly doctorRepository: DoctorRepository,
    ) { }

    @OnEvent(AppEvents.APPOINTMENT_CREATED)
    async onCreated(event: AppointmentCreatedEvent) {
        const { patient, doctor } = await this.resolveParties(
            event.patient_id,
            event.doctor_id,
        );

        // PENDING means the doctor still has to accept, so the wording differs on both
        // sides: the patient sees "request sent", the doctor sees "new request".
        const pending = event.status === AppointmentStatus.PENDING;
        const data = {
            scheduled_start_at_utc: event.scheduled_start_at_utc,
            appointment_number: event.appointment_number,
            status: event.status,
        };

        const specs: NotificationSpec[] = [
            T.patientAppointmentBooked({
                patient_id: event.patient_id,
                appointment_id: event.appointment_id,
                doctor,
                doctor_id: event.doctor_id,
                when: T.appointmentWhen(
                    event.scheduled_start_at_utc,
                    patient?.timezone,
                    event.timezone_snapshot,
                ),
                pending,
                data,
            }),
        ];

        // An auto-match booking can land with no doctor yet — nobody to tell.
        if (event.doctor_id) {
            specs.push(
                T.doctorAppointmentRequest({
                    doctor_id: event.doctor_id,
                    patient_id: event.patient_id,
                    appointment_id: event.appointment_id,
                    patient,
                    when: T.appointmentWhen(
                        event.scheduled_start_at_utc,
                        doctor?.timezone,
                        event.timezone_snapshot,
                    ),
                    pending,
                    data,
                }),
            );
        }

        await this.dispatch(specs, AppEvents.APPOINTMENT_CREATED);
    }

    @OnEvent(AppEvents.APPOINTMENT_CONFIRMED)
    async onConfirmed(event: AppointmentConfirmedEvent) {
        const { patient, doctor } = await this.resolveParties(
            event.patient_id,
            event.doctor_id,
        );

        await this.dispatch(
            [
                T.patientAppointmentConfirmed({
                    patient_id: event.patient_id,
                    appointment_id: event.appointment_id,
                    doctor,
                    doctor_id: event.doctor_id,
                    when: T.appointmentWhen(
                        event.scheduled_start_at_utc,
                        patient?.timezone,
                        event.timezone_snapshot,
                    ),
                    data: { scheduled_start_at_utc: event.scheduled_start_at_utc },
                }),
            ],
            AppEvents.APPOINTMENT_CONFIRMED,
        );
    }

    @OnEvent(AppEvents.APPOINTMENT_CANCELLED)
    async onCancelled(event: AppointmentCancelledEvent) {
        const { patient, doctor } = await this.resolveParties(
            event.patient_id,
            event.doctor_id,
        );

        // Notify the OTHER party only — telling someone they cancelled their own
        // appointment is noise.
        const cancelledByPatient = event.cancelled_by === Role.PATIENT;
        const data = {
            scheduled_start_at_utc: event.scheduled_start_at_utc,
            cancelled_by: event.cancelled_by,
        };

        const specs: NotificationSpec[] = [];

        if (cancelledByPatient) {
            if (event.doctor_id) {
                specs.push(
                    T.appointmentCancelled({
                        recipient_id: event.doctor_id,
                        recipient_type: NotificationRecipientType.DOCTOR,
                        appointment_id: event.appointment_id,
                        actor: patient,
                        actor_id: event.patient_id,
                        actor_type: NotificationRecipientType.PATIENT,
                        when: T.appointmentWhen(
                            event.scheduled_start_at_utc,
                            doctor?.timezone,
                            event.timezone_snapshot,
                        ),
                        reason: event.cancelled_reason,
                        data,
                    }),
                );
            }
        } else {
            specs.push(
                T.appointmentCancelled({
                    recipient_id: event.patient_id,
                    recipient_type: NotificationRecipientType.PATIENT,
                    appointment_id: event.appointment_id,
                    actor: doctor,
                    actor_id: event.doctor_id,
                    actor_type: NotificationRecipientType.DOCTOR,
                    when: T.appointmentWhen(
                        event.scheduled_start_at_utc,
                        patient?.timezone,
                        event.timezone_snapshot,
                    ),
                    reason: event.cancelled_reason,
                    data,
                }),
            );
        }

        await this.dispatch(specs, AppEvents.APPOINTMENT_CANCELLED);
    }

    @OnEvent(AppEvents.APPOINTMENT_RESCHEDULED)
    async onRescheduled(event: AppointmentRescheduledEvent) {
        const { patient, doctor } = await this.resolveParties(
            event.patient_id,
            event.new_doctor_id ?? event.previous_doctor_id,
        );

        const byPatient = event.actor_role === Role.PATIENT;
        const data = {
            old_start_at_utc: event.old_start_at_utc,
            new_start_at_utc: event.new_start_at_utc,
            fallback_used: event.fallback_used ?? false,
        };
        const specs: NotificationSpec[] = [];

        // The counterparty always hears about the move.
        if (byPatient) {
            if (event.new_doctor_id) {
                specs.push(
                    T.appointmentRescheduled({
                        recipient_id: event.new_doctor_id,
                        recipient_type: NotificationRecipientType.DOCTOR,
                        new_appointment_id: event.new_appointment_id,
                        actor: patient,
                        actor_id: event.patient_id,
                        actor_type: NotificationRecipientType.PATIENT,
                        new_when: T.appointmentWhen(
                            event.new_start_at_utc,
                            doctor?.timezone,
                            event.timezone_snapshot,
                        ),
                        data,
                    }),
                );
            }
        } else {
            specs.push(
                T.appointmentRescheduled({
                    recipient_id: event.patient_id,
                    recipient_type: NotificationRecipientType.PATIENT,
                    new_appointment_id: event.new_appointment_id,
                    actor: doctor,
                    actor_id: event.new_doctor_id ?? event.previous_doctor_id,
                    actor_type: NotificationRecipientType.DOCTOR,
                    new_when: T.appointmentWhen(
                        event.new_start_at_utc,
                        patient?.timezone,
                        event.timezone_snapshot,
                    ),
                    data,
                }),
            );
        }

        // When auto-match moved the booking to a different doctor, both doctors' schedules
        // changed — the old one loses it, the new one gains it. Neither would otherwise
        // find out.
        const reassigned =
            event.previous_doctor_id &&
            event.new_doctor_id &&
            event.previous_doctor_id !== event.new_doctor_id;

        if (reassigned) {
            specs.push(
                T.doctorAppointmentRemoved({
                    doctor_id: event.previous_doctor_id!,
                    old_appointment_id: event.old_appointment_id,
                    when: T.appointmentWhen(
                        event.old_start_at_utc,
                        null,
                        event.timezone_snapshot,
                    ),
                    data,
                }),
                T.doctorAppointmentAssigned({
                    doctor_id: event.new_doctor_id!,
                    new_appointment_id: event.new_appointment_id,
                    patient,
                    patient_id: event.patient_id,
                    when: T.appointmentWhen(
                        event.new_start_at_utc,
                        doctor?.timezone,
                        event.timezone_snapshot,
                    ),
                    data,
                }),
            );
        }

        await this.dispatch(specs, AppEvents.APPOINTMENT_RESCHEDULED);
    }

    @OnEvent(AppEvents.APPOINTMENT_REMINDER_DUE)
    async onReminderDue(event: AppointmentReminderDueEvent) {
        const { patient, doctor } = await this.resolveParties(
            event.patient_id,
            event.doctor_id,
        );

        const data = {
            scheduled_start_at_utc: event.scheduled_start_at_utc,
            minutes_until_start: event.minutes_until_start,
            offset_minutes: event.offset_minutes,
        };

        const specs: NotificationSpec[] = [
            T.appointmentReminder({
                recipient_id: event.patient_id,
                recipient_type: NotificationRecipientType.PATIENT,
                appointment_id: event.appointment_id,
                counterparty: doctor,
                when: T.appointmentWhen(
                    event.scheduled_start_at_utc,
                    patient?.timezone,
                    event.timezone_snapshot,
                ),
                minutes_until_start: event.minutes_until_start,
                offset_minutes: event.offset_minutes,
                data,
            }),
        ];

        if (event.doctor_id) {
            specs.push(
                T.appointmentReminder({
                    recipient_id: event.doctor_id,
                    recipient_type: NotificationRecipientType.DOCTOR,
                    appointment_id: event.appointment_id,
                    counterparty: patient,
                    when: T.appointmentWhen(
                        event.scheduled_start_at_utc,
                        doctor?.timezone,
                        event.timezone_snapshot,
                    ),
                    minutes_until_start: event.minutes_until_start,
                    offset_minutes: event.offset_minutes,
                    data,
                }),
            );
        }

        await this.dispatch(specs, AppEvents.APPOINTMENT_REMINDER_DUE);
    }

    // ─── helpers ────────────────────────────────────────

    /**
     * Goes through `.model()` rather than `CoreRepository.findOne`, which hardcodes
     * `{ __v: 0, ...projection }` — mixing that exclusion with an inclusion projection makes
     * MongoDB throw "Cannot do inclusion on field X in exclusion projection". Use the model
     * directly for a clean inclusion projection.
     *
     * A lookup failure must not lose the notification, so it degrades to a null person and
     * the templates fall back to "your doctor" / "A patient". But it is LOGGED: silent
     * degradation here previously made a hard projection error look like working copy.
     */
    private async resolveParties(patientId: string | null, doctorId: string | null) {
        const fields = AppointmentNotificationsListener.NAME_FIELDS;

        const [patient, doctor] = await Promise.all([
            patientId
                ? this.userRepository
                    .model()
                    .findOne({ _id: patientId }, fields)
                    .lean()
                    .catch((e) => this.lookupFailed('patient', patientId, e))
                : Promise.resolve(null),
            doctorId
                ? this.doctorRepository
                    .model()
                    .findOne({ _id: doctorId }, fields)
                    .lean()
                    .catch((e) => this.lookupFailed('doctor', doctorId, e))
                : Promise.resolve(null),
        ]);

        return { patient, doctor } as { patient: any; doctor: any };
    }

    private lookupFailed(kind: string, id: string, error: any): null {
        this.logger.warn(
            `Could not load ${kind} ${id} for notification copy: ${error?.message ?? error}. ` +
            `Falling back to a generic name.`,
        );
        return null;
    }

    private async dispatch(specs: NotificationSpec[], eventName: string) {
        if (!specs.length) return;
        try {
            await this.notificationsService.createMany(specs);
        } catch (error: any) {
            // createMany already swallows; this is belt and braces so a surprise here can
            // never escape into the emit tick.
            this.logger.warn(
                `Failed to dispatch notifications for ${eventName}: ${error?.message ?? error}`,
            );
        }
    }
}
