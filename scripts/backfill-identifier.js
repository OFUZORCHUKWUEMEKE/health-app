/* eslint-disable no-console */
//
// Backfills a required-unique identifier field and installs the index the schema has
// always claimed.
//
// Two schemas declare an identifier as `unique: true, required: true` while the matching
// index is absent from the database:
//
//   doctors.doctor_no        (src/doctors/doctors.model.ts)
//   users.registration_no    (src/users/user.model.ts)
//
// In both cases rows predating the field have no value at all. A non-sparse unique index
// reads every one of those as null, so they collide with each other and the build fails
// with E11000. Mongoose builds schema indexes via `model.init().catch(noop)` — and that
// no-op catch sets `$caught`, which suppresses the model 'error' event — so the failure
// is swallowed on every boot and the uniqueness constraint is not actually enforced.
//
// This closes that gap: give every row a value, then build the index and assert it landed
// rather than trusting autoIndex. src/database/index-error-logger.ts makes the next such
// failure visible instead of silent.
//
// Dry run by default — it never writes unless you pass --apply.
//
// Usage:
//   node scripts/backfill-identifier.js --target=doctor-no
//   node scripts/backfill-identifier.js --target=registration-no --apply
//   node scripts/backfill-identifier.js --target=all
//   node scripts/backfill-identifier.js --target=all --out=path.json
//
// Uses raw driver collections rather than a local schema copy: no second schema to keep
// in sync with src/, and no validators firing on partially-migrated rows.
//
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DB_URL = process.env.DATABASE_URL;
const BATCH_SIZE = 500;

// Each target mirrors a `@Prop({ type: String, unique: true, required: true })` field and
// the `PREFIX-${Date.now().toString(36).toUpperCase()}-${GenerateRandomString(4).toUpperCase()}`
// format its application code already uses.
const TARGETS = {
    'doctor-no': {
        collection: 'doctors',
        field: 'doctor_no',
        prefix: 'DOC',
        indexName: 'doctor_no_1',
        // src/auth/auth.service.ts doctorSignup, src/admin/admin.service.ts createDoctor
        label: 'doctors.doctor_no',
    },
    'registration-no': {
        collection: 'users',
        field: 'registration_no',
        prefix: 'PAT',
        indexName: 'registration_no_1',
        // src/auth/auth.service.ts patient signup paths
        label: 'users.registration_no',
    },
};

// ─── Args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const outArg = argv.find((a) => a.startsWith('--out='));
const targetArg = argv.find((a) => a.startsWith('--target='));

if (!targetArg) {
    console.error(`--target is required. One of: ${Object.keys(TARGETS).join(', ')}, all`);
    process.exit(1);
}

const targetKey = targetArg.slice('--target='.length);
const selected =
    targetKey === 'all'
        ? Object.values(TARGETS)
        : TARGETS[targetKey]
            ? [TARGETS[targetKey]]
            : null;

if (!selected) {
    console.error(`Unknown target "${targetKey}". One of: ${Object.keys(TARGETS).join(', ')}, all`);
    process.exit(1);
}

