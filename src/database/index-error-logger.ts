import { Logger } from '@nestjs/common';

const logger = new Logger('MongooseIndexes');

/**
 * Make failed index builds visible.
 *
 * Mongoose builds the indexes declared on a schema by calling
 * `model.init().catch(noop)` — and that no-op catch sets `$caught`, which in turn
 * suppresses the model's 'error' event. So when a build fails (say a unique index over
 * a field that already holds duplicates) the app boots normally, reports nothing, and
 * runs with a constraint the schema claims but the database does not enforce. That is
 * how doctors.doctor_no went unindexed: four rows had no doctor_no, all four indexed as
 * null under a non-sparse unique index, and the resulting E11000 was swallowed on every
 * boot.
 *
 * The 'index' event still fires unconditionally and carries the error. This attaches to
 * every model compiled on the connection and logs it.
 *
 * A log line is not enforcement: it tells you a constraint is missing, it does not
 * install it. Backfill and build the index deliberately — see
 * scripts/backfill-identifier.js for the pattern.
 */
export function logIndexBuildFailures(connection) {
    const wired = new WeakSet();

    connection.plugin((schema) => {
        // `Model.init()` can run more than once per model (at compile time, then again
        // when the connection opens), and each run re-emits 'init'. Wire each model
        // exactly once so a single failure is not logged N times.
        schema.on('init', (model) => {
            if (wired.has(model)) return;
            wired.add(model);

            model.on('index', (error?: Error) => {
                if (!error) return;
                logger.error(
                    `Index build FAILED for model "${model.modelName}" ` +
                    `(collection "${model.collection.name}"): ${error.message}. ` +
                    `The indexes this schema declares are NOT all enforced in the database.`,
                    error.stack,
                );
            });
        });
    });
}
