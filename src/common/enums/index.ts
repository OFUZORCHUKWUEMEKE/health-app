// ─── Auth ──────────────────────────────────────────────
export enum Role {
    ADMIN = 'admin',
    DOCTOR = 'doctor',
    PATIENT = 'patient',
}

export enum AuthProvider {
    LOCAL = 'LOCAL',
    GOOGLE = 'GOOGLE',
}

// ─── Appointment ───────────────────────────────────────
export enum AppointmentType {
    CHAT = 'CHAT',
    AUDIO = 'AUDIO',
    VIDEO = 'VIDEO',
    MEET = 'MEET',
    HOME = 'HOME',
}

export enum AppointmentFor {
    SELF = 'SELF',
    OTHERS = 'OTHERS',
}

export enum AppointmentStatus {
    PENDING = 'PENDING',
    CONFIRMED = 'CONFIRMED',
    COMPLETED = 'COMPLETED',
    CANCELED = 'CANCELED',
    RESCHEDULED = 'RESCHEDULED',
}

// ─── Consultation (Clinical Encounter) ─────────────────
export enum ConsultationStatus {
    OPEN = 'OPEN',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    ADDENDED = 'ADDENDED',
}

// ─── Doctor Schedule ───────────────────────────────────
export enum SlotStatus {
    AVAILABLE = 'AVAILABLE',
    BOOKED = 'BOOKED',
    BLOCKED = 'BLOCKED',
}

// ─── Payment ───────────────────────────────────────────
export enum PaymentStatus {
    PENDING = 'PENDING',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    REFUNDED = 'REFUNDED',
}

export enum PaymentMethod {
    CARD = 'CARD',
    APPLE_PAY = 'APPLE_PAY',
    BANK = 'BANK',
}

// ─── Feedback ──────────────────────────────────────────
export enum FeedbackStatus {
    NEW = 'NEW',
    REVIEWED = 'REVIEWED',
}

// ─── Investigation ─────────────────────────────────────
export enum InvestigationStatus {
    PENDING = 'PENDING',
    UPLOADED = 'UPLOADED',
    REVIEWED = 'REVIEWED',
}

// ─── Medication ────────────────────────────────────────
export enum MedicationStatus {
    ACTIVE = 'ACTIVE',
    STOPPED = 'STOPPED',
}

export enum MedicationFormulation {
    TABLET = 'TABLET',
    CAPSULE = 'CAPSULE',
    SYRUP = 'SYRUP',
    INJECTION = 'INJECTION',
    INHALER = 'INHALER',
    CREAM = 'CREAM',
    DROPS = 'DROPS',
    SUPPOSITORY = 'SUPPOSITORY',
}

export enum MedicationDoseUnit {
    MILLIGRAM = 'MILLIGRAM',
    MICROGRAM = 'MICROGRAM',
    GRAM = 'GRAM',
    PUFFS = 'PUFFS',
    TABS = 'TABS',
    CAPS = 'CAPS',
    MLS = 'MLS',
    LITRE = 'LITRE',
    IU = 'IU',
}

export enum MedicationInterval {
    DAILY = 'DAILY',
    TWICE_DAILY = 'TWICE_DAILY',
    THREE_TIMES_DAILY = 'THREE_TIMES_DAILY',
    FOUR_TIMES_DAILY = 'FOUR_TIMES_DAILY',
    WEEKLY = 'WEEKLY',
    MONTHLY = 'MONTHLY',
    AS_NEEDED = 'AS_NEEDED',
    STAT = 'STAT',
}

export enum MedicationDurationUnit {
    DAY = 'DAY',
    WEEK = 'WEEK',
    MONTH = 'MONTH',
}

// ─── Diagnosis ─────────────────────────────────────────
export enum DiagnosisType {
    PROVISIONAL = 'PROVISIONAL',
    FINAL = 'FINAL',
}

// ─── Admin ─────────────────────────────────────────────
export enum AdminRole {
    SUPER_ADMIN = 'super_admin',
    MODERATOR = 'moderator',
}
