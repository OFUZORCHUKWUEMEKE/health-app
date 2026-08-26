// src/enums/consultation.enum.ts
export enum ConsultationTypeEnum {
  CHAT = 'CHAT',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  MEETADOCTOR = 'MEETADOCTOR',
  HOMESERVICE = 'HOMESERVICE',
}

export enum ConsultationForEnum {
  SELF = 'SELF',
  OTHERS = 'OTHERS',
}

export enum StatusEnum {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum ConsultationStatusEnum {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
  ACTIVE = 'ACTIVE',
  RESCHEDULED = 'RESCHEDULED',
}

export const AMOUNT = 1000;
export enum MedicationFormulationEnum {
  TAB = 'TAB',
  CAPS = 'CAPS',
  IM = 'IM',
  IV = 'IV',
  IN = 'IN',
  SC = 'SC',
  SUBLINGUAL = 'SUBLINGUAL',
  NEBS = 'NEBS',
}

// src/medications/enums/medication-duration-unit.enum.ts
export enum MedicationDurationUnit {
  MINUTE = 'MINUTE',
  HOUR = 'HOUR',
  DAY = 'DAY',
  MONTH = 'MONTH',
}

// src/medications/enums/medication-dose-unit.enum.ts
export enum MedicationDoseUnit {
  MILLIGRAM = 'MILLIGRAM',
  MICROGRAM = 'MICROGRAM',
  PUFFS = 'PUFFS',
  TAB = 'TAB',
  CAB = 'CAB',
  MLS = 'MLS',
  LITRE = 'LITRE',
}

// src/medications/enums/medication-formulation.enum.ts
export enum MedicationFormulation {
  TABLET = 'TABLET',
  CAPSULE = 'CAPSULE',
  SYRUP = 'SYRUP',
  INJECTION = 'INJECTION',
  // Add other formulations as needed
}

// src/medications/enums/medication-interval.enum.ts
export enum MedicationInterval {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  AS_NEEDED = 'AS_NEEDED',
  // Add other intervals as needed
}

// src/medications/enums/status.enum.ts
export enum STATUS {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
}

/**
 * Specialty names for referrals — the branch of medicine the referred
 * provider practises ("Cardiologist", "Dentist", …). Mirrors the frontend's
 * MEDICAL_SPECIALTY_OPTIONS (health-app-frontend/app/src/shared/constants/
 * medical-specialty.constant.ts); keep both lists in sync.
 */
export enum ReferralSpecialtyEnum {
  ANAESTHETIST = 'Anaesthetist',
  CARDIOLOGIST = 'Cardiologist',
  CLINICAL_PSYCHOLOGIST = 'Clinical Psychologist',
  DENTIST = 'Dentist',
  DERMATOLOGIST = 'Dermatologist',
  DIETITIAN = 'Dietitian',
  ENDOCRINOLOGIST = 'Endocrinologist',
  ENT_SPECIALIST = 'ENT Specialist',
  GASTROENTEROLOGIST = 'Gastroenterologist',
  GENERAL_SURGEON = 'General Surgeon',
  GERIATRICIAN = 'Geriatrician',
  GYNAECOLOGIST = 'Gynaecologist',
  HAEMATOLOGIST = 'Haematologist',
  INFECTIOUS_DISEASE_SPECIALIST = 'Infectious Disease Specialist',
  NEPHROLOGIST = 'Nephrologist',
  NEUROLOGIST = 'Neurologist',
  NEUROSURGEON = 'Neurosurgeon',
  OBSTETRICIAN = 'Obstetrician',
  ONCOLOGIST = 'Oncologist',
  OPHTHALMOLOGIST = 'Ophthalmologist',
  ORTHODONTIST = 'Orthodontist',
  ORTHOPAEDIC_SURGEON = 'Orthopaedic Surgeon',
  OTOLARYNGOLOGIST = 'Otolaryngologist',
  PAEDIATRICIAN = 'Paediatrician',
  PHYSIOTHERAPIST = 'Physiotherapist',
  PLASTIC_SURGEON = 'Plastic Surgeon',
  PSYCHIATRIST = 'Psychiatrist',
  PULMONOLOGIST = 'Pulmonologist',
  RADIOLOGIST = 'Radiologist',
  RESPIRATORY_PHYSICIAN = 'Respiratory Physician',
  RHEUMATOLOGIST = 'Rheumatologist',
  UROLOGIST = 'Urologist',
  VASCULAR_SURGEON = 'Vascular Surgeon',
}

/**
 * Retired consultant-title values ("Consultant Cardiologist", …) that the
 * first staging deployment validated against (response_code 006), mapped
 * onto their name-based equivalents so old clients and stored records keep
 * working.
 */
export const LEGACY_REFERRAL_SPECIALTY_TITLES: Record<string, ReferralSpecialtyEnum> = {
  'Consultant Cardiologist': ReferralSpecialtyEnum.CARDIOLOGIST,
  'Consultant Electrophysiologist': ReferralSpecialtyEnum.CARDIOLOGIST,
  'Consultant Haematologist': ReferralSpecialtyEnum.HAEMATOLOGIST,
  'Consultant General Surgeon': ReferralSpecialtyEnum.GENERAL_SURGEON,
  'Consultant Neurologist': ReferralSpecialtyEnum.NEUROLOGIST,
  'Consultant Nephrologist': ReferralSpecialtyEnum.NEPHROLOGIST,
  'Consultant Endocrinologist': ReferralSpecialtyEnum.ENDOCRINOLOGIST,
  'Consultant Gastroenterologist': ReferralSpecialtyEnum.GASTROENTEROLOGIST,
  'Consultant Dermatologist': ReferralSpecialtyEnum.DERMATOLOGIST,
  'Consultant Obstetrician & Gynaecologist': ReferralSpecialtyEnum.GYNAECOLOGIST,
  'Consultant Ophthalmologist': ReferralSpecialtyEnum.OPHTHALMOLOGIST,
  'Consultant Orthopaedic Surgeon': ReferralSpecialtyEnum.ORTHOPAEDIC_SURGEON,
  'Consultant Psychiatrist': ReferralSpecialtyEnum.PSYCHIATRIST,
  'Consultant Oncologist': ReferralSpecialtyEnum.ONCOLOGIST,
};

/**
 * Normalizes any referral specialty value onto the current name-based enum:
 * case-insensitive match against current names first, then against the
 * retired consultant titles; anything else returns null.
 */
export function normalizeReferralSpecialty(
  value?: string | null,
): ReferralSpecialtyEnum | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  const byName = Object.values(ReferralSpecialtyEnum).find(
    (name) => name.toLowerCase() === lowered,
  );
  if (byName) return byName;
  const byTitle = Object.entries(LEGACY_REFERRAL_SPECIALTY_TITLES).find(
    ([title]) => title.toLowerCase() === lowered,
  );
  return byTitle ? byTitle[1] : null;
}

// Add other enums similarly...
