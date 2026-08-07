import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DoctorBlackoutDocument = DoctorBlackout & Document;

@Schema({
    timestamps: true,
    collection: 'doctor_blackouts',
})
export class DoctorBlackout extends Document {
    @Prop({ type: Types.ObjectId, ref: 'Doctor', required: true, index: true })
    doctor_id: Types.ObjectId;

    @Prop({ required: true })
    start_at_utc: Date;

    @Prop({ required: true })
    end_at_utc: Date;

    @Prop()
    reason?: string;

    @Prop({ default: false })
    reccuring: boolean;

    /**
     * IANA zone used to interpret recurring fields (day_of_week, start/end_time_minutes)
     * and the local wall-clock time the user specified. Retained for one-time blackouts too
     * for audit/display.
     */
    @Prop()
    timezone?: string;

    /** 0=Sun … 6=Sat in `timezone` — populated only when reccuring=true */
    @Prop({ type: Number, index: true })
    day_of_week?: number;

    /** Minutes since midnight in `timezone` — populated only when reccuring=true */
    @Prop({ type: Number })
    start_time_minutes?: number;

    /** Minutes since midnight in `timezone` — populated only when reccuring=true */
    @Prop({ type: Number })
    end_time_minutes?: number;
}

export const DoctorBlackoutSchema = SchemaFactory.createForClass(DoctorBlackout);
DoctorBlackoutSchema.index({ doctor_id: 1, start_at_utc: 1, end_at_utc: 1 });
DoctorBlackoutSchema.index({ doctor_id: 1, reccuring: 1, day_of_week: 1, start_time_minutes: 1, end_time_minutes: 1 });
