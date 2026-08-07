import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DoctorDocument = Doctor & Document;

/**
 * Doctor schema — represents a Doctor account + professional profile.
 *
 * Changes from old schema:
 * - Added doctor_no, full_name, profile_picture_url
 * - Added specializations (array), license_no
 * - Renamed: active → active (still boolean, but now properly enforced at login)
 * - refresh_token is now hashed (refresh_token_hash)
 * - Removed: token
 * - Password excluded from JSON via toJSON transform
 */
@Schema({
    timestamps: true,
    collection: 'doctors',
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            delete ret.password_hash;
            delete ret.refresh_token_hash;
            delete ret.__v;
            return ret;
        },
    },
})
export class Doctor extends Document {
    @Prop({ type: String, unique: true, required: true })
    doctor_no: string;

    @Prop({ required: true })
    first_name: string;

    @Prop({ required: true })
    last_name: string;

    @Prop()
    full_name?: string;

    @Prop({ required: true, unique: true, lowercase: true })
    email: string;

    @Prop()
    phone_number?: string;

    @Prop({ required: true })
    password_hash: string;

    @Prop({ default: true })
    active: boolean;

    @Prop()
    profile_picture_url?: string;

    @Prop()
    timezone?: string;

    // ─── Professional Profile ───────────────────────────
    @Prop({ type: [String], default: [] })
    specializations: string[];

    @Prop({ type: String, unique: true, sparse: true })
    license_no?: string;

    // ─── Auth ───────────────────────────────────────────
    @Prop()
    refresh_token_hash?: string;
}

export const DoctorSchema = SchemaFactory.createForClass(Doctor);

// ─── Indexes ────────────────────────────────────────────
DoctorSchema.index({ specializations: 1, active: 1 });