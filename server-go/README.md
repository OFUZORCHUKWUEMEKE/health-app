# Telemex Go Backend

Go + PostgreSQL replacement for the NestJS (`health-app`) backend. The API
contract is captured in `../docs/contract/` (route checklist, quirks,
OpenAPI-compat notes).

- Base path: `/api/v1`
- Envelope: every response is `{success, response_code, response_description, data, message, request_id, path, timestamp}`.
- Roles: `admin`, `doctor`, `patient` (JWT; inactive accounts are rejected).

## Prerequisites

- Go 1.26+
- PostgreSQL 16 (local instance with a `postgres` superuser)

## Local setup (clean checkout)

```bash
cd server-go
cp .env.example .env   # then set secrets (see below)

# 1. Create the databases (adjust owner/auth to your instance):
psql -U postgres -c 'CREATE DATABASE telemex'
psql -U postgres -c 'CREATE DATABASE telemex_test'

# 2. Migrate both:
DATABASE_URL=postgres://postgres@localhost:5433/telemex?sslmode=disable go run ./cmd/migrate
DATABASE_URL=postgres://postgres@localhost:5433/telemex_test?sslmode=disable go run ./cmd/migrate

# 3. Seed baseline markers (dev database):
DATABASE_URL=postgres://postgres@localhost:5433/telemex?sslmode=disable go run ./cmd/seed

# 4. Run (reads `.env` in this directory):
go run ./cmd/api
```

Health: `GET /api/v1/health` → 200. Readiness (needs DB):
`GET /api/v1/readyz` → 200 with pool stats, 503 without a database.
Build info: `GET /api/v1/version`.
Interactive API docs (Swagger UI): `GET /docs` (raw spec at
`GET /api/v1/openapi.yaml`; the UI chrome loads from CDN).

## Environment variables

All configuration is env-first (`.env` is a fallback; real env vars win).
Never commit `.env` — it holds secrets.

| Var                                                                | Required           | Purpose                                                                        |
| ------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------ |
| `PORT`                                                             | no (4000)          | Listen port                                                                    |
| `APP_ENV`                                                          | no (`development`) | `production` switches zap to JSON logs                                         |
| `CORS_ORIGINS`                                                     | no (allow all)     | Comma-separated allowlist; empty mirrors Nest (reflect origin)                 |
| `ALLOW_ADMIN_BOOTSTRAP`                                            | no (`false`)       | Must be `true` to use `/auth/admins/bootstrap`                                 |
| `DATABASE_URL`                                                     | no\*               | Postgres URL. \*Empty runs DB-less (only `/health`, `/readyz`=503, `/version`) |
| `TEST_DATABASE_URL`                                                | for tests          | Integration-test database                                                      |
| `DB_MAX_CONNS`                                                     | no (25)            | Pool ceiling, 1–200                                                            |
| `SLOW_QUERY_MS`                                                    | no (500)           | Slow-query log threshold; `0` disables. Bound args are never logged (PHI)      |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`                                 | **yes**            | Boot fails without both                                                        |
| `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_EXPIRATION`                  | no (`7d`/`90d`)    | Accept `15m`/`24h`/`7d`/`90d`                                                  |
| `REGISTRATION_TOKEN_SECRET`, `PASSWORD_RESET_TOKEN_SECRET`         | for those flows    | OTP/registration/reset signing                                                 |
| `REGISTRATION_TOKEN_EXPIRATION`, `PASSWORD_RESET_TOKEN_EXPIRATION` | no (`15m`)         | Token TTL labels                                                               |
| `FRONTEND_URL`                                                     | no                 | Feeds OAuth/reset redirects                                                    |
| `EMAIL_HOST/PORT/USER/PASSWORD/FROM/SECURE`                        | for email          | Empty host = log-only mail (dev-safe)                                          |
| `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`                             | for Google OAuth   | Empty = controlled 503 on OAuth routes                                         |
| `ADMIN_BOOTSTRAP_KEY`                                              | with bootstrap     | Key required by `/auth/admins/bootstrap`                                       |
| `RETURN_OTP_IN_RESPONSE`                                           | no                 | `true` echoes OTPs in API responses (dev only)                                 |
| `BOOKING_MODE`                                                     | no (`auto`)        | `manual` = bookings stay PENDING; `auto` = match CONFIRMED                     |
| `REMINDER_DISPATCH_KEY`                                            | for reminders      | Empty disables `POST /internal/reminders/dispatch` (403)                       |
| `DAILY_API_KEY`                                                    | for video          | Empty = video token endpoints return controlled 503                            |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`                         | for uploads        | Partial/empty = controlled 503 on upload routes                                |
| `CLOUDINARY_PROFILE_FOLDER`, `CLOUDINARY_INVESTIGATION_FOLDER`     | no                 | Storage folders                                                                |

