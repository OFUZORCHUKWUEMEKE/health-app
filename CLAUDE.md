# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A **telemedicine backend**: NestJS 10 + MongoDB (Mongoose 8), TypeScript, pnpm. It connects
**patients**, **doctors** and **admins** — appointment booking, video consultations, and the
clinical record produced during a consultation (diagnoses, prescriptions, investigations,
referrals).

Deployed to Render (`render.yaml`). Global route prefix `api/v1`. Swagger at `/docs`, disabled
when `NODE_ENV=production`. Health check at `/api/v1/health`.

## ⚠️ This repo is a public mirror — read before pushing

Development happens in a **private upstream repo** (`nedu10/health-app-backend`, remote name
`nedu`). `scripts/sync-main-to-public.sh` replays upstream's *content* onto `origin/main` as a
snapshot commit, stripping `.env` files. The two histories are unrelated, so:

- Commits here that aren't also made upstream **will be overwritten by the next sync**.
- The sync is one-way (private → public). Nothing here flows back automatically.

Before landing non-trivial work, confirm with the user where it should actually live.
`PROJECT_SUMMARY.md` at the root is **significantly out of date** — it predates the bookings,
video, notifications and cloudinary modules, and most of its "critical" list has since been
fixed. Trust the code, not that file.

## Commands

```bash
pnpm install
pnpm run start:dev      # watch mode
pnpm run build          # nest build
pnpm run test           # jest, runInBand — 158 tests, all passing
pnpm run test:cov
pnpm run lint           # eslint --fix
pnpm run format         # prettier

# Operational scripts (need DATABASE_URL)
pnpm run seed:admin
pnpm run seed:doctors
pnpm run backfill:identifiers   # --target=all
pnpm run audit:indexes          # verify declared indexes actually exist
```

Every script sets an explicit `NODE_OPTIONS=--max-old-space-size=…`. That is deliberate: the
Render Starter instance has 512 MB, and production runs with a **384 MB heap**. Keep memory
cost in mind — projected queries over whole-document reads, no unbounded `find()`.

## Module map

| Module | Owns |
|---|---|
| `auth/` | OTP patient registration (initiate → verify-otp → complete), login for all 3 roles, Google OAuth (**patients only**), refresh rotation, forgot-password OTP, admin bootstrap |
| `bookings/` | Doctor weekly availability, blackouts, slot generation, appointment booking (manual + auto-match with fallback), cancel/reschedule, system availability matrix. `bookings.service.ts` is ~3.4k lines — the largest file in the repo |
| `consultations/` | The clinical record. 12 schemas in one file (`consultations.model.ts`): Consultation, Diagnosis, Medication, Investigation/InvestigationList/InvestigationResult, HistoryTaking, PhysicalExam, TreatmentPlan, DiagnosisForm, Referral, CompliantHistory |
| `notifications/` | In-app feed, event listeners, cron reminder sweep, notification copy templates |
| `video/` | Daily.co rooms + meeting tokens, session start/end |
| `users/` `doctors/` `admin/` | Accounts, profiles, metrics |
| `mail/` `cloudinary/` | Nodemailer transactional email, profile-picture uploads |
| `common/` | Core abstractions, `RolesGuard`, enums, events, filters, interceptors, MRN allocation |

### Route surface

- `auth/*` — registration and login for all roles
- `patients/*` and `doctors/*` — profile, metrics, notifications feed
- `patients/consultations/*` and `doctors/consultations/*` — the clinical record, split by role
- `booking/*` — availability, slots, appointments (both `patients/…` and `doctors/me/…` subtrees)
- `internal/reminders/dispatch` — manual reminder sweep, gated on `REMINDER_DISPATCH_KEY`

## Conventions

### Response envelope — every endpoint

Success responses go through `CoreController.responseSuccess(res, '00', 'Success', data, HttpStatus.OK)`,
with `@Res({ passthrough: true })` injected. Controllers extend `CoreController`.
`ResponseEnvelopeInterceptor` wraps anything that isn't already enveloped, so both paths produce:

