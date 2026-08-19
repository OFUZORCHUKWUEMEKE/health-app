/* eslint-disable no-console */
//
// Backfills the shared MRN namespace (C-XXXXXX) across doctors and patients.
//
// Dry run by default — it never writes unless you pass --apply.
//
// Usage:
//   node scripts/backfill-mrn.js                 # plan only, writes a mapping file
//   node scripts/backfill-mrn.js --apply         # plan, then write
//   node scripts/backfill-mrn.js --keep-legacy   # leave old-format MRNs alone
//   node scripts/backfill-mrn.js --doctors-only  # or --patients-only
//   node scripts/backfill-mrn.js --out=path.json
//
// Uses raw driver collections rather than a local schema copy: no third schema to keep
// in sync with src/, and no validators firing on partially-migrated rows.
//
// Also seeds the mrn_registry collection, which is what enforces cross-collection
// uniqueness at runtime. The registry is derived from the collections, never the
// reverse: MRNs are assigned to doctors/users first, then registered. Scoping flags
// (--doctors-only / --patients-only) do NOT scope the registry sync — the namespace is
// shared, so a partial run must still register everything it can see.
//
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
    MRN_REGEX,
    REGISTRY_COLLECTION,
    allocateUniqueMrn,
    ensureRegistryIndex,
    readHeldMrns,
    registry,
    syncRegistry,
} = require('./lib/mrn');

const DB_URL = process.env.DATABASE_URL;
const BATCH_SIZE = 500;

// ─── Args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const KEEP_LEGACY = argv.includes('--keep-legacy');
const DOCTORS_ONLY = argv.includes('--doctors-only');
const PATIENTS_ONLY = argv.includes('--patients-only');
const outArg = argv.find((a) => a.startsWith('--out='));

if (DOCTORS_ONLY && PATIENTS_ONLY) {
    throw new Error('--doctors-only and --patients-only are mutually exclusive');
}

const DO_DOCTORS = !PATIENTS_ONLY;
const DO_PATIENTS = !DOCTORS_ONLY;

