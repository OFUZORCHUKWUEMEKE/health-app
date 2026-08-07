import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { AdminRole } from 'src/common/enums';

export type AdminDocument = Admin & Document;

/**
 * Admin schema — represents an Admin account.
 *
 * Changes from old schema:
 * - Added role (enum: super_admin | moderator)
 * - Password renamed to password_hash and excluded from JSON
 */
@Schema({
    timestamps: true,
    collection: 'admins',
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            delete ret.password_hash;
            delete ret.__v;
            return ret;
        },
    },
})
export class Admin extends Document {
    @Prop({ required: true })
    first_name: string;

    @Prop({ required: true })
    last_name: string;

    @Prop({ required: true, unique: true, lowercase: true })
    email: string;

    @Prop()
    phone_number?: string;

    @Prop({ required: true })
    password_hash: string;

    @Prop({ type: String, enum: AdminRole, required: true, default: AdminRole.MODERATOR })
    role: AdminRole;
}

export const AdminSchema = SchemaFactory.createForClass(Admin);