```json
{ "success": true, "response_code": "00", "response_description": "Success",
  "data": {}, "request_id": "…", "path": "…", "timestamp": "…" }
```

Errors go through `HttpExceptionFilter` / `ModelExceptionFilter` and produce the same shape with
`success: false` and a numeric-string `response_code`. `request_id` comes from
`requestContextMiddleware` (honours an inbound `x-request-id`, else generates one).

### Auth

`RolesGuard` (`src/common/guards/roles.guard.ts`) is the current unified guard:

```ts
@UseGuards(RolesGuard)
@Roles(Role.PATIENT)          // omit @Roles for "any authenticated user"
@ApiBearerAuth()
async handler(@CurrentUser() user: any, @Res({ passthrough: true }) res: Response) {}
```

It verifies the JWT, reads the `role` claim, loads the entity from the matching repository, and
attaches it to `req.user` (plus legacy `req.patient` / `req.doctor` / `req.admin`). Deactivated
doctors are rejected here.

**Two guard generations coexist.** `consultations/controllers/*` and `video.controller.ts` still
use the legacy `PatientGuard` / `DoctorGuard` from `src/auth/guard/`. New code uses `RolesGuard`.
Don't mix them within one controller.

Tokens: `TokenService` is the single place JWTs are minted. Refresh tokens are bcrypt-hashed
before storage (`refresh_token_hash`, `select: false`). User-supplied tokens (email links, reset
tokens) are verified through helpers that translate JWT errors into **400s, not 500s**.

### Data layer

Repositories extend `CoreRepository<T>` (`findOne`, `find`, `create`, `findOneAndUpdate`,
`delete`, `model()` for raw access). Services inject repositories; controllers inject services.

Schemas are registered per-module with `MongooseModule.forFeature`. Model registration names are
**inconsistent** — some use string literals (`{ name: 'User', … }` + `@InjectModel('User')`),
others `Consultation.name`. Match whatever the module you're editing already does.

Indexes are declared **explicitly** on the schema, never left to `autoIndex`. See
`src/database/index-error-logger.ts` for why: Mongoose silently swallows failed index builds, and
this repo has been bitten twice by unique indexes collapsing on null. After changing an index,
run `pnpm run audit:indexes`.

### Concurrency is handled by database constraints, not locks

This pattern recurs and should be preserved:

- **MRN allocation** (`common/mrn/mrn.service.ts`) doesn't check-then-insert. It *takes* a value
  by inserting into a registry with a unique index and treats E11000 as "someone else won".
- **Double-booking** is blocked by a partial unique index on
  `(doctor_id, scheduled_start_at_utc)` filtered to PENDING/CONFIRMED.
- **Reminder dispatch** claims each appointment with an atomic compare-and-set on
  `reminder_24h_sent_at` / `reminder_1h_sent_at`, so it stays correct under multiple instances.
- **Notification dedupe** is a required `event_key` with a unique index — never sparse, for the
  null-collision reason above.

### Timezones

Clients send **local wall-clock time + an IANA zone**; the backend converts to UTC. Responses
carry UTC instants (`*_at_utc`) plus a `timezone` hint. Doctor availability slots are wall-clock
in the doctor's own zone and converted at query time, DST-correct. Validation decorators:
`@IsIanaTimezone`, `@IsIsoLocalDateTime`, `@IsUtcDateString`. Helpers in
`common/utils/timezone.util.ts` (luxon). Contract documented in `docs/bookings-timezone-api.md`.

Never do timezone math ad hoc — go through the existing helpers.

### Patient medical lists

`User.allergies` and `User.previous_medical_conditions` are written from two places, on
deliberately different terms. Preserve the asymmetry:

- **Booking is additive intake.** `reconcilePatientProfileFromSelfBooking`
  (`bookings.service.ts`) merges the declared lists into the profile as a **case-insensitive
  union** — entries are added, never removed — and only when `appointment_for` is `SELF`. Two
  reasons, both clinical: an intake form filled in a hurry may arrive blank or partial, and
  replacing on that basis would silently drop a recorded allergy; and someone else's history
  must never land on the booker's record.
