/* eslint-disable no-console */
//
// Repairs consultations whose `consoltation_for` says SELF when the appointment they came
// from was booked for someone else.
//
// src/video/video.service.ts created every consultation with a hardcoded
// `consoltation_for: ConsultationForEnum.SELF`, ignoring `appointment.appointment_for`.
// That field is projected into both patient- and doctor-facing responses
// (src/consultations/consultations.service.ts, ~8 call sites), so the wrong value has been
// reaching clients. The service now maps it from the appointment, but the write is a
// `$setOnInsert` — the fix is forward-only and cannot repair rows already created.
//
// SCOPE — deliberately one-directional:
//
//   consultation SELF + appointment OTHERS  → corrected to OTHERS.  This is the bug.
//   consultation OTHERS + appointment SELF  → LEFT ALONE, reported only.
//   consultation with no appointment_id     → LEFT ALONE.
//
// The video path could never have written OTHERS, so an OTHERS value came from
// startConsultationFromAppointment (src/consultations/consultations.service.ts), where it
// arrives in the request body and may have been set deliberately by a doctor. Overwriting
// clinician-entered data to match a booking field is not this script's business — it is
// reported as a NOTE so a human can look, and nothing more.
//
// Dry run by default — it never writes unless you pass --apply.
//
// Usage:
//   node scripts/backfill-consultation-for.js
//   node scripts/backfill-consultation-for.js --apply
//   node scripts/backfill-consultation-for.js --apply --out=path.json
//
// Uses raw driver collections rather than a local schema copy: no second schema to keep in
// sync with src/, and no validators firing on partially-migrated rows.
//
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DB_URL = process.env.DATABASE_URL;
const BATCH_SIZE = 500;

const CONSULTATIONS = 'consultations';
const APPOINTMENTS = 'appointments';

// The misspelling is real — see the Consultation schema. It is API contract, not a typo to
// fix here. src/consultations/consultations.model.ts
const FIELD = 'consoltation_for';
const SELF = 'SELF';
const OTHERS = 'OTHERS';

// ─── Args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const outArg = argv.find((a) => a.startsWith('--out='));

