import { NotificationRecipientType, NotificationType } from 'src/common/enums';
import * as T from './notification-templates';

describe('notification templates', () => {
    const doctor = { first_name: 'Emeka', last_name: 'Okafor', timezone: 'Africa/Lagos' };
    const patient = { first_name: 'Ada', last_name: 'Nwosu', timezone: 'Europe/London' };
    // 2026-08-31T20:00:00Z → 21:00 Lagos, 21:00 London (BST), 14:00 Edmonton
    const startUtc = '2026-08-31T20:00:00.000Z';

    describe('name rendering', () => {
        it('prefixes a doctor with Dr', () => {
            expect(T.doctorName(doctor)).toBe('Dr Emeka Okafor');
        });

        it('degrades to a generic label rather than "undefined" when lookup failed', () => {
            expect(T.doctorName(null)).toBe('your doctor');
            expect(T.personName(null, 'A patient')).toBe('A patient');
        });

        it('falls back to full_name when the name parts are missing', () => {
            expect(T.personName({ full_name: 'Ada Nwosu' }, 'x')).toBe('Ada Nwosu');
        });
    });

    describe('appointmentWhen', () => {
        it("renders in the recipient's own zone, not the booking zone", () => {
            const forDoctor = T.appointmentWhen(startUtc, 'Africa/Lagos', 'America/Edmonton');
            const forPatient = T.appointmentWhen(startUtc, 'America/Edmonton', 'America/Edmonton');
            expect(forDoctor).toContain('9:00 PM');
            expect(forPatient).toContain('2:00 PM');
        });

        it('falls back to the appointment timezone_snapshot when the recipient has none', () => {
            expect(T.appointmentWhen(startUtc, null, 'America/Edmonton')).toContain('2:00 PM');
        });

        it('degrades to UTC rather than throwing on a malformed zone', () => {
            // A bad stored timezone must not abort the notification, and by extension the
            // domain operation that triggered it.
            expect(() => T.appointmentWhen(startUtc, 'Not/AZone', null)).not.toThrow();
            expect(T.appointmentWhen(startUtc, 'Not/AZone', null)).toContain('8:00 PM');
        });
    });

    describe('event_key', () => {
        it('is deterministic, so a replayed event dedupes on the unique index', () => {
            const spec = () =>
                T.patientAppointmentBooked({
                    patient_id: 'p1',
                    appointment_id: 'a1',
                    doctor,
                    doctor_id: 'd1',
                    when: 'later',
                    pending: false,
                    data: {},
                });
            expect(spec().event_key).toBe(spec().event_key);
        });

        it('differs per recipient, so both parties get their own row', () => {
            const p = T.patientAppointmentBooked({
                patient_id: 'p1',
                appointment_id: 'a1',
                doctor,
                doctor_id: 'd1',
                when: 'later',
                pending: false,
                data: {},
            });
            const d = T.doctorAppointmentRequest({
                doctor_id: 'd1',
                patient_id: 'p1',
                appointment_id: 'a1',
                patient,
                when: 'later',
                pending: false,
                data: {},
            });
            expect(p.event_key).not.toBe(d.event_key);
        });
    });

    describe('booking copy', () => {
        it('says "awaiting confirmation" while PENDING and names the doctor once booked', () => {
            const pending = T.patientAppointmentBooked({
                patient_id: 'p1',
                appointment_id: 'a1',
                doctor,
                doctor_id: 'd1',
                when: 'Mon 31 Aug at 2:00 PM',
                pending: true,
                data: {},
            });
            expect(pending.body).toContain('awaiting confirmation');
            expect(pending.title).toBe('Appointment request sent');

            const booked = T.patientAppointmentBooked({
                patient_id: 'p1',
                appointment_id: 'a1',
                doctor,
                doctor_id: 'd1',
                when: 'Mon 31 Aug at 2:00 PM',
                pending: false,
                data: {},
            });
            expect(booked.body).toContain('Dr Emeka Okafor');
        });

        it('gives the doctor a request type while PENDING', () => {
            expect(
                T.doctorAppointmentRequest({
                    doctor_id: 'd1',
                    patient_id: 'p1',
                    appointment_id: 'a1',
                    patient,
                    when: 'later',
                    pending: true,
                    data: {},
                }).type,
            ).toBe(NotificationType.APPOINTMENT_REQUEST_RECEIVED);
        });
    });

    describe('reminders', () => {
        it('renders the REAL remaining time, not the nominal offset', () => {
            // After an outage the scheduler catches up late: a "1 hour" reminder can
            // genuinely be 47 minutes out, and saying "in 1 hour" would be a lie.
            const spec = T.appointmentReminder({
                recipient_id: 'p1',
                recipient_type: NotificationRecipientType.PATIENT,
                appointment_id: 'a1',
                counterparty: doctor,
                when: 'Mon 31 Aug at 2:00 PM',
                minutes_until_start: 47,
                offset_minutes: 60,
                data: {},
            });
            expect(spec.body).toContain('in 47 minutes');
            expect(spec.body).not.toContain('in about an hour');
        });

        it('picks the type from the offset, and keys per offset so 24h and 1h coexist', () => {
            const base = {
                recipient_id: 'p1',
                recipient_type: NotificationRecipientType.PATIENT,
                appointment_id: 'a1',
                counterparty: doctor,
                when: 'x',
                minutes_until_start: 30,
                data: {},
            };
            const h24 = T.appointmentReminder({ ...base, offset_minutes: 1440 });
            const h1 = T.appointmentReminder({ ...base, offset_minutes: 60 });

            expect(h24.type).toBe(NotificationType.APPOINTMENT_REMINDER_24H);
            expect(h1.type).toBe(NotificationType.APPOINTMENT_REMINDER_1H);
            expect(h24.event_key).not.toBe(h1.event_key);
        });

        it('addresses each side with the other party', () => {
            const toDoctor = T.appointmentReminder({
                recipient_id: 'd1',
                recipient_type: NotificationRecipientType.DOCTOR,
                appointment_id: 'a1',
                counterparty: patient,
                when: 'x',
                minutes_until_start: 30,
                offset_minutes: 60,
                data: {},
            });
            expect(toDoctor.title).toBe('Upcoming appointment');
            expect(toDoctor.body).toContain('Ada Nwosu');
        });
    });

    describe('humanizeMinutes', () => {
        it.each([
            [1, 'in under a minute'],
            [47, 'in 47 minutes'],
            [60, 'in about an hour'],
            [120, 'in about 2 hours'],
            [1440, 'tomorrow'],
            [2880, 'in 2 days'],
        ])('%i minutes -> %s', (mins, expected) => {
            expect(T.humanizeMinutes(mins as number)).toBe(expected);
        });
    });

    describe('PHI rule', () => {
        // title/body are stored and are intended to feed email and push later, so they must
        // carry names, times and counts only — never clinical detail.
        it('cancellation copy carries no reason text even when one is supplied', () => {
            const spec = T.appointmentCancelled({
                recipient_id: 'd1',
                recipient_type: NotificationRecipientType.DOCTOR,
                appointment_id: 'a1',
                actor: patient,
                actor_id: 'p1',
                actor_type: NotificationRecipientType.PATIENT,
                when: 'Mon 31 Aug at 2:00 PM',
                reason: 'Suspected tuberculosis, referred to chest clinic',
                data: {},
            });
            expect(spec.body).not.toContain('tuberculosis');
            expect(spec.body).toContain('Ada Nwosu');
        });
    });
});
