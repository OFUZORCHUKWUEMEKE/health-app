import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppointmentDocument } from 'src/bookings/models/appointment.model';
import { AppointmentStatus, NotificationType } from 'src/common/enums';
import { AppEvents, AppointmentReminderDueEvent } from 'src/common/events';

interface ReminderOffset {
    /** The claim field on the appointment. Per-offset so a third one is additive. */
    key: 'reminder_24h_sent_at' | 'reminder_1h_sent_at';
    minutes: number;
    type: NotificationType;
}

/**
 * Ordered widest-first. Each offset owns the BAND between it and the next narrower one,
 * not everything up to it:
 *
 *   24h sweep -> starts in (60 min, 1440 min]
 *   1h  sweep -> starts in (0 min,   60 min]
 *
 * The band matters. With plain "starts within 1440 minutes", an appointment booked 50
 * minutes ahead sits inside BOTH windows and the patient gets two notifications at the same
 * moment, both reading "in 50 minutes". Banding means a same-day booking gets only the 1h
 * reminder, while an appointment booked days out gets the 24h one and then the 1h one as it
 * crosses into the narrower band.
 */
export const REMINDER_OFFSETS: ReminderOffset[] = [
    {
        key: 'reminder_24h_sent_at',
        minutes: 1440,
        type: NotificationType.APPOINTMENT_REMINDER_24H,
    },
    {
        key: 'reminder_1h_sent_at',
        minutes: 60,
        type: NotificationType.APPOINTMENT_REMINDER_1H,
    },
];

/** Cap per offset per tick. The remainder drains on the next tick automatically. */
export const REMINDER_BATCH_SIZE = 200;

/** Concurrent claims in flight. Small, so a batch never opens 200 sockets at once. */
const CLAIM_CONCURRENCY = 10;

@Injectable()
export class AppointmentReminderService {
    private readonly logger = new Logger(AppointmentReminderService.name);

    /**
     * @Cron fires again even if the previous run is still going. This guards one instance;
     * the atomic claim in claimAndEmit() is what guards across instances.
     */
    private running = false;

    constructor(
        @InjectModel('Appointment')
        private readonly appointmentModel: Model<AppointmentDocument>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    @Cron(CronExpression.EVERY_5_MINUTES)
    async handleCron(): Promise<void> {
        if (this.running) {
            this.logger.warn('Previous reminder run still in flight; skipping this tick.');
            return;
        }

        this.running = true;
        try {
            const result = await this.dispatchDueReminders();
            if (result.created > 0) {
                this.logger.log(
                    `Reminders: scanned ${result.scanned}, dispatched ${result.created}.`,
                );
            }
        } catch (error: any) {
            // A cron that throws is an unhandled rejection. Reminders are best-effort.
            this.logger.error(
                `Reminder run failed: ${error?.message ?? error}`,
                error?.stack,
            );
        } finally {
            this.running = false;
        }
    }

    /**
     * The whole job, callable outside the cron.
     *
     * Kept separate from handleCron so it can be driven by a guarded HTTP route — that is
     * how the reminder path gets tested without waiting an hour, and it is also the escape
     * hatch if in-process scheduling is ever swapped for external cron.
     */
    async dispatchDueReminders(
        now: Date = new Date(),
    ): Promise<{ scanned: number; created: number }> {
        let scanned = 0;
        let created = 0;

        for (const [index, offset] of REMINDER_OFFSETS.entries()) {
            // The next narrower offset is this band's floor; the last one floors at `now`.
            const floorMinutes = REMINDER_OFFSETS[index + 1]?.minutes ?? 0;
            const windowStart = new Date(now.getTime() + floorMinutes * 60_000);
            const windowEnd = new Date(now.getTime() + offset.minutes * 60_000);

            // "Starts inside this band and has not been reminded" rather than "crosses the
            // boundary on this tick". That framing is self-healing: after an outage a
            // missed appointment is still inside the band on the next tick and gets a late
            // reminder instead of none, with no catch-up bookkeeping.
            //
            // $gt on the floor skips appointments already underway (and, for the wider
            // bands, ones a narrower reminder already owns). CONFIRMED excludes cancelled
            // and rescheduled, and deliberately excludes PENDING — reminding someone about
            // a slot the doctor has not accepted would be wrong.
            const due = await this.appointmentModel
                .find({
                    status: AppointmentStatus.CONFIRMED,
                    scheduled_start_at_utc: { $gt: windowStart, $lte: windowEnd },
                    [offset.key]: { $exists: false },
                })
                .select(
                    '_id patient_id doctor_id scheduled_start_at_utc timezone_snapshot appointment_number',
                )
                .sort({ scheduled_start_at_utc: 1 })
                .limit(REMINDER_BATCH_SIZE)
                .lean();

            scanned += due.length;

            // Chunked rather than Promise.all over the whole batch: 200 concurrent Mongo
            // operations on a 384 MB instance is needless pressure.
            for (let i = 0; i < due.length; i += CLAIM_CONCURRENCY) {
                const chunk = due.slice(i, i + CLAIM_CONCURRENCY);
                const results = await Promise.all(
                    chunk.map((appointment) =>
                        this.claimAndEmit(appointment, offset, now),
                    ),
                );
                created += results.filter(Boolean).length;
            }

            if (due.length === REMINDER_BATCH_SIZE) {
                this.logger.warn(
                    `Reminder batch saturated for ${offset.key} (${REMINDER_BATCH_SIZE}). ` +
                    `The remainder drains on the next tick.`,
                );
            }
        }

        return { scanned, created };
    }

    /**
     * Compare-and-set: claim the appointment, then emit. Filtering on the field being
     * absent means exactly one caller wins, so a second instance — or an overlapping tick —
     * finds modifiedCount 0 and skips. Correct without a lock.
     *
     * Claiming BEFORE emitting is deliberate. If the emit fails afterwards the patient
     * misses one reminder; if the order were reversed, a crash between emit and claim would
     * re-notify on every tick for the rest of the window.
     */
    private async claimAndEmit(
        appointment: any,
        offset: ReminderOffset,
        now: Date,
    ): Promise<boolean> {
        try {
            const claimed = await this.appointmentModel.updateOne(
                { _id: appointment._id, [offset.key]: { $exists: false } },
                { $set: { [offset.key]: new Date() } },
            );

            if (claimed.modifiedCount !== 1) return false;

            const start = new Date(appointment.scheduled_start_at_utc);
            // The REAL remaining time, not the nominal offset — a caught-up scheduler can
            // fire the "1 hour" reminder 47 minutes out, and the copy must say so.
            const minutesUntilStart = Math.max(
                0,
                Math.round((start.getTime() - now.getTime()) / 60_000),
            );

            this.eventEmitter.emit(AppEvents.APPOINTMENT_REMINDER_DUE, {
                appointment_id: String(appointment._id),
                patient_id: String(appointment.patient_id),
                doctor_id: appointment.doctor_id ? String(appointment.doctor_id) : null,
                scheduled_start_at_utc: start.toISOString(),
                timezone_snapshot: appointment.timezone_snapshot,
                minutes_until_start: minutesUntilStart,
                offset_minutes: offset.minutes,
            } as AppointmentReminderDueEvent);

            return true;
        } catch (error: any) {
            // One bad appointment must not abort the rest of the batch.
            this.logger.warn(
                `Could not dispatch ${offset.key} for appointment ${appointment?._id}: ` +
                `${error?.message ?? error}`,
            );
            return false;
        }
    }
}