## Database commands

```bash
go run ./cmd/migrate up       # migrate DATABASE_URL (default)
go run ./cmd/migrate status   # pending migrations
go run ./cmd/migrate down     # roll back one (dev only)
go run ./cmd/seed             # baseline app_meta markers
```

Migrations are goose files in `migrations/`; sqlc queries in `db/queries/`
regenerate with `sqlc generate` (pinned version in `db/gen/db.go` header).

## Tests

```bash
go test ./...                              # full suite (needs TEST_DATABASE_URL)
go test ./internal/booking/ ./internal/consult/   # one module
go test ./internal/contract/               # frontend surface contract
```

Integration tests use `TEST_DATABASE_URL`, migrate it automatically, and
scope all fixtures/cleanup to unique emails — packages can run in parallel.
Without a reachable database they skip (unit-only runs stay green).

Load suite (`load/`):

```bash
# boot the API, then seed + load 10 VUs for 60s (p95/error gates):
go run ./load -base-url http://localhost:4000 \
  -database-url postgres://postgres@localhost:5433/telemex?sslmode=disable \
  -seed -vus 10 -duration 60s
go run ./load -database-url ... -cleanup   # delete seeded rows
```

Always `-seed` before a measured run (it wipes prior load bookings so slot
sequences restart collision-free). Exit non-zero on threshold breach.

## Deployment

1. Provision Postgres, run `go run ./cmd/migrate up` with the real
   `DATABASE_URL`.
2. Set env: `PORT`, `APP_ENV=production`,
   `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, plus the provider
   keys in use (SMTP, Daily, Cloudinary, Google).
3. Optional: bake build metadata with ldflags
   (`-X .../internal/version.Version=… Commit=… BuiltAt=…`); confirm via
   `GET /api/v1/version`.
4. Point the frontend at it (`VITE_API_BASE_URL=https://<host>/api/v1`).
5. Confirm `GET /api/v1/readyz` is 200.

## External providers

| Provider             | Configure                                                 | When missing                                                       |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| SMTP                 | `EMAIL_HOST/PORT/USER/PASSWORD/FROM/SECURE`               | Log-only mail; OTP flows need `RETURN_OTP_IN_RESPONSE=true` in dev |
| Daily (video)        | `DAILY_API_KEY`                                           | Token endpoints → 503; start/end unaffected                        |
| Cloudinary (uploads) | `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` (+ folders)    | Upload routes → 503                                                |
| Google OAuth         | `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` (+ `FRONTEND_URL`) | OAuth routes → 503; flag `google_oauth` gates them too             |

## Troubleshooting

- `postgres: DATABASE_URL is missing` → set it, or boot DB-less for
  `/health` + `/version` only.
- `readyz` 503 `database unreachable` → wrong URL/creds or migrations not run.
- Tests skip with `postgres unavailable` → start Postgres / set
  `TEST_DATABASE_URL`.
- `011` everywhere → missing/expired `Authorization: Bearer` token, or
  wrong role for the route (doctors ≠ patients).
- Booking 409 `Selected slot is already booked` under load → rerun with
  `-seed` (wipes prior load bookings).
- `sqlc generate` diffs unrelated files → install the pinned version from
  the `db/gen/db.go` header.