- **`PATCH /patients/me/profile` is the authoritative edit** and *replaces* the list outright.
  Removing an entry happens there and nowhere else.

The same values are separately snapshotted onto the appointment and prefill the doctor's
history-taking form (`resolveHistoryTakingPrefillFromAppointment`). Keep that snapshot a plain
copy — it records what was declared *for that visit*, not the patient's whole file.

Don't "simplify" the merge back into an assignment, and don't extend it to `OTHERS` bookings.

### Events and notifications

Domain operations emit typed events (`common/events/`) via `@nestjs/event-emitter`; listeners in
`notifications/listeners/` turn them into notification rows. Two rules hold in every payload:
**ids are strings, never ObjectIds or hydrated documents**, and payloads carry only facts the
emit site already has (no extra queries on the request path).

Notification handlers must never throw out into the caller — a notification failure must not fail
the booking that caused it. Never register a listener with `{ suppressErrors: false }`.

Notification `title`/`body` are rendered at **write** time and are a historical record. They carry
names, times and counts only — **never a drug name, test name, diagnosis or referral reason**,
because this copy is intended to feed email and push later.

### Testing

Jest, `rootDir: src`, `*.spec.ts`, path alias `src/*`. Tests are **pure unit tests with hand-rolled
mocks** — services are constructed directly (`new NotificationsService(repository as any)`), not
through `Test.createTestingModule`, and no test touches a database. Follow that style; keep the
suite runnable with no `DATABASE_URL`.

### Style

Prettier: single quotes, trailing commas. TypeScript is **loose** — `strictNullChecks: false`,
`noImplicitAny: false`, and `@typescript-eslint/no-explicit-any` is off. Indentation varies
**file by file**, not module by module — 2-space and 4-space both appear, sometimes in two files
of the same module (`bookings.controller.ts` is 2-space, `bookings.service.ts` is 4-space), and
`admin/admin.service.ts` is tab-indented. **Match the file you're editing**; don't reformat
surrounding code, and don't run `pnpm run format` across files you didn't otherwise touch.

Comments in the newer modules (notifications, reminders, MRN, video, indexes) explain *why*,
including rejected alternatives. Preserve them — they encode decisions that aren't recoverable
from the code — and write in the same register when adding non-obvious logic.

## Known rough edges

Don't "fix" these incidentally; they're either deliberate or load-bearing.

- **`consoltation_for`** (misspelled) is a real field in the Consultation schema and DTO. It's part
  of the API contract now. Renaming it is a migration, not a typo fix.
- **CORS is intentionally open to all origins** by default (`c50de42` deliberately reverted an
  allowlist). Setting `CORS_ORIGINS` restricts it again.
- **Two names for one field**: the booking DTO sends `Medical_conditions` (capital M, no prefix);
  it lands on the user document as `previous_medical_conditions`. Both spellings are in the API
  contract — the translation happens in the booking service.
- **Dead code**: `consultations/controllers/consultations.controller.ts` is entirely commented out;
  `consultations/controllers/doctors.controller.ts` has large commented blocks.
- **Route ordering matters** in `doctors.controller.ts` and `users.controller.ts` — literal routes
  must stay above `@Get('/:id')` style params. There are comments marking this; respect them.
- **Root debris**: `_debug.js`, `_mint.js`, `test-db*.js`, `test-flow.js`, `bash.exe.stackdump`,
  empty `.codex`. Ad-hoc scripts against a live DB, not part of the build.
- `README.md` is still largely the stock NestJS template with deploy notes appended.

## Environment

Copy `.env.example`. Required: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, Google OAuth
trio, `FRONTEND_URL`, `CORS_ORIGINS`, mail credentials. Optional: `DAILY_API_KEY` (video),
Cloudinary trio (profile pictures), `REMINDER_DISPATCH_KEY` (unset = manual reminder endpoint
disabled, never open).

Keep `ALLOW_ADMIN_BOOTSTRAP=false` in production. Never commit `.env` — `.gitignore` covers it and
the sync script strips it, but both are backstops, not permission.
