import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PendingRegistrationDocument = PendingRegistration & Document;

@Schema({
    timestamps: true,
    collection: 'pending_registrations',
})
export class PendingRegistration extends Document {
    @Prop({ required: true, unique: true, lowercase: true })
    email: string;

    @Prop({ required: true })
    otp_hash: string;

    @Prop({ required: true })
    otp_expires_at: Date;

    @Prop({ default: 0 })
    attempt_count: number;

    @Prop({ default: 0 })
    resend_count: number;

    @Prop({ required: true, default: () => new Date() })
    resend_window_started_at: Date;

    @Prop()
    cooldown_until?: Date;

    @Prop({ default: false })
    verified: boolean;

    @Prop()
    verified_at?: Date;

    @Prop()
    registration_token_jti?: string;
}

export const PendingRegistrationSchema =
    SchemaFactory.createForClass(PendingRegistration);

PendingRegistrationSchema.index({ otp_expires_at: 1 }, { expireAfterSeconds: 0 });
