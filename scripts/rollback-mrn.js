/* eslint-disable no-console */
//
// Reverts an MRN backfill using the mapping file that backfill-mrn.js wrote BEFORE it
// mutated anything.
//
// Dry run by default — it never writes unless you pass --apply.
//
// Usage:
//   node scripts/rollback-mrn.js --file=scripts/backfill-mrn.<stamp>.json
//   node scripts/rollback-mrn.js --file=... --apply
//
// Rows are reverted with a compare-and-set filter on the NEW value, so anything changed
// since the backfill is skipped rather than clobbered. Entries whose old_mrn was null
// get the field unset, returning them to their pre-backfill state.
//
// The registry is reconciled afterwards, and asymmetrically on purpose:
//   - restored old MRNs are REGISTERED, because the app must not hand them out again
//   - rolled-back new MRNs keep their rows but lose their owner, because those values
//     were live for a while and must stay retired
// So a backfill + rollback leaves the registry larger than it started. That is correct:
// it is a record of what has ever been issued, not a mirror of what is currently held.
//
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { REGISTRY_COLLECTION, readHeldMrns, registry, syncRegistry } = require('./lib/mrn');

const DB_URL = process.env.DATABASE_URL;
const BATCH_SIZE = 500;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const fileArg = argv.find((a) => a.startsWith('--file='));

if (!fileArg) {
    throw new Error('Missing --file=<mapping.json> (the file backfill-mrn.js wrote)');
}
const FILE_PATH = path.resolve(fileArg.slice('--file='.length));

async function revert(collection, entries) {
    let matched = 0;
    let modified = 0;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const ops = batch.map((e) => ({
            updateOne: {
                filter: { _id: new mongoose.Types.ObjectId(e._id), mrn: e.new_mrn },
                update: e.old_mrn ? { $set: { mrn: e.old_mrn } } : { $unset: { mrn: 1 } },
            },
        }));

        const res = await collection.bulkWrite(ops, { ordered: false });
        matched += res.matchedCount;
        modified += res.modifiedCount;
    }

    return { matched, modified };
}

async function run() {
    if (!DB_URL) {
        throw new Error('DATABASE_URL is missing in .env');
    }
    if (!fs.existsSync(FILE_PATH)) {
        throw new Error(`Mapping file not found: ${FILE_PATH}`);
    }

    const mapping = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    const entries = mapping.entries || [];

    console.log('══════════════════════════════════════');
    console.log(`  MODE: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'}`);
    console.log(`  Mapping : ${FILE_PATH}`);
    console.log(`  Recorded: ${mapping.generated_at} against "${mapping.database}" (${mapping.mode})`);
    console.log(`  Entries : ${entries.length}`);
    console.log('══════════════════════════════════════\n');

    if (mapping.mode === 'dry-run') {
        console.log('⚠  This mapping came from a DRY RUN, so those values were never written.');
        console.log('   Rolling it back should match nothing. Continuing anyway.\n');
    }

    mongoose.set('autoIndex', false);
    await mongoose.connect(DB_URL);
    const db = mongoose.connection.db;
    console.log(`Connected to "${db.databaseName}".`);

    if (db.databaseName !== mapping.database) {
        throw new Error(
            `Refusing to run: mapping was recorded against "${mapping.database}" but ` +
            `DATABASE_URL points at "${db.databaseName}".`,
        );
    }

    const byCollection = {};
    for (const e of entries) {
        (byCollection[e.collection] ||= []).push(e);
    }

    for (const [name, rows] of Object.entries(byCollection)) {
        const restore = rows.filter((r) => r.old_mrn).length;
        console.log(`\n${name}: ${restore} restore, ${rows.length - restore} unset`);
        for (const e of rows.slice(0, 5)) {
            console.log(`  ${e.new_mrn} → ${e.old_mrn ?? '(unset)'}  ${e.email ?? ''}`);
        }
        if (rows.length > 5) console.log(`  ... and ${rows.length - 5} more`);
    }

    if (!APPLY) {
        console.log('\nDry run only — no documents were modified.');
        console.log('Re-run with --apply to revert these changes.');
        await mongoose.disconnect();
        return;
    }

    console.log('\nReverting...');
    for (const [name, rows] of Object.entries(byCollection)) {
        const res = await revert(db.collection(name), rows);
        console.log(`  ${name}: matched ${res.matched}/${rows.length}, modified ${res.modified}`);
        if (res.matched !== rows.length) {
            console.warn(
                `  ⚠ ${rows.length - res.matched} row(s) no longer held the backfilled value ` +
                `and were left untouched.`,
            );
        }
    }

    console.log('\nReconciling registry...');

    // Detach, don't delete. These MRNs were issued and are now unheld — retiring them is
    // the point. Scoped to rows nobody holds, so a value the revert skipped (because the
    // row had changed since the backfill) keeps its owner.
    const held = await readHeldMrns(db);
    const stillHeld = new Set(held.map((h) => h.mrn));
    const rolledBack = entries.map((e) => e.new_mrn).filter((m) => m && !stillHeld.has(m));

    const detached = rolledBack.length
        ? await registry(db).updateMany(
            { mrn: { $in: rolledBack }, owner_id: { $ne: null } },
            { $set: { owner_id: null, updatedAt: new Date() } },
        )
        : { modifiedCount: 0 };
    console.log(`  ${detached.modifiedCount} retired (row kept, owner cleared)`);

    // Restored old MRNs are back in circulation on real accounts, so they must be
    // registered or the app is free to issue them to someone else.
    const sync = await syncRegistry(db, held, { apply: true });
    console.log(`  ${sync.inserted} registered, ${sync.attached} owner(s) attached  (of ${held.length} held)`);
    if (sync.conflicts.length) {
        console.error(`  ⚠ ${sync.conflicts.length} conflict(s) in ${REGISTRY_COLLECTION} — resolve by hand:`);
        for (const c of sync.conflicts) console.error(`    ${JSON.stringify(c)}`);
    }

    await mongoose.disconnect();
}

run()
    .then(() => {
        console.log('\nDone ✅');
        process.exit(0);
    })
    .catch(async (error) => {
        console.error('\n❌ Error:', error.message || error);
        await mongoose.disconnect().catch(() => { });
        process.exit(1);
    });
