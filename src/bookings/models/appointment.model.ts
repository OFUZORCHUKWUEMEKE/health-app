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
