import { AppointmentStatus } from 'src/common/enums';
import { AppEvents } from 'src/common/events';
import {
    AppointmentReminderService,
    REMINDER_BATCH_SIZE,
} from './appointment-reminder.service';

describe('AppointmentReminderService', () => {
    const NOW = new Date('2026-08-31T10:00:00.000Z');

    const find = jest.fn();
    const updateOne = jest.fn();
    const appointmentModel = { find, updateOne };
    const eventEmitter = { emit: jest.fn() };

    let service: AppointmentReminderService;

    /** Mirrors the .select().sort().limit().lean() chain in the service. */
    const chainReturning = (rows: any[]) => ({
        select: () => ({
            sort: () => ({ limit: () => ({ lean: async () => rows }) }),
        }),
    });

    const appointment = (over: Partial<any> = {}) => ({
        _id: 'a1',
        patient_id: 'p1',
        doctor_id: 'd1',
        scheduled_start_at_utc: new Date('2026-08-31T10:30:00.000Z'),
        timezone_snapshot: 'Africa/Lagos',
        appointment_number: 'APT-1',
        ...over,
    });

    const reminderEmits = () =>
        eventEmitter.emit.mock.calls.filter(
            (c) => c[0] === AppEvents.APPOINTMENT_REMINDER_DUE,
        );

    beforeEach(() => {
        jest.clearAllMocks();
        service = new AppointmentReminderService(
            appointmentModel as any,
            eventEmitter as any,
        );
        find.mockReturnValue(chainReturning([]));
        updateOne.mockResolvedValue({ modifiedCount: 1 });
    });

    describe('the query window', () => {
        it('asks for confirmed, not-yet-reminded appointments inside each band', async () => {
            await service.dispatchDueReminders(NOW);

            expect(find).toHaveBeenCalledTimes(2); // 24h and 1h
            const [q24] = find.mock.calls[0];
            expect(q24.status).toBe(AppointmentStatus.CONFIRMED);
            expect(q24.reminder_24h_sent_at).toEqual({ $exists: false });

            const [q1] = find.mock.calls[1];
            expect(q1.reminder_1h_sent_at).toEqual({ $exists: false });
        });

        it('bands each offset so a same-day booking is not reminded twice at once', async () => {
            // Without a floor, an appointment 50 minutes out sits inside BOTH windows and
            // the patient gets two notifications at the same instant, both reading "in 50
            // minutes". The 24h band must start where the 1h band ends.
            await service.dispatchDueReminders(NOW);

            const [q24] = find.mock.calls[0];
            expect(q24.scheduled_start_at_utc.$gt).toEqual(
                new Date(NOW.getTime() + 60 * 60_000),
            );
            expect(q24.scheduled_start_at_utc.$lte).toEqual(
                new Date(NOW.getTime() + 1440 * 60_000),
            );

            const [q1] = find.mock.calls[1];
            expect(q1.scheduled_start_at_utc.$gt).toEqual(NOW);
            expect(q1.scheduled_start_at_utc.$lte).toEqual(
                new Date(NOW.getTime() + 60 * 60_000),
            );
        });

        it('excludes appointments already underway — the narrowest band floors at now', async () => {
            await service.dispatchDueReminders(NOW);
            expect(find.mock.calls[1][0].scheduled_start_at_utc.$gt).toEqual(NOW);
        });

        it('caps the batch and leaves the remainder for the next tick', async () => {
            const limit = jest.fn(() => ({ lean: async () => [] }));
            find.mockReturnValue({ select: () => ({ sort: () => ({ limit }) }) });

            await service.dispatchDueReminders(NOW);

            expect(limit).toHaveBeenCalledWith(REMINDER_BATCH_SIZE);
        });
    });

    describe('the atomic claim', () => {
        it('claims before emitting, filtered on the field being absent', async () => {
            find.mockReturnValueOnce(chainReturning([appointment()]));

            await service.dispatchDueReminders(NOW);

            const [filter, update] = updateOne.mock.calls[0];
            expect(filter._id).toBe('a1');
            expect(filter.reminder_24h_sent_at).toEqual({ $exists: false });
            expect(update.$set.reminder_24h_sent_at).toBeInstanceOf(Date);
        });

        it('skips the emit when another instance won the claim', async () => {
            find.mockReturnValueOnce(chainReturning([appointment()]));
            updateOne.mockResolvedValue({ modifiedCount: 0 });

            const result = await service.dispatchDueReminders(NOW);

            expect(reminderEmits()).toHaveLength(0);
            expect(result.created).toBe(0);
            expect(result.scanned).toBe(1);
        });

        it('one failing appointment does not abort the rest of the batch', async () => {
            find.mockReturnValueOnce(
                chainReturning([appointment({ _id: 'bad' }), appointment({ _id: 'good' })]),
            );
            updateOne
                .mockRejectedValueOnce(new Error('write conflict'))
                .mockResolvedValue({ modifiedCount: 1 });

            const result = await service.dispatchDueReminders(NOW);

            expect(result.created).toBe(1);
        });
    });

    describe('the emitted payload', () => {
        it('reports the REAL remaining minutes, not the nominal offset', async () => {
            // The self-healing band means a caught-up scheduler fires late: an appointment
            // 10 hours out, found by the 24h sweep after an outage, must say 600 minutes
            // rather than 1440 — otherwise the copy lies to the patient.
            find.mockReturnValueOnce(
                chainReturning([
                    appointment({
                        scheduled_start_at_utc: new Date('2026-08-31T20:00:00.000Z'),
                    }),
                ]),
            );

            await service.dispatchDueReminders(NOW);

            const payload = reminderEmits()[0][1];
            expect(payload.minutes_until_start).toBe(600);
            expect(payload.offset_minutes).toBe(1440);
        });

        it('recovers a missed window rather than skipping it', async () => {
            // 12 minutes out, found by the 1h sweep after an outage.
            find
                .mockReturnValueOnce(chainReturning([]))
                .mockReturnValueOnce(
                    chainReturning([
                        appointment({
                            scheduled_start_at_utc: new Date('2026-08-31T10:12:00.000Z'),
                        }),
                    ]),
                );

            await service.dispatchDueReminders(NOW);

            expect(reminderEmits()[0][1].minutes_until_start).toBe(12);
        });

        it('carries ids as strings and preserves the timezone snapshot', async () => {
            find.mockReturnValueOnce(chainReturning([appointment()]));

            await service.dispatchDueReminders(NOW);

            expect(reminderEmits()[0][1]).toMatchObject({
                appointment_id: 'a1',
                patient_id: 'p1',
                doctor_id: 'd1',
                timezone_snapshot: 'Africa/Lagos',
            });
        });

        it('tolerates an appointment awaiting doctor assignment', async () => {
            find.mockReturnValueOnce(chainReturning([appointment({ doctor_id: null })]));

            await service.dispatchDueReminders(NOW);

            expect(reminderEmits()[0][1].doctor_id).toBeNull();
        });
    });

    describe('the reentrancy guard', () => {
        it('skips a tick while the previous run is still in flight', async () => {
            let release: () => void = () => { };
            const gate = new Promise<void>((r) => (release = r));
            find.mockReturnValue({
                select: () => ({
                    sort: () => ({
                        limit: () => ({ lean: async () => { await gate; return []; } }),
                    }),
                }),
            });

            const first = service.handleCron();
            await service.handleCron(); // must return immediately, not queue

            expect(find).toHaveBeenCalledTimes(1);

            release();
            await first;
        });

        it('releases the guard even when the run throws', async () => {
            find.mockImplementation(() => {
                throw new Error('mongo down');
            });

            await service.handleCron(); // must not reject — a throwing cron is unhandled
            await service.handleCron();

            expect(find).toHaveBeenCalledTimes(2);
        });
    });
});