const OUT_PATH = path.resolve(
    outArg
        ? outArg.slice('--out='.length)
        : path.join(__dirname, `backfill-identifier.${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
);

// ─── Generation ──────────────────────────────────────────────────────────────
// GenerateRandomString from src/utils/code-generator.util.ts. Its alphabet is mixed case,
// but every caller uppercases the result, so the effective alphabet is 36 chars.
function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

// Date.now() is constant across a single run, so the 4-char suffix is doing all the
// distinguishing work. Check against the taken-set rather than assuming.
function allocateUnique(prefix, taken) {
    for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = `${prefix}-${Date.now().toString(36).toUpperCase()}-${generateRandomString(4).toUpperCase()}`;
        if (!taken.has(candidate)) {
            taken.add(candidate);
            return candidate;
        }
    }
    throw new Error(`Could not allocate a unique ${prefix} identifier after 100 attempts`);
}

function formatRegex(prefix) {
    return new RegExp(`^${prefix}-[0-9A-Z]+-[0-9A-Z]{4}$`);
}

// Matches a document with no usable value: field absent, null, or blank.
function missingFilter(field) {
    return { $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] };
}

// ─── Planning ────────────────────────────────────────────────────────────────
/**
 * Deliberately does NOT regenerate values that are merely off-format. Existing
 * identifiers are handed out to real people and may be printed on records; the
 * duplicate-null collision is the bug, an unusual format is not.
 */
function planFor(target, docs, taken) {
    const entries = [];
    for (const doc of docs) {
        const value = doc[target.field];
        if (typeof value === 'string' && value.trim() !== '') continue;

        entries.push({
            collection: target.collection,
            field: target.field,
            _id: String(doc._id),
            email: doc.email ?? null,
            action: 'ASSIGN',
            old_value: value ?? null,
            new_value: allocateUnique(target.prefix, taken),
        });
    }
    return entries;
}

// ─── Writing ─────────────────────────────────────────────────────────────────
async function applyEntries(collection, target, entries) {
    let matched = 0;
    let modified = 0;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const ops = batch.map((e) => ({
            updateOne: {
                // Compare-and-set: if the live app issued a value to this row since we
                // read it, the filter misses and we leave the fresh value alone.
                filter: {
                    _id: new mongoose.Types.ObjectId(e._id),
                    ...missingFilter(target.field),
                },
                update: { $set: { [target.field]: e.new_value } },
            },
        }));

        const res = await collection.bulkWrite(ops, { ordered: false });
        matched += res.matchedCount;
        modified += res.modifiedCount;
    }

    return { matched, modified };
}

async function ensureIndex(collection, target) {
    // Non-sparse, matching `@Prop({ unique: true, required: true })`. A sparse index would
    // build cleanly over missing values and hide exactly the drift this script exists to
    // fix — and it would not match the schema, so autoIndex would keep trying to reconcile
    // it on every boot.
    try {
        await collection.createIndex({ [target.field]: 1 }, { unique: true, name: target.indexName });
    } catch (error) {
        if (error.code === 11000) {
            console.error(`\n❌ ${target.label}: duplicate value blocked the unique index build.`);
            console.error(`   ${error.message}`);
            console.error(`   The mapping file at ${OUT_PATH} is the repair trail.`);
        } else if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
            console.error(`\n❌ ${target.indexName} already exists with different options.`);
            console.error(`   ${error.message}`);
            console.error(`   Drop it and re-run: db.${target.collection}.dropIndex('${target.indexName}')`);
        }
        throw error;
    }

    // Do not trust createIndex resolving — read the index back.
    const indexes = await collection.listIndexes().toArray();
    const idx = indexes.find((i) => i.name === target.indexName);
    if (!idx) throw new Error(`${target.indexName} missing after createIndex`);
    if (!idx.unique) throw new Error(`${target.indexName} exists but is not unique`);
    if (idx.sparse) {
        throw new Error(`${target.indexName} is sparse; the schema declares a non-sparse unique index`);
    }
    return idx;
}

// ─── Verification ────────────────────────────────────────────────────────────
async function verify(db, target) {
    const collection = db.collection(target.collection);
    const results = [];
    const check = (name, ok, detail) => results.push({ name, ok, detail });

    const missing = await collection.countDocuments(missingFilter(target.field));
    check(`${target.label}: every row has a value`, missing === 0, `${missing} missing`);

    const total = await collection.countDocuments({});
    const distinct = (await collection.distinct(target.field)).length;
    check(`${target.label}: values are unique`, total === distinct, `${total} rows, ${distinct} distinct`);

    const indexes = await collection.listIndexes().toArray();
    const idx = indexes.find((i) => i.name === target.indexName);
    check(
        `${target.label}: ${target.indexName} exists, unique, non-sparse`,
        Boolean(idx && idx.unique && !idx.sparse),
        idx ? `unique=${!!idx.unique} sparse=${!!idx.sparse}` : 'ABSENT',
    );

    console.log(`\n─── Verification: ${target.label} ───`);
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
    }

    // Reported, never gated. This script does not renumber a row that already has a value,
    // so an off-format legacy value is a fact to notice, not a failure — the invariants
    // that matter (present, unique, indexed) are the checks above.
    const re = formatRegex(target.prefix);
    const offFormat = await collection.countDocuments({ [target.field]: { $not: re } });
    console.log(`  NOTE  ${offFormat} value(s) do not match ${re}`);

    return results.every((r) => r.ok);
}

// ─── Runner ──────────────────────────────────────────────────────────────────
async function run() {
    if (!DB_URL) throw new Error('DATABASE_URL is missing in .env');

    console.log('══════════════════════════════════════');
    console.log(`  MODE: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'}`);
    console.log(`  Targets: ${selected.map((t) => t.label).join(', ')}`);
    console.log('══════════════════════════════════════\n');

    // Don't let mongoose try to rebuild schema indexes on connect.
    mongoose.set('autoIndex', false);
    await mongoose.connect(DB_URL);
    const db = mongoose.connection.db;
    console.log(`Connected to "${db.databaseName}".\n`);

    const allEntries = [];
    const indexesBefore = {};

    for (const target of selected) {
        const collection = db.collection(target.collection);

        const before = await collection.listIndexes().toArray();
        indexesBefore[target.label] = before.map((i) => ({
            name: i.name,
            unique: !!i.unique,
            sparse: !!i.sparse,
        }));

        console.log(`${target.label}`);
        console.log(`  indexes before: ${before.map((i) => i.name).join(', ')}`);
        if (!before.some((i) => i.name === target.indexName)) {
            console.log(`  → ${target.indexName} is ABSENT: uniqueness is not enforced right now.`);
        }

        const docs = await collection
            .find({}, { projection: { _id: 1, email: 1, [target.field]: 1 } })
            .toArray();

        const taken = new Set(
            docs.map((d) => d[target.field]).filter((v) => typeof v === 'string' && v.trim() !== ''),
        );

        // Pre-flight: if two rows already share a real value, the backfill cannot fix it
        // and the index build will fail. Surface it now rather than after writing.
        const existingDupes = await collection
            .aggregate([
                { $match: { [target.field]: { $type: 'string', $ne: '' } } },
                { $group: { _id: `$${target.field}`, n: { $sum: 1 }, emails: { $push: '$email' } } },
                { $match: { n: { $gt: 1 } } },
            ])
            .toArray();

        if (existingDupes.length) {
            console.error(`\n❌ ${target.label}: ${existingDupes.length} duplicate group(s) among existing values:`);
            for (const d of existingDupes) console.error(`   ${d._id} x${d.n} → ${d.emails.join(', ')}`);
            throw new Error(
                `${target.label}: existing values collide. Resolve these by hand first — this ` +
                `script only fills in missing values and will not renumber a live record.`,
            );
        }

        const entries = planFor(target, docs, taken);
        console.log(`  ${entries.length} assign / ${docs.length - entries.length} skip  (of ${docs.length})`);
        for (const e of entries.slice(0, 20)) {
            console.log(`    ASSIGN  (none) → ${e.new_value}  ${e.email ?? ''}`);
        }
        if (entries.length > 20) console.log(`    ... and ${entries.length - 20} more`);
        console.log('');

        allEntries.push({ target, entries });
    }

    // Always write the mapping BEFORE mutating — dry run included. This is the only record
    // of which row got which value and the basis for a rollback.
    const mapping = {
        generated_at: new Date().toISOString(),
        database: db.databaseName, // name only — never the connection URI
        mode: APPLY ? 'apply' : 'dry-run',
        indexes_before: indexesBefore,
        entries: allEntries.flatMap((a) => a.entries),
    };
    fs.writeFileSync(OUT_PATH, JSON.stringify(mapping, null, 2));
    console.log(`Mapping written to:\n  ${OUT_PATH}`);

    if (!APPLY) {
        console.log('\nDry run only — no documents were modified and no index was created.');
        console.log('Re-run with --apply to write these changes.');
        await mongoose.disconnect();
        return true;
    }

    console.log('\nApplying...');
    for (const { target, entries } of allEntries) {
        if (!entries.length) {
            console.log(`  ${target.label}: nothing to write — every row already has a value.`);
            continue;
        }
        const r = await applyEntries(db.collection(target.collection), target, entries);
        console.log(`  ${target.label}: matched ${r.matched}/${entries.length}, modified ${r.modified}`);
        if (r.matched !== entries.length) {
            throw new Error(
                `${target.label}: expected to match ${entries.length} documents but matched ${r.matched}. ` +
                `Some rows changed since the plan was built — re-run the dry run and review.`,
            );
        }
    }

    // Index last, so a bad backfill surfaces as E11000 instead of being tolerated.
    console.log('\nEnsuring indexes...');
    for (const { target } of allEntries) {
        await ensureIndex(db.collection(target.collection), target);
        console.log(`  ${target.label}: ${target.indexName} unique ✔`);
    }

    let passed = true;
    for (const { target } of allEntries) {
        passed = (await verify(db, target)) && passed;
    }
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
