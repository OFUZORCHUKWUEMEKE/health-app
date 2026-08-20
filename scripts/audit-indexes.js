/* eslint-disable no-console */
//
// Compares every index declared in src/**/*.model.ts against what actually exists in the
// database, and exits non-zero on any drift.
//
// This is the general form of a bug that hit this codebase twice: doctors.doctor_no and
// users.registration_no were both declared `unique: true, required: true` while the
// matching index was absent, because rows with no value collided as nulls under a
// non-sparse unique index and mongoose swallowed the resulting E11000 on every boot.
// src/database/index-error-logger.ts makes that failure audible at runtime; this script
// answers the standing question "is the database actually enforcing what the schemas
// claim?" without needing to catch a boot in the act.
//
// READ-ONLY — it never creates, drops, or modifies anything.
//
// Reads compiled schemas from dist/, so build first:
//   npm run build && node scripts/audit-indexes.js
//
// Exit codes: 0 = no drift, 1 = drift found (suitable for CI).
//
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DB_URL = process.env.DATABASE_URL;

// `nest build` emits dist/main.js (rootDir collapses to src/), but a plain
// `tsc -p tsconfig.json` emits dist/src/main.js because the project also includes files
// outside src/. Accept whichever layout is on disk rather than guessing.
const DIST = [
    path.join(__dirname, '..', 'dist', 'src'),
    path.join(__dirname, '..', 'dist'),
].find((p) => fs.existsSync(p));

function findModels(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) findModels(p, acc);
        else if (entry.name.endsWith('.model.js')) acc.push(p);
    }
    return acc;
}

// Mongoose's default collection name for a model, used when @Schema omits `collection`.
function defaultCollectionName(exportName) {
    return mongoose.pluralize()(exportName.replace(/Schema$/, ''));
}

// Stable string form of an index key, so {a:1,b:1} compares equal regardless of source.
function keyOf(key) {
    return Object.entries(key).map(([field, dir]) => `${field}:${dir}`).join(',');
}

async function run() {
    if (!DB_URL) throw new Error('DATABASE_URL is missing in .env');
    if (!DIST) {
        throw new Error('No dist/ directory found — run "npm run build" first.');
    }

    // Never let the audit itself build an index; it only observes.
    mongoose.set('autoIndex', false);
    await mongoose.connect(DB_URL);
    const db = mongoose.connection.db;
    console.log(`database: ${db.databaseName}\n`);

    const live = {};
    for (const c of await db.listCollections().toArray()) {
        live[c.name] = await db.collection(c.name).listIndexes().toArray();
    }

    const problems = [];

    for (const file of findModels(DIST).sort()) {
        let mod;
        try {
            mod = require(file);
        } catch (error) {
            console.log(`SKIP ${path.relative(DIST, file)} — ${error.message}`);
            continue;
        }

        for (const [exportName, value] of Object.entries(mod)) {
            if (!value || !value.instanceOfSchema) continue;

            const collectionName = value.options.collection || defaultCollectionName(exportName);
            const declared = value.indexes();
            const actual = live[collectionName];

            console.log(`${path.relative(DIST, file)}  →  ${exportName}  →  "${collectionName}"`);

            if (!actual) {
                // Not drift: mongo creates the collection on first write, and an index on
                // a collection with no documents enforces nothing yet either way.
                console.log('  collection does not exist yet — nothing to compare\n');
                continue;
            }

            for (const [key, opts] of declared) {
                const wantKey = keyOf(key);
                const wantUnique = !!opts.unique;
                const wantSparse = !!opts.sparse;
                const match = actual.find((i) => keyOf(i.key) === wantKey);

                if (!match) {
                    console.log(`  MISSING  {${wantKey}} unique=${wantUnique} sparse=${wantSparse}`);
                    problems.push({ collectionName, wantKey, issue: 'declared index missing from database' });
                } else if (!!match.unique !== wantUnique || !!match.sparse !== wantSparse) {
                    console.log(
                        `  MISMATCH {${wantKey}} declared unique=${wantUnique} sparse=${wantSparse} ` +
                        `but live unique=${!!match.unique} sparse=${!!match.sparse}`,
                    );
                    problems.push({ collectionName, wantKey, issue: 'live options differ from schema' });
                } else {
                    console.log(`  ok       {${wantKey}} unique=${wantUnique} sparse=${wantSparse}`);
                }
            }
            console.log('');
        }
    }

    console.log('══════════════════════════════════════');
    if (!problems.length) {
        console.log('No drift: every declared index exists with the declared options.');
    } else {
        console.log(`${problems.length} problem(s) — the database is NOT enforcing what the schemas claim:`);
        for (const p of problems) {
            const rows = await db.collection(p.collectionName).countDocuments({});
            console.log(`  ${p.collectionName} {${p.wantKey}} — ${p.issue}  (${rows} rows)`);
        }
        console.log('\nFor a missing unique index on a required identifier, see scripts/backfill-identifier.js.');
    }
    console.log('══════════════════════════════════════');

    await mongoose.disconnect();
    return problems.length === 0;
}

run()
    .then((clean) => process.exit(clean ? 0 : 1))
    .catch(async (error) => {
        console.error('\n❌ Error:', error.message || error);
        await mongoose.disconnect().catch(() => { });
        process.exit(1);
    });
