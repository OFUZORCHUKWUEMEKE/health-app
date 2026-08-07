import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { AuthProvider } from 'src/common/enums';

export type UserDocument = User & Document;

/**
 * User schema — represents a Patient account + profile.
 *
 * Changes from old schema:
 * - Added registration_no, date_of_birth, gender, marital_status, occupation, address
 * - Added medical fields: allergies, previous_medical_conditions, medical_flags
 * - Added terms_accepted, terms_accepted_at
 * - refresh_token is now hashed (refresh_token_hash)
 * - Removed: token, verified → is now 'verified' (correctly typed as boolean)
 * - Removed: full_name (computed virtual instead)
 * - password is excluded from JSON serialization via toJSON transform
 */
@Schema({
    timestamps: true,
    collection: 'users',
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
export class User extends Document {
    @Prop({ type: String, unique: true, required: true })
    registration_no: string;

    @Prop({ type: String, unique: true, sparse: true })
    mrn?: string;

    @Prop({ required: true })
    first_name: string;

    @Prop({ required: true })
    last_name: string;

    @Prop()
    middle_name?: string;

    @Prop()
    full_name?: string;

    @Prop({ required: true, unique: true, lowercase: true })
    email: string;

    @Prop()
    phone_number?: string;

    @Prop({ required: false, select: false })
    password_hash?: string;

    @Prop({ type: String, enum: AuthProvider, default: AuthProvider.LOCAL })
    provider: AuthProvider;

    @Prop({ default: false })
    verified: boolean;

    // ─── Profile ────────────────────────────────────────
    @Prop()
    date_of_birth?: Date;

    @Prop()
    gender?: string;

    @Prop()
    marital_status?: string;

    @Prop()
    occupation?: string;

    @Prop()
    address?: string;

    @Prop()
    timezone?: string;

    @Prop()
    profile_picture_url?: string;

    // ─── Medical Info ───────────────────────────────────
    @Prop({ type: [String], default: [] })
    allergies: string[];

    @Prop({ type: [String], default: [] })
    previous_medical_conditions: string[];

    @Prop({ type: [String], default: [] })
    medical_flags: string[];

    // ─── Terms ──────────────────────────────────────────
    @Prop({ default: false })
    terms_accepted: boolean;

    @Prop()
    terms_accepted_at?: Date;

    // ─── Auth ───────────────────────────────────────────
    @Prop({ select: false })
    refresh_token_hash?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);