const OUT_PATH = path.resolve(
    outArg
        ? outArg.slice('--out='.length)
        : path.join(__dirname, `backfill-mrn.${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
);

// ─── Planning ────────────────────────────────────────────────────────────────
/**
 * SKIP   — already in the new format (this is what makes reruns idempotent)
 * ASSIGN — no MRN at all
 * REGEN  — has an MRN in some other format
 *
 * Classified by regex rather than length, so a second run recognises its own output.
 */
function classify(doc) {
    if (!doc.mrn) return 'ASSIGN';
    if (MRN_REGEX.test(doc.mrn)) return 'SKIP';
    return KEEP_LEGACY ? 'SKIP' : 'REGEN';
}

function planFor(collectionName, docs, identifierField, taken) {
    const entries = [];
    for (const doc of docs) {
        const action = classify(doc);
        if (action === 'SKIP') continue;

        entries.push({
            collection: collectionName,
            _id: String(doc._id),
            email: doc.email ?? null,
            identifier: doc[identifierField] ?? null,
            action,
            old_mrn: doc.mrn ?? null,
            new_mrn: allocateUniqueMrn(taken),
        });
    }
    return entries;
}

function summarise(entries, total) {
    const assign = entries.filter((e) => e.action === 'ASSIGN').length;
    const regen = entries.filter((e) => e.action === 'REGEN').length;
    return { total, assign, regen, skip: total - assign - regen };
}

// ─── Writing ─────────────────────────────────────────────────────────────────
async function applyEntries(collection, entries) {
    let matched = 0;
    let modified = 0;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const ops = batch.map((e) => ({
            updateOne: {
                // Compare-and-set: if the live app issued an MRN to this row since we
                // read it, the filter misses and we leave the fresh value alone.
                filter:
                    e.action === 'REGEN'
                        ? { _id: new mongoose.Types.ObjectId(e._id), mrn: e.old_mrn }
                        : { _id: new mongoose.Types.ObjectId(e._id), mrn: { $exists: false } },
                update: { $set: { mrn: e.new_mrn } },
            },
        }));

        const res = await collection.bulkWrite(ops, { ordered: false });
        matched += res.matchedCount;
        modified += res.modifiedCount;
    }

    return { matched, modified };
}

async function ensureIndex(collection, label) {
    try {
        await collection.createIndex({ mrn: 1 }, { unique: true, sparse: true, name: 'mrn_1' });
    } catch (error) {
        if (error.code === 11000) {
            console.error(`\n❌ ${label}: duplicate MRN blocked the unique index build.`);
            console.error(`   ${error.message}`);
            console.error(`   The mapping file at ${OUT_PATH} is the repair trail.`);
        }
        throw error;
    }

    const indexes = await collection.listIndexes().toArray();
    const mrnIndex = indexes.find((i) => i.name === 'mrn_1');
    if (!mrnIndex || !mrnIndex.unique) {
        throw new Error(`${label}: mrn_1 unique index missing after createIndex`);
    }
    return mrnIndex;
}

// ─── Verification ────────────────────────────────────────────────────────────
async function verify(db) {
    const results = [];
    const check = (name, ok, detail) => results.push({ name, ok, detail });

    const targets = [];
    if (DO_DOCTORS) targets.push(['doctors', db.collection('doctors')]);
    if (DO_PATIENTS) targets.push(['users', db.collection('users')]);

    for (const [name, collection] of targets) {
        const missing = await collection.countDocuments({ mrn: { $exists: false } });
        check(`${name}: every document has an mrn`, missing === 0, `${missing} missing`);

        const malformed = await collection.countDocuments({ mrn: { $not: MRN_REGEX } });
        check(`${name}: every mrn matches ${MRN_REGEX}`, malformed === 0, `${malformed} malformed`);

        const indexes = await collection.listIndexes().toArray();
        const idx = indexes.find((i) => i.name === 'mrn_1');
        check(`${name}: mrn_1 exists and is unique`, Boolean(idx && idx.unique), idx ? 'present' : 'ABSENT');
    }

    // Cross-collection uniqueness always covers both, regardless of --*-only scoping:
    // the namespace is shared, so a partial run still must not create an overlap.
    const doctorMrns = await db.collection('doctors').distinct('mrn');
    const userMrns = await db.collection('users').distinct('mrn');
    const combined = doctorMrns.length + userMrns.length;
    const distinct = new Set([...doctorMrns, ...userMrns]).size;
    check(
        'mrn is unique across doctors + users',
        combined === distinct,
        `${combined} values, ${distinct} distinct`,
    );

    // ─── Registry ────────────────────────────────────────────────────────────
    // The check above is a point-in-time observation. These are about the thing that
    // keeps it true going forward.
    const registryIndexes = await registry(db).listIndexes().toArray();
    const registryIdx = registryIndexes.find((i) => i.name === 'mrn_1');
    check(
        `${REGISTRY_COLLECTION}: mrn_1 exists and is unique`,
        Boolean(registryIdx && registryIdx.unique),
        registryIdx ? 'present' : 'ABSENT',
    );

    const held = await readHeldMrns(db);
    const registered = new Set((await registry(db).distinct('mrn')).map(String));
    const unregistered = held.filter((h) => !registered.has(h.mrn));
    check(
        `${REGISTRY_COLLECTION}: every held mrn is registered`,
        unregistered.length === 0,
        unregistered.length === 0
            ? `${held.length} held, all registered`
            : `${unregistered.length} unregistered: ${unregistered.slice(0, 5).map((h) => h.mrn).join(', ')}`,
    );

    // An unclaimed row is fine on its own (a reservation whose signup failed), but one
    // whose MRN *is* held means claim() never ran — worth surfacing, not failing on.
    const unclaimedButHeld = await registry(db).countDocuments({
        owner_id: null,
        mrn: { $in: held.map((h) => h.mrn) },
    });
    check(
        `${REGISTRY_COLLECTION}: every held mrn's row records its owner`,
        unclaimedButHeld === 0,
        `${unclaimedButHeld} held rows still unclaimed`,
    );

    console.log('\n─── Verification ─────────────────────');
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
    }
    console.log('──────────────────────────────────────');

    return results.every((r) => r.ok);
}

