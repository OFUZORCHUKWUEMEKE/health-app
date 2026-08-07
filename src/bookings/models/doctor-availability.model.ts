import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DoctorAvailabilityDocument = DoctorAvailability & Document;

@Schema({ _id: false })
export class WeeklySlot {
    /** 0=Sunday … 6=Saturday, evaluated in the parent availability.timezone. */
    @Prop({ required: true, min: 0, max: 6 })
    day_of_week: number;

    /** Local wall-clock HH:mm (24h) in availability.timezone. */
    @Prop({ required: true })
    start_time: string;

    /** Local wall-clock HH:mm (24h) in availability.timezone. */
    @Prop({ required: true })
    end_time: string;

    @Prop({ required: true })
    slot_duration_minutes: number;

    @Prop({ default: true })
    is_active: boolean;
}

const WeeklySlotSchema = SchemaFactory.createForClass(WeeklySlot);

@Schema({

    
    timestamps: true,
    collection: 'doctor_availability',
})
export class DoctorAvailability extends Document {
    @Prop({ type: Types.ObjectId, ref: 'Doctor', required: true, unique: true })
    doctor_id: Types.ObjectId;

    /**
     * IANA zone name (e.g. "Africa/Lagos"). Load-bearing: weekly_slots.day_of_week /
     * start_time / end_time are interpreted as local wall-clock values in this zone.
     * Conversion to UTC is done at query time and handles DST correctly.
     */
    @Prop({ required: true })
    timezone: string;

    @Prop({ type: [WeeklySlotSchema], default: [] })
    weekly_slots: WeeklySlot[];

    @Prop()
    effective_from?: Date;

    @Prop()
    effective_to?: Date;
}

export const DoctorAvailabilitySchema = SchemaFactory.createForClass(DoctorAvailability);
