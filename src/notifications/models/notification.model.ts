import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
    NotificationCategory,
    NotificationRecipientType,
    NotificationType,
} from 'src/common/enums';

export type NotificationDocument = Notification & Document;

/** Six months. Notifications are the fastest-growing collection in the app. */
export const NOTIFICATION_TTL_SECONDS = 180 * 24 * 60 * 60;

@Schema({
    timestamps: true,
    collection: 'notifications',
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            // Internal dedupe key — meaningless to a client and it leaks the id scheme.
            delete ret.event_key;
            delete ret.__v;
            return ret;
        },
    },
})
export class Notification extends Document {
    // ─── Addressing ─────────────────────────────────────
    /**
     * Points into `users` or `doctors` depending on `recipient_type`. Deliberately NOT a
     * mongoose `refPath`: the recipient is always the authenticated caller, so it is never
     * populated, and refPath would force storing model names ('User') rather than domain
     * values ('patient').
     */
    @Prop({ type: Types.ObjectId, required: true })
    recipient_id: Types.ObjectId;

    @Prop({ type: String, enum: NotificationRecipientType, required: true })
    recipient_type: NotificationRecipientType;

    // ─── What happened ──────────────────────────────────
    @Prop({ type: String, enum: NotificationType, required: true })
    type: NotificationType;

    @Prop({ type: String, enum: NotificationCategory, required: true })
    category: NotificationCategory;

    /**
     * Rendered at write time, not at read time. Three reasons: there is no i18n layer to
     * render against; rendering per-read would mean populating appointment → doctor for
     * every row in a feed; and a notification is a historical record — "Dr Okafor confirmed
     * your appointment" must keep saying Okafor even after a reschedule reassigns the doctor.
     *
     * Contains names, times and counts ONLY. Never a drug name, test name, diagnosis or
     * referral reason — this text is intended to feed email and push later.
     */
    @Prop({ type: String, required: true })
    title: string;

    @Prop({ type: String, required: true })
    body: string;

    /** Structured facts (raw UTC timestamps, ids, counts) so a client can re-render. */
    @Prop({ type: Object, default: {} })
    data: Record<string, unknown>;

    // ─── Where it points ────────────────────────────────
    @Prop({ type: Types.ObjectId, ref: 'Appointment', default: null })
    appointment_id?: Types.ObjectId | null;

    @Prop({ type: Types.ObjectId, ref: 'Consultation', default: null })
    consultation_id?: Types.ObjectId | null;

    /** Who caused it — the other party. Not populated; for display attribution only. */
    @Prop({ type: Types.ObjectId, default: null })
    actor_id?: Types.ObjectId | null;

    @Prop({ type: String, enum: NotificationRecipientType, default: null })
    actor_type?: NotificationRecipientType | null;

    /** Client route hint, e.g. `/appointments/<id>`. */
    @Prop({ type: String, default: null })
    deep_link?: string | null;

    // ─── Read state ─────────────────────────────────────
    /**
     * Kept alongside `read_at` rather than deriving from it: `read_at: null` is not reliably
     * usable inside a partialFilterExpression, and a boolean indexes cleanly.
     * Invariant `is_read === (read_at != null)` is enforced by writing both only inside
     * NotificationsService — never from a controller or a listener.
     */
    @Prop({ type: Boolean, default: false, required: true })
    is_read: boolean;

    @Prop({ type: Date, default: null })
    read_at?: Date | null;

    // ─── Idempotency ────────────────────────────────────
    /**
     * Deterministic per (event, recipient), e.g.
     *   `appointment_booked:<appointment_id>:patient:<patient_id>`
     *   `appointment_reminder_1h:<appointment_id>:doctor:<doctor_id>`
     *
     * REQUIRED, never sparse-and-sometimes-absent. A unique index over a field that is
     * missing on some rows makes every one of them collide as null — this repo has been
     * bitten by exactly that twice (doctors.doctor_no, users.registration_no; see the
     * comment in src/database/index-error-logger.ts). Always deriving a key means dedupe is
     * universal and the null trap cannot happen.
     */
    @Prop({ type: String, required: true })
    event_key: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// ─── Indexes ────────────────────────────────────────────
// Declared explicitly rather than relying on autoIndex — see src/database/index-error-logger.ts
// for why this codebase does not trust a silent build. Verify with `pnpm run audit:indexes`.

// "my feed, newest first". The recipient prefix bounds the scan to one user's rows, so
// residual filtering on category/type is effectively free — no extra index until proven.
NotificationSchema.index({ recipient_id: 1, recipient_type: 1, createdAt: -1 });

// "my unread count" and "my unread feed".
NotificationSchema.index({ recipient_id: 1, recipient_type: 1, is_read: 1, createdAt: -1 });

// Dedupe. This is the guarantee behind every retry, poll and scheduler re-run.
NotificationSchema.index({ event_key: 1 }, { unique: true });

// Retention. In from day one: adding a TTL later triggers a one-time mass delete of
// everything already past the cutoff. NOTE a TTL index deletes silently.
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SECONDS });
