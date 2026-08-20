import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { AppointmentFor, AppointmentStatus, Role } from 'src/common/enums';

export type AppointmentDocument = Appointment & Document;

@Schema({
    timestamps: true,
    collection: 'appointments',
})
export class Appointment extends Document {
    @Prop({ type: String, sparse: true, index: true })
    appointment_number: string;

    @Prop({ type: Types.ObjectId, ref: 'User', index: true })
    patient_id?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Doctor', required: false, index: true })
    doctor_id?: Types.ObjectId;

    @Prop({ required: true, index: true })
    scheduled_start_at_utc: Date;

    @Prop({ required: true })
    scheduled_end_at_utc: Date;

    @Prop({ required: true })
    timezone_snapshot: string;

    @Prop({
        type: String,
        enum: AppointmentStatus,
        default: AppointmentStatus.PENDING,
        index: true,
    })
    status: AppointmentStatus;

    @Prop({
        type: String,
        enum: AppointmentFor,
        default: AppointmentFor.SELF,
    })
    appointment_for: AppointmentFor;

    @Prop()
    reason_for_visit?: string;

    @Prop()
    complaint_brief?: string;

    @Prop({ type: [String], default: [] })
    Medical_conditions?: string[];

    @Prop({ type: [String], default: [] })
    allergies?: string[];

    @Prop({ type: Object })
    booking_profile_snapshot?: {
        first_name: string;
        last_name: string;
        date_of_birth?: Date;
        gender?: string;
        marital_status?: string;
        occupation?: string;
        present_complaint?: string;
    };

    @Prop({ type: Types.ObjectId, ref: 'Consultation' })
    consultation_id?: Types.ObjectId;

    @Prop({ type: String, enum: Role })
    cancelled_by?: Role;

    @Prop()
    cancelled_reason?: string;

    @Prop({ type: Types.ObjectId, ref: 'Appointment' })
    rescheduled_from_appointment_id?: Types.ObjectId;

    @Prop({ type: String })
    daily_room_name?: string;

    @Prop({ type: String })
    daily_room_url?: string;

    @Prop({ type: Date })
    daily_room_expires_at?: Date;

    @Prop({ type: String })
    daily_recording_id?: string;

    @Prop({ type: Date })
    video_started_at?: Date;

    @Prop({ type: Date })
    video_ended_at?: Date;

    // ─── Reminder claims ────────────────────────────────
    /**
     * Set the instant a reminder was claimed, via a compare-and-set update filtered on the
     * field being absent. That claim — not the notification write — is what makes the
     * scheduler safe: it is atomic, so it holds under multiple instances without needing a
     * lock or an extra collection.
     *
     * Named per offset rather than a single `reminder_sent_at` so adding a third offset
     * later is additive instead of a migration.
     */
    @Prop({ type: Date })
    reminder_24h_sent_at?: Date;

    @Prop({ type: Date })
    reminder_1h_sent_at?: Date;
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);
AppointmentSchema.index(
    { doctor_id: 1, scheduled_start_at_utc: 1 },
    {
        unique: true,
        partialFilterExpression: {
            doctor_id: { $exists: true },
            status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
        },
    },
);
AppointmentSchema.index({ doctor_id: 1, scheduled_start_at_utc: 1, status: 1 });
AppointmentSchema.index({ patient_id: 1, scheduled_start_at_utc: 1 });
AppointmentSchema.index({ patient_id: 1, status: 1, scheduled_start_at_utc: 1 });
AppointmentSchema.index({ consultation_id: 1 }, { unique: true, sparse: true });

// The reminder scan runs every 5 minutes and leads with status; none of the indexes above
// do. Deliberately NOT a partial index on `reminder_*_sent_at: {$exists: false}` —
// $exists is unsupported in partialFilterExpression.
AppointmentSchema.index({ status: 1, scheduled_start_at_utc: 1 });
