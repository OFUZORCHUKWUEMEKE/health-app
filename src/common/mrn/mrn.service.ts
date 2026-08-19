import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MrnOwnerType } from 'src/common/enums';
import { generateMrnCandidate } from 'src/utils/code-generator.util';
import { MrnRegistry, MrnRegistryDocument } from './mrn-registry.model';

/** Mongo's duplicate-key error code, raised by the unique index on mrn_registry.mrn. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

/**
 * Allocates Medical Record Numbers from a single namespace shared by patients and doctors.
 *
 * Uniqueness rests on two different indexes, and the split matters:
 *
 * - ACROSS both types, the unique index on `mrn_registry.mrn` is the guarantee.
 *   Allocation does not ask whether a value is free — it *takes* it, by inserting into
 *   the registry, and treats E11000 as "someone else got there first". Since the
 *   decision is the write, two concurrent signups cannot both win the same value.
 * - WITHIN a collection, the unique sparse index on `doctors.mrn` / `users.mrn` still
 *   stands. It is now a backstop rather than the primary defence, and worth keeping:
 *   it catches an MRN written by anything that bypasses this service.
 *
 * This replaces an earlier check-then-insert (query both collections, return a candidate
 * that appeared free), which had no defence against two requests observing the same
 * candidate as free. `scripts/backfill-mrn.js` seeds the registry from existing rows and
 * verifies the property holds.
 */
@Injectable()
export class MrnService {
    private static readonly MAX_ATTEMPTS = 10;
    private readonly logger = new Logger(MrnService.name);

    constructor(
        @InjectModel(MrnRegistry.name) private readonly registryModel: Model<MrnRegistryDocument>,
    ) { }

    /**
     * Reserves and returns an MRN that is now permanently spoken for.
     *
     * Call this BEFORE creating the document that will hold the value. If that creation
     * then fails, the reservation is left behind holding `owner_id: null` — an MRN
     * retired without ever being used. That is the deliberate trade: burning a value out
     * of a 36^6 keyspace costs nothing, whereas releasing it would mean reopening the
     * race this method exists to close.
     */
    async generateUniqueMrn(ownerType: MrnOwnerType): Promise<string> {
        for (let attempt = 1; attempt <= MrnService.MAX_ATTEMPTS; attempt++) {
            const candidate = generateMrnCandidate();

            try {
                await this.registryModel.create({
                    mrn: candidate,
                    owner_type: ownerType,
                    owner_id: null,
                });
                return candidate;
            } catch (error) {
                if (!isDuplicateKeyError(error)) {
                    throw error;
                }

                this.logger.warn(
                    `MRN collision on ${candidate} (attempt ${attempt}/${MrnService.MAX_ATTEMPTS})`,
                );
            }
        }

        throw new InternalServerErrorException(
            `Could not allocate a unique MRN after ${MrnService.MAX_ATTEMPTS} attempts`,
        );
    }

    /**
     * Records which document ended up holding a reserved MRN.
     *
     * Best-effort on purpose: uniqueness was already settled by the reservation, so a
     * failure here costs a reconciliation breadcrumb and nothing else. It must not be
     * able to fail a signup whose account was created successfully — the caller has
     * already committed at this point.
     */
    async claim(mrn: string, ownerId: Types.ObjectId | string): Promise<void> {
        try {
            await this.registryModel.updateOne({ mrn }, { $set: { owner_id: ownerId } });
        } catch (error) {
            this.logger.warn(
                `Could not attach owner ${String(ownerId)} to MRN ${mrn}: ${error?.message ?? error}`,
            );
        }
    }
}
