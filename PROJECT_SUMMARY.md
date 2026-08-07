# Health App Backend — Project Summary

> **Tech Stack:** NestJS (v10) · MongoDB (Mongoose v8) · Passport.js · JWT · Nodemailer · Swagger  
> **Package Manager:** pnpm  
> **Deployment:** Render (commented-out URL: `health-app-backend-inzm.onrender.com`)

---

## What This Project Is

A telemedicine / health consultation backend that connects **patients**, **doctors**, and **admins**. Patients can sign up, book consultations, and submit complaint histories. Doctors can manage consultations, create diagnoses, prescribe medications, order investigations, and perform physical exams. An admin role exists in the schema but has no active endpoints.

---

## Architecture Overview

```
src/
├── admin/          # Admin model, repository, empty controller
├── auth/           # Auth service, strategies (local, google, JWT, refresh), guards
│   └── guard/      # PatientGuard, DoctorGuard, AdminGuard, GeneralGuard
├── common/         # Core abstractions (CoreController, CoreService, CoreRepository)
│   ├── core/
│   ├── exceptions/
│   └── filters/
├── config/         # Environment configuration loader
├── consultations/  # The main business domain
│   ├── controllers/  # PatientsController, DoctorsController, (ConsultationsController — fully commented out)
│   ├── dto/
│   └── events/
├── doctors/        # Doctor model, repository, service (signup/login/activate/deactivate)
├── mail/           # Email service (confirmation, forgot password, reset password)
├── users/          # User (Patient) model, repository, service, factory
└── utils/          # Code generator utility
```

### Data Models (Mongoose Schemas)

| Model               | Description                                          |
|----------------------|------------------------------------------------------|
| `User`               | Patient accounts (local + Google OAuth)              |
| `Doctor`             | Doctor accounts with activation status               |
| `Admin`              | Admin accounts (no active endpoints)                 |
| `Consultation`       | A patient-doctor session with patient details & status |
| `Investigation`      | Lab tests / investigations tied to a consultation    |
| `Diagnosis`          | Doctor-created diagnoses per consultation            |
| `Medication`         | Prescriptions with formulation, dose, interval, duration |
| `CompliantHistory`   | Patient medical/social/family/travel history         |
| `PhysicalExam`       | Physical examination records by body system          |

---

## ✅ What's Working

### Authentication & Authorization
- **Patient signup/login** with email + password (bcrypt hashing, `LocalStrategy`)
- **Doctor signup/login** with separate endpoint and credential flow
- **Google OAuth 2.0** login/signup with redirect callback
- **JWT access + refresh token** system with token rotation on refresh
- **Role-based guards** — `PatientGuard`, `DoctorGuard`, `AdminGuard`, `GeneralGuard` — each verify JWT and attach the correct entity to `req`
- **Email confirmation** flow on signup
- **Forgot/reset password** flow with token-based verification

### Consultation Management
- Patients can **create consultations**, view their own, and create follow-up sessions
- **Automatic doctor assignment** via event emitter (`consultation.created` event)
- Doctors can **view assigned consultations**, create **diagnoses**, **investigations**, **medications**, and **physical exams**
- CRUD operations for complaint histories, investigations, and medications
- **Pagination** implemented via `CoreSearchFilterDatePaginationDto` across list endpoints
- **Weekly consultation** reports for both doctors and patients

### Infrastructure
- **Swagger/OpenAPI** documentation available at `/docs`
- **Global ValidationPipe** for DTO validation
- **Global exception filters** (`HttpExceptionFilter`, `ModelExceptionFilter`)
- **Core abstractions** — `CoreRepository`, `CoreService`, `CoreController` — provide reusable CRUD patterns
- **Event-driven architecture** via `@nestjs/event-emitter` for consultation creation
- **Email service** (Nodemailer + `@nestjs-modules/mailer`) for transactional emails
- **Mongoose lean virtuals** plugin for query performance

---

## ⚠️ What Needs Improvement

### 🔴 Critical — Security