// ─── Runner ──────────────────────────────────────────────────────────────────
async function run() {
    if (!DB_URL) {
        throw new Error('DATABASE_URL is missing in .env');
    }

    console.log('══════════════════════════════════════');
    console.log(`  MODE: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'}`);
    console.log(`  Scope: ${DO_DOCTORS ? 'doctors ' : ''}${DO_PATIENTS ? 'users' : ''}`);
    console.log(`  Legacy MRNs: ${KEEP_LEGACY ? 'kept as-is' : 'regenerated'}`);
    console.log('══════════════════════════════════════\n');

    // Don't let mongoose try to rebuild schema indexes on connect.
    mongoose.set('autoIndex', false);
    await mongoose.connect(DB_URL);
    const db = mongoose.connection.db;
    console.log(`Connected to "${db.databaseName}".\n`);

    const doctors = db.collection('doctors');
    const users = db.collection('users');

    // Seed the taken-set from BOTH collections regardless of scope — the namespace is
    // shared, so a --doctors-only run still must not collide with a patient MRN.
    const [allDoctors, allUsers] = await Promise.all([
        doctors.find({}, { projection: { _id: 1, email: 1, doctor_no: 1, mrn: 1 } }).toArray(),
        users.find({}, { projection: { _id: 1, email: 1, registration_no: 1, mrn: 1 } }).toArray(),
    ]);

    const taken = new Set(
        [...allDoctors, ...allUsers].map((d) => d.mrn).filter((m) => typeof m === 'string' && m.length > 0),
    );

    const entries = [];
    if (DO_DOCTORS) entries.push(...planFor('doctors', allDoctors, 'doctor_no', taken));
    if (DO_PATIENTS) entries.push(...planFor('users', allUsers, 'registration_no', taken));

    const doctorEntries = entries.filter((e) => e.collection === 'doctors');
    const userEntries = entries.filter((e) => e.collection === 'users');

    if (DO_DOCTORS) {
        const s = summarise(doctorEntries, allDoctors.length);
        console.log(`doctors : ${s.assign} assign / ${s.regen} regenerate / ${s.skip} skip  (of ${s.total})`);
    }
    if (DO_PATIENTS) {
        const s = summarise(userEntries, allUsers.length);
        console.log(`users   : ${s.assign} assign / ${s.regen} regenerate / ${s.skip} skip  (of ${s.total})`);
    }

    console.log('\nFirst rows of the plan:');
    for (const e of entries.slice(0, 10)) {
        console.log(`  ${e.collection.padEnd(8)} ${e.action.padEnd(6)} ${e.old_mrn ?? '(none)'} → ${e.new_mrn}  ${e.email ?? ''}`);
    }
    if (entries.length > 10) console.log(`  ... and ${entries.length - 10} more`);

    // Registry preview. Counted against what is held RIGHT NOW, so it does not include
    // the MRNs this run is about to assign — those are the `entries` above, and every
    // one of them gets registered too. Reported separately to keep the distinction.
    const heldNow = await readHeldMrns(db);
    const preview = await syncRegistry(db, heldNow, { apply: false });
    console.log(
        `\nregistry: ${preview.existing} rows, ${preview.toInsert.length} held MRNs unregistered, ` +
        `${preview.toAttach.length} to attach an owner, + ${entries.length} from this plan`,
    );
    if (preview.conflicts.length) {
        console.log(`  ⚠ ${preview.conflicts.length} conflict(s) — the registry disagrees with the collections:`);
        for (const c of preview.conflicts.slice(0, 5)) console.log(`    ${JSON.stringify(c)}`);
    }

    // Always write the mapping BEFORE mutating — dry run included. This is the only
    // record of the old→new values and the basis for a rollback.
    const mapping = {
        generated_at: new Date().toISOString(),
        database: db.databaseName, // name only — never the connection URI
        mode: APPLY ? 'apply' : 'dry-run',
        keep_legacy: KEEP_LEGACY,
        counts: {
            doctors: DO_DOCTORS ? summarise(doctorEntries, allDoctors.length) : null,
            users: DO_PATIENTS ? summarise(userEntries, allUsers.length) : null,
        },
        entries,
    };
    fs.writeFileSync(OUT_PATH, JSON.stringify(mapping, null, 2));
    console.log(`\nMapping written to:\n  ${OUT_PATH}`);

    if (!APPLY) {
        console.log('\nDry run only — no documents were modified.');
        console.log('Re-run with --apply to write these changes.');
        await mongoose.disconnect();
        return true;
    }

    if (entries.length === 0) {
        console.log('\nNothing to write — already in sync.');
    } else {
        console.log('\nApplying...');
        if (doctorEntries.length) {
            const r = await applyEntries(doctors, doctorEntries);
            console.log(`  doctors : matched ${r.matched}/${doctorEntries.length}, modified ${r.modified}`);
            if (r.matched !== doctorEntries.length) {
                throw new Error(
                    `doctors: expected to match ${doctorEntries.length} documents but matched ${r.matched}. ` +
                    `Some rows changed since the plan was built — re-run the dry run and review.`,
                );
            }
        }
        if (userEntries.length) {
            const r = await applyEntries(users, userEntries);
            console.log(`  users   : matched ${r.matched}/${userEntries.length}, modified ${r.modified}`);
            if (r.matched !== userEntries.length) {
                throw new Error(
                    `users: expected to match ${userEntries.length} documents but matched ${r.matched}. ` +
                    `Some rows changed since the plan was built — re-run the dry run and review.`,
                );
            }
        }
    }

    // Index last, so a bad backfill surfaces as E11000 instead of being tolerated.
    console.log('\nEnsuring indexes...');
    if (DO_DOCTORS) {
        await ensureIndex(doctors, 'doctors');
        console.log('  doctors : mrn_1 unique+sparse ✔');
    }
    if (DO_PATIENTS) {
        await ensureIndex(users, 'users');
        console.log('  users   : mrn_1 unique+sparse ✔');
    }
    await ensureRegistryIndex(db);
    console.log(`  ${REGISTRY_COLLECTION.padEnd(7)} : mrn_1 unique ✔`);

    // Registry sync runs AFTER the collections are written and indexed, so it registers
    // final values — including the ones this run just assigned. Re-read rather than
    // reusing the plan: that also picks up MRNs written by earlier partial runs.
    console.log('\nSyncing registry...');
    const held = await readHeldMrns(db);
    const sync = await syncRegistry(db, held, { apply: true });
    console.log(`  ${sync.inserted} registered, ${sync.attached} owner(s) attached  (of ${held.length} held)`);
    if (sync.conflicts.length) {
        console.error(`  ⚠ ${sync.conflicts.length} conflict(s) left untouched — resolve by hand:`);
        for (const c of sync.conflicts) console.error(`    ${JSON.stringify(c)}`);
    }

    const passed = await verify(db);
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
