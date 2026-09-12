/**
 * Phase 0 / Spike 1 — the one question this file exists to answer:
 *
 *   Does the `mongodb` driver's socket handling survive being routed through
 *   workerd's node:net / node:tls compatibility shim at all — SRV DNS lookup,
 *   TLS handshake, SCRAM-SHA-256 auth — or does it fail somewhere in that chain?
 *
 * Deliberately NOT wrapped in NestJS/Mongoose/Express here. Those layers are the
 * well-trodden part (Cloudflare's own tutorial deploys Express this way); wrapping
 * them around an untested driver path would make a failure here indistinguishable
 * from a bundling/framework problem. Isolate the real unknown first.
 *
 * Bound as a secret, not hardcoded: MONGO_URL. Accepts either form —
 *   mongodb+srv://user:pass@cluster.mongodb.net/db      (Atlas default — needs DNS SRV+TXT)
 *   mongodb://host1,host2,host3:27017/db?replicaSet=... (Atlas's non-SRV alternative)
 * If workerd's node:dns shim doesn't support SRV/TXT record types, the +srv form
 * will fail in a specific, diagnosable way — see the error branch below. That
 * failure mode is itself a finding worth having, not just a bug to fix blindly.
 */
import { MongoClient } from 'mongodb';
import dns from 'node:dns';

interface Env {
    MONGO_URL: string;
}

/**
 * Held at module scope so a warm isolate reuses one client (and its connection
 * pool) across requests, the same way this app's Node process does today. A cold
 * isolate starts this fresh — which is exactly the case whose cost this spike
 * measures. Never resolve this eagerly at module load: Workers only allows I/O
 * inside a request context, so the first connect must happen inside a handler.
 */
let clientPromise: Promise<MongoClient> | null = null;

/** Millisecond timestamps for each phase of the FIRST connection this client makes. */
interface ConnectTimings {
    constructed_at: number;
    topology_opened_at: number | null; // fires once the pool is ready — DNS+TCP+TLS+auth all done
    heartbeat_succeeded_at: number | null;
}

const timingsByClient = new WeakMap<MongoClient, ConnectTimings>();

function getOrCreateClient(env: Env): Promise<MongoClient> {
    if (clientPromise) return clientPromise;

    clientPromise = (async () => {
        const t0 = Date.now();
        const client = new MongoClient(env.MONGO_URL, {
            // Workers' outbound TCP is not unlimited; keep this spike's pool small
            // and deliberate rather than inheriting a Node-process-sized default.
            maxPoolSize: 5,
            // Fail fast and loud rather than retrying quietly — a spike wants a
            // clear failure, not a slow one.
            serverSelectionTimeoutMS: 8000,
            connectTimeoutMS: 8000,
        });

        const timings: ConnectTimings = {
            constructed_at: t0,
            topology_opened_at: null,
            heartbeat_succeeded_at: null,
        };
        timingsByClient.set(client, timings);

        client.on('topologyOpening', () => {
            // no-op marker left in for anyone attaching a debugger; timing is
            // taken on topologyDescriptionChanged/serverHeartbeatSucceeded instead,
            // since "opening" fires before the handshake actually completes.
        });
        client.on('serverHeartbeatSucceeded', () => {
            if (!timings.heartbeat_succeeded_at) {
                timings.heartbeat_succeeded_at = Date.now();
            }
        });
        client.on('topologyDescriptionChanged', (event) => {
            if (!timings.topology_opened_at && event.newDescription.type !== 'Unknown') {
                timings.topology_opened_at = Date.now();
            }
        });

        await client.connect();
        return client;
    })();

    return clientPromise;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        // Baseline: zero DB touch. Compare this against /mongo-ping to isolate
        // "Worker cold-start cost" from "Mongo handshake cost".
        if (url.pathname === '/health') {
            return jsonResponse({ ok: true, isolate_reused: clientPromise !== null });
        }

        if (url.pathname === '/mongo-ping') {
            const requestStart = Date.now();
            const wasAlreadyConnecting = clientPromise !== null;

            try {
                const client = await getOrCreateClient(env);
                const timings = timingsByClient.get(client)!;

                const pingStart = Date.now();
                const result = await client.db().command({ ping: 1 });
                const pingEnd = Date.now();

                return jsonResponse({
                    ok: true,
                    connection_reused: wasAlreadyConnecting,
                    ping_result: result,
                    timings_ms: {
                        total_request: pingEnd - requestStart,
                        // Only meaningful on the request that actually created the
                        // connection — null on every subsequent warm request.
                        handshake_to_ready: timings.topology_opened_at
                            ? timings.topology_opened_at - timings.constructed_at
                            : null,
                        first_heartbeat: timings.heartbeat_succeeded_at
                            ? timings.heartbeat_succeeded_at - timings.constructed_at
                            : null,
                        ping_command_only: pingEnd - pingStart,
                    },
                });
            } catch (error: any) {
                // Reset so the next request tries a fresh connect rather than
                // replaying a cached rejected promise forever.
                clientPromise = null;

                return jsonResponse(
                    {
                        ok: false,
                        // The three failure shapes worth telling apart at a glance:
                        //  - "querySrv"/"ENOTFOUND" style  -> node:dns doesn't support
                        //    SRV/TXT lookups here; retry with a non-SRV connection string.
                        //  - anything mentioning TLS/handshake -> node:tls gap.
                        //  - anything mentioning "auth failed"/SCRAM -> the handshake
                        //    completed but the auth exchange didn't survive the shim.
                        error_name: error?.name ?? 'Unknown',
                        error_message: error?.message ?? String(error),
                        error_stack: error?.stack,
                    },
                    502,
                );
            }
        }

        // Isolated from Mongo entirely: does workerd's node:dns shim support the
        // SRV record type at all? mongodb+srv:// URIs (Atlas's default form) need
        // it; a real answer here, against a public record unrelated to Mongo,
        // tells us whether that failure mode (if any) is "SRV unsupported" or
        // just "this particular fake hostname doesn't exist" — the two look
        // identical from inside the driver, but need different fixes.
        if (url.pathname === '/dns-srv-check') {
            const resolver = new dns.promises.Resolver();

            // Three record types, one known-certain to still exist (TXT/MX on
            // google.com — SPF and mail routing, not going away), one the actual
            // question (SRV). If TXT/MX work but SRV alone fails, that's real
            // evidence of an SRV-specific gap. If all three fail alike, the
            // shim doesn't support non-A/AAAA lookups generally, which is a
            // different (bigger) finding than "Atlas's +srv form specifically
            // doesn't work."
            const checks = [
                { type: 'TXT', run: () => resolver.resolveTxt('google.com') },
                { type: 'MX', run: () => resolver.resolveMx('google.com') },
                // CalDAV service-discovery SRV record, actively used today by real
                // Apple Calendar / Thunderbird autodiscovery — chosen specifically
                // because it's a live production dependency, not a legacy protocol
                // like XMPP that a provider could have quietly dropped.
                { type: 'SRV', run: () => resolver.resolveSrv('_caldavs._tcp.fastmail.com') },
            ] as const;

            const results: Record<string, unknown> = {};
            for (const check of checks) {
                try {
                    results[check.type] = { ok: true, records: await check.run() };
                } catch (error: any) {
                    results[check.type] = {
                        ok: false,
                        error_code: error?.code,
                        error_message: error?.message ?? String(error),
                    };
                }
            }
            return jsonResponse(results);
        }

        return jsonResponse(
            { ok: false, error_message: 'Not found. Try /health, /mongo-ping, or /dns-srv-check' },
            404,
        );
    },
};