| Issue | Details |
|-------|---------|
| **`.env` committed to Git** | The `.env` file contains real database credentials (`mongodb+srv://...`), Google OAuth secrets, JWT secrets, and mail credentials. This should be in `.gitignore` and rotated immediately. |
| **Weak JWT secrets** | `JWT_SECRET=secret` and `JWT_REFRESH_SECRET="jwt-secret"` are trivially guessable. Use strong random strings (32+ chars). |
| **CORS wide open** | `app.enableCors({})` allows all origins. Restrict to known frontend domains. |
| **AdminGuard commented out** | The `/doctors/signup` endpoint has `@UseGuards(AdminGuard)` commented out, meaning **anyone can create doctor accounts**. |
| **Doctor active check disabled** | In `loginDoctor()`, the `if (!doctor.active)` check is commented out, so deactivated doctors can still log in. |
| **Tokens stored in DB as plaintext** | Access and refresh tokens are stored as raw strings in the User/Doctor models. Refresh tokens should be hashed before storage. |

### 🟡 Architecture & Code Quality

| Issue | Details |
|-------|---------|
| **Duplicated `generateToken()` logic** | Token generation is implemented independently in both `AuthService` and `DoctorsService` with identical code. Extract to a shared `TokenService`. |
| **Duplicated guard logic** | `PatientGuard`, `DoctorGuard`, `AdminGuard` are nearly identical — only the repository differs. Use a single configurable guard or a base class. |
| **Duplicate `MailService` injection** | `AuthService` injects both `emailService: MailService` and `mailService: MailService` — the same service injected twice under different names. |
| **Entire `ConsultationsController` commented out** | 169 lines of dead code. Should be removed or replaced — its functionality already lives in `PatientsController` and `DoctorsController`. |
| **Commented-out code everywhere** | `auth.controller.ts`, `consultations.service.ts`, `mail.service.ts`, `doctors.service.ts` all contain commented-out blocks. Clean these up. |
| **`console.log` left in production code** | Debug logs in `GeneralGuard`, `PatientsController`, `UsersService`. Remove or replace with a proper logger (`Logger` from `@nestjs/common`). |
| **Unused imports** | `throws` imported from `assert` in `auth.controller.ts`, `populate` imported from `dotenv` in `consultations.service.ts`. |
| **Hardcoded URLs** | `http://localhost:5173`, `http://localhost:3000` hardcoded in Google callback and email confirmation redirects instead of using `ConfigService`. |

### 🟡 Data & Validation

| Issue | Details |
|-------|---------|
| **`resetPassword` in `UsersService` doesn't hash password** | `get_user.password = dto.password` stores plaintext. Only `AuthService.resetPassword` hashes properly — but both exist and could be called. |
| **Typos in schema field names** | `consoltation_for` (should be `consultation_for`) in the Consultation model. |
| **Typos in file names** | `create-dignosis.dto.ts` (should be `create-diagnosis.dto.ts`). |
| **`@IsString()` on boolean field** | `verified` in `User` model has `@IsString()` decorator but is typed as `boolean`. |
| **Naive doctor assignment** | `assignDoctor()` always picks `doctors[0]` — no load balancing, specialization matching, or availability check. |
| **`password` field not excluded from response** | The signup response returns `createUser` (the raw DTO) which still includes the password field. |

### 🟡 Missing Features

| Feature | Notes |
|---------|-------|
| **Admin module is empty** | `AdminController` has no endpoints. Admin login/signup exist in `AuthService` but are commented out in the controller. |
| **No logout endpoint** | `revokeRefreshToken()` exists in `AuthService` but is never exposed via a controller route. |
| **No tests** | Only the default NestJS `app.controller.spec.ts` exists. No unit or integration tests for any business logic. |
| **No file upload storage** | Investigation file upload handler exists but saves to local disk (`./uploads/investigations`) — no cloud storage integration. |
| **No rate limiting** | No throttling on auth endpoints (login, signup, forgot-password) — vulnerable to brute force. |
| **No request logging / monitoring** | No middleware for request logging, APM, or health check endpoints. |
| **Port hardcoded** | Server always listens on port `4000` regardless of the `PORT` config value in `configuration.ts`. |

---

## Summary Table

| Area | Status |
|------|--------|
| Patient auth (email + Google) | ✅ Working |
| Doctor auth | ✅ Working (but missing activation guard) |
| Admin auth | ❌ Not wired up |
| Consultation CRUD | ✅ Working |
| Diagnosis / Investigation / Medication | ✅ Working |
| Complaint History / Physical Exam | ✅ Working |
| Email service | ✅ Working (Mailtrap sandbox) |
| Swagger docs | ✅ Working at `/docs` |
| Security | 🔴 Needs immediate attention |
| Code quality | 🟡 Needs cleanup |
| Test coverage | ❌ Essentially zero |
| Production readiness | 🔴 Not production-ready |
