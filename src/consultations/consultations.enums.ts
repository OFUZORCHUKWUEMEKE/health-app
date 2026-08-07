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

// Add other enums similarly...