const OUT_PATH = path.resolve(
    outArg
        ? outArg.slice('--out='.length)
        : path.join(
            __dirname,
            `backfill-consultation-for.${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        ),
);

// ─── Planning ────────────────────────────────────────────────────────────────
/**
 * Joins in the database rather than pulling both collections into the process. The
 * $match before the $lookup is what keeps this cheap: it uses the consultations index on
 * appointment_id and discards the overwhelming majority of rows before any join happens.
 */
function disagreementPipeline(consultationValue, appointmentValue) {
    return [
        {
            $match: {
                appointment_id: { $exists: true, $ne: null },
                [FIELD]: consultationValue,
            },
        },
        {
            $lookup: {
                from: APPOINTMENTS,
                localField: 'appointment_id',
                foreignField: '_id',
                as: 'appointment',
            },
        },
        { $unwind: '$appointment' },
        { $match: { 'appointment.appointment_for': appointmentValue } },
        {
            $project: {
                _id: 1,
                appointment_id: 1,
                [FIELD]: 1,
                appointment_number: '$appointment.appointment_number',
                appointment_for: '$appointment.appointment_for',
            },
        },
    ];
}

async function findDisagreements(db, consultationValue, appointmentValue) {
    return db
        .collection(CONSULTATIONS)
        .aggregate(disagreementPipeline(consultationValue, appointmentValue))
        .toArray();
}

// ─── Writing ─────────────────────────────────────────────────────────────────
async function applyEntries(collection, entries) {
    let matched = 0;
    let modified = 0;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const ops = batch.map((e) => ({
            updateOne: {
                // Compare-and-set on the old value: if anything rewrote this row between
                // the plan and the write, the filter misses and the fresh value stands.
                filter: {
                    _id: new mongoose.Types.ObjectId(e._id),
                    [FIELD]: SELF,
                },
                update: { $set: { [FIELD]: OTHERS } },
            },
        }));

        const res = await collection.bulkWrite(ops, { ordered: false });
        matched += res.matchedCount;
        modified += res.modifiedCount;
    }

    return { matched, modified };
}

// ─── Verification ────────────────────────────────────────────────────────────
async function verify(db, plannedCount) {
    const results = [];
    const check = (name, ok, detail) => results.push({ name, ok, detail });

    const remaining = await findDisagreements(db, SELF, OTHERS);
    check(
        'no consultation still says SELF for an OTHERS appointment',
        remaining.length === 0,
        `${remaining.length} remaining of ${plannedCount} planned`,
    );

    // Every corrected row must now agree with its appointment. Counted independently of
    // the plan so a partial write cannot pass by matching its own optimistic bookkeeping.
    const corrected = await db
        .collection(CONSULTATIONS)
        .aggregate([
            ...disagreementPipeline(OTHERS, OTHERS),
            { $count: 'n' },
        ])
        .toArray();
    check(
        'consultations agreeing on OTHERS is at least the number corrected',
        (corrected[0]?.n ?? 0) >= plannedCount,
        `${corrected[0]?.n ?? 0} agree`,
    );

    console.log('\n─── Verification ───');
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
    }

    return results.every((r) => r.ok);
}

// ─── Runner ──────────────────────────────────────────────────────────────────
async function run() {
    if (!DB_URL) throw new Error('DATABASE_URL is missing in .env');

    console.log('══════════════════════════════════════');
    console.log(`  MODE: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'}`);
    console.log(`  Target: ${CONSULTATIONS}.${FIELD}`);
    console.log('══════════════════════════════════════\n');

    mongoose.set('autoIndex', false);
    await mongoose.connect(DB_URL);
    const db = mongoose.connection.db;
    console.log(`Connected to "${db.databaseName}".`);

    // Guard against pointing at the wrong database and reporting a clean "0 to fix".
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);
    for (const required of [CONSULTATIONS, APPOINTMENTS]) {
        if (!names.includes(required)) {
            throw new Error(
                `Collection "${required}" does not exist in "${db.databaseName}". ` +
                'Check DATABASE_URL points at the right database.',
            );
        }
    }

    const totalConsultations = await db.collection(CONSULTATIONS).countDocuments({});
    const linked = await db
        .collection(CONSULTATIONS)
        .countDocuments({ appointment_id: { $exists: true, $ne: null } });
    console.log(`  ${totalConsultations} consultation(s), ${linked} linked to an appointment.\n`);

    const toFix = await findDisagreements(db, SELF, OTHERS);

    // Reported, never touched — see the SCOPE note at the top of this file.
    const inverse = await findDisagreements(db, OTHERS, SELF);

    const entries = toFix.map((doc) => ({
        collection: CONSULTATIONS,
        field: FIELD,
        _id: String(doc._id),
        appointment_id: String(doc.appointment_id),
        appointment_number: doc.appointment_number ?? null,
        action: 'CORRECT',
        old_value: SELF,
        new_value: OTHERS,
    }));

    console.log(`Rows to correct (SELF → OTHERS): ${entries.length}`);
    for (const e of entries.slice(0, 20)) {
        console.log(`  ${e._id}  appointment ${e.appointment_number ?? e.appointment_id}`);
    }
    if (entries.length > 20) console.log(`  ... and ${entries.length - 20} more`);

    if (inverse.length) {
        console.log(
            `\nNOTE  ${inverse.length} consultation(s) say OTHERS while their appointment says SELF.`,
        );
        console.log('      Left untouched — the video path could not have written OTHERS, so');
        console.log('      these came from a doctor-entered form. Review by hand if unexpected.');
        for (const d of inverse.slice(0, 20)) {
            console.log(`        ${d._id}  appointment ${d.appointment_number ?? d.appointment_id}`);
        }
    }

    // The mapping file is the rollback trail. Written before any write, so an interrupted
    // apply still leaves the record behind. .gitignore covers scripts/backfill-*.json —
    // it carries real ObjectIds.
    fs.writeFileSync(
        OUT_PATH,
        JSON.stringify(
            {
                generated_at: new Date().toISOString(),
                database: db.databaseName,
                mode: APPLY ? 'apply' : 'dry-run',
                entries,
                untouched_inverse: inverse.map((d) => ({
                    _id: String(d._id),
                    appointment_id: String(d.appointment_id),
                    consultation_value: OTHERS,
                    appointment_value: SELF,
                })),
            },
            null,
            2,
        ),
    );
    console.log(`\nMapping written to ${OUT_PATH}`);

    if (!entries.length) {
        console.log('\nNothing to correct.');
        await mongoose.disconnect();
        return true;
    }

    if (!APPLY) {
        console.log('\nDRY RUN — no writes performed. Re-run with --apply to correct these.');
        await mongoose.disconnect();
        return true;
    }

    console.log('\nApplying...');
    const res = await applyEntries(db.collection(CONSULTATIONS), entries);
    console.log(`  matched ${res.matched}/${entries.length}, modified ${res.modified}`);

    if (res.matched !== entries.length) {
        throw new Error(
            `Expected to match ${entries.length} documents but matched ${res.matched}. ` +
            'Some rows changed since the plan was built — re-run the dry run and review.',
        );
    }

    const passed = await verify(db, entries.length);
    console.log('──────────────────────────────────────');

    await mongoose.disconnect();
    return passed;
}

run()
    .then((passed) => {
        if (!passed) {
            console.error('\n❌ Verification failed — see the FAIL lines above.');
            process.exit(1);
        }
        console.log('\nDone ✅');
        process.exit(0);
    })
    .catch(async (error) => {
        console.error('\n❌ Error:', error.message || error);
        await mongoose.disconnect().catch(() => { });
        process.exit(1);
    });
