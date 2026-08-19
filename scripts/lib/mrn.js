/* eslint-disable no-console */
//
// MRN format helpers for the plain-Node scripts, which cannot import TypeScript.
//
// ⚠ MIRRORS src/utils/code-generator.util.ts — if the format changes in one place it
// must change in the other. The whole format is driven by the three constants below.
//
const { randomInt } = require('crypto');

const MRN_PREFIX = 'C-';
const MRN_BODY_LENGTH = 6;
const MRN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const MRN_REGEX = /^C-[A-Z0-9]{6}$/;

/** A candidate MRN. Uniqueness is the caller's problem — see allocateUniqueMrn. */
function generateMrnCandidate() {
    let body = '';
    for (let i = 0; i < MRN_BODY_LENGTH; i++) {
        body += MRN_ALPHABET.charAt(randomInt(MRN_ALPHABET.length));
    }
    return MRN_PREFIX + body;
}

/**
 * Draws an MRN not present in `taken`, and records it there before returning so a value
 * issued earlier in the same run can never be handed out again later in it.
 *
 * `taken` must be seeded with every existing MRN across BOTH collections.
 */
function allocateUniqueMrn(taken, maxAttempts = 50) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = generateMrnCandidate();
        if (!taken.has(candidate)) {
            taken.add(candidate);
            return candidate;
        }
    }
    throw new Error(`Could not allocate a unique MRN after ${maxAttempts} attempts`);
}

// ─── Registry ────────────────────────────────────────────────────────────────
//
// ⚠ MIRRORS src/common/mrn/mrn-registry.model.ts. The registry is the cross-collection
// uniqueness guarantee at runtime, so a script that writes an MRN without registering it
// leaves a value the app believes is free — and will hand out again.
//
const REGISTRY_COLLECTION = 'mrn_registry';
const OWNER_TYPE = { DOCTOR: 'doctor', PATIENT: 'patient' };

/** The collection whose unique index on `mrn` is the whole point of the registry. */
function registry(db) {
    return db.collection(REGISTRY_COLLECTION);
}

/**
 * Builds the unique index that makes the registry authoritative.
 *
 * Not sparse and not partial, unlike the per-collection indexes: a registry row without
 * an `mrn` is meaningless, so there is nothing to exempt.
 */
async function ensureRegistryIndex(db) {
    await registry(db).createIndex({ mrn: 1 }, { unique: true, name: 'mrn_1' });
    await registry(db).createIndex({ owner_type: 1, owner_id: 1 }, { name: 'owner_type_1_owner_id_1' });

    const indexes = await registry(db).listIndexes().toArray();
    const idx = indexes.find((i) => i.name === 'mrn_1');
    if (!idx || !idx.unique) {
        throw new Error(`${REGISTRY_COLLECTION}: mrn_1 unique index missing after createIndex`);
    }
    return idx;
}

/**
 * Reads every MRN currently held in doctors + users.
 *
 * This is the source of truth the registry is derived from, not the other way round —
 * the collections are what clinical data actually references.
 */
async function readHeldMrns(db) {
    const [doctors, users] = await Promise.all([
        db.collection('doctors').find({ mrn: { $type: 'string' } }, { projection: { _id: 1, mrn: 1 } }).toArray(),
        db.collection('users').find({ mrn: { $type: 'string' } }, { projection: { _id: 1, mrn: 1 } }).toArray(),
    ]);

    return [
        ...doctors.map((d) => ({ mrn: d.mrn, owner_type: OWNER_TYPE.DOCTOR, owner_id: d._id })),
        ...users.map((u) => ({ mrn: u.mrn, owner_type: OWNER_TYPE.PATIENT, owner_id: u._id })),
    ];
}

/**
 * Upserts registry rows for held MRNs, and reports what is missing or contradictory.
 *
 * Upsert rather than insert so reruns are idempotent, and `$setOnInsert` on the
 * timestamps so a re-registered row does not look freshly reserved.
 *
 * Never deletes. A registry row with no holder is an MRN that was retired — reserved for
 * a signup that failed, or belonging to an account that was removed — and dropping it
 * would put the value back in circulation, which is exactly what must not happen.
 */
async function syncRegistry(db, held, { apply }) {
    const existing = await registry(db).find({}, { projection: { mrn: 1, owner_type: 1, owner_id: 1 } }).toArray();
    const byMrn = new Map(existing.map((r) => [r.mrn, r]));

    const toInsert = [];
    const toAttach = [];
    const conflicts = [];

    for (const row of held) {
        const current = byMrn.get(row.mrn);

        if (!current) {
            toInsert.push(row);
            continue;
        }

        // Same MRN registered to a different account, or to the other type. The registry
        // cannot represent both, so this needs a human — report, never silently reassign.
        const ownerMatches = current.owner_id && String(current.owner_id) === String(row.owner_id);
        if (current.owner_id && !ownerMatches) {
            conflicts.push({ mrn: row.mrn, registry_owner: String(current.owner_id), holder: String(row.owner_id) });
            continue;
        }
        if (current.owner_type !== row.owner_type) {
            conflicts.push({ mrn: row.mrn, registry_owner_type: current.owner_type, holder_owner_type: row.owner_type });
            continue;
        }

        // Reserved but never claimed — fill in the owner now.
        if (!current.owner_id) toAttach.push(row);
    }

    if (!apply || (toInsert.length === 0 && toAttach.length === 0)) {
        return { inserted: 0, attached: 0, toInsert, toAttach, conflicts, existing: existing.length };
    }

    const now = new Date();
    let inserted = 0;
    let attached = 0;

    // Two passes rather than one mixed bulkWrite: upserts report through upsertedCount
    // and plain updates through modifiedCount, so combining them makes neither number
    // mean anything on its own.
    if (toInsert.length) {
        const res = await registry(db).bulkWrite(
            toInsert.map((r) => ({
                updateOne: {
                    filter: { mrn: r.mrn },
                    update: {
                        $set: { owner_type: r.owner_type, owner_id: r.owner_id, updatedAt: now },
                        $setOnInsert: { mrn: r.mrn, createdAt: now },
                    },
                    upsert: true,
                },
            })),
            { ordered: false },
        );
        inserted = res.upsertedCount;
    }

    if (toAttach.length) {
        const res = await registry(db).bulkWrite(
            toAttach.map((r) => ({
                updateOne: {
                    // owner_id: null in the filter is a compare-and-set — if the live app
                    // claimed this row since we read it, we leave its value alone.
                    filter: { mrn: r.mrn, owner_id: null },
                    update: { $set: { owner_id: r.owner_id, updatedAt: now } },
                },
            })),
            { ordered: false },
        );
        attached = res.modifiedCount;
    }

    return { inserted, attached, toInsert, toAttach, conflicts, existing: existing.length };
}

module.exports = {
    MRN_PREFIX,
    MRN_BODY_LENGTH,
    MRN_ALPHABET,
    MRN_REGEX,
    REGISTRY_COLLECTION,
    OWNER_TYPE,
    generateMrnCandidate,
    allocateUniqueMrn,
    registry,
    ensureRegistryIndex,
    readHeldMrns,
    syncRegistry,
};
