import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes, Types } from 'mongoose';
import { MrnOwnerType } from 'src/common/enums';

export type MrnRegistryDocument = MrnRegistry & Document;

/**
 * The allocation ledger for the shared MRN namespace.
 *
 * MongoDB unique indexes are per-collection, so `doctors.mrn` and `users.mrn` can never
 * constrain each other no matter how they are indexed. This collection is the one place
 * where both types meet, which makes its unique index on `mrn` the actual cross-type
 * guarantee — allocation reserves a value by inserting here first, and E11000 is the
 * answer to "is it taken?".
 *
 * Rows are permanent by design. An MRN identifies a medical record, so it is never
 * recycled even if the account that held it goes away; the row outliving its owner is
 * the point, not a leak. See MrnService for how that interacts with deletion.
 */
@Schema({
    timestamps: true,
    collection: 'mrn_registry',
})
export class MrnRegistry extends Document {
    @Prop({ type: String, required: true, unique: true })
    mrn: string;

    @Prop({ type: String, enum: MrnOwnerType, required: true })
    owner_type: MrnOwnerType;

    /**
     * Null between reservation and the owning document actually being created — the
     * insert that reserves the MRN happens before the doctor/user row exists, so there
     * is no id to record yet. MrnService.claim() fills it in afterwards.
     *
     * A row still holding null well after its `createdAt` is therefore an orphan: an
     * MRN reserved for a signup that failed before it wrote a document. Harmless (the
     * value is simply retired), but that is how you find them.
     */
    @Prop({ type: SchemaTypes.ObjectId, required: false, default: null })
    owner_id?: Types.ObjectId | null;
}

export const MrnRegistrySchema = SchemaFactory.createForClass(MrnRegistry);

// ─── Indexes ────────────────────────────────────────────
// `mrn` gets its unique index from the @Prop above. This one is for reconciliation
// ("which registry row belongs to this doctor?") and is deliberately NOT unique:
// during reservation many rows legitimately share owner_id: null.
MrnRegistrySchema.index({ owner_type: 1, owner_id: 1 });
