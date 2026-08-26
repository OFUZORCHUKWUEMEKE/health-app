import { plainToInstance } from 'class-transformer';
import { Validator } from 'class-validator';
import {
  LEGACY_REFERRAL_SPECIALTY_TITLES,
  normalizeReferralSpecialty,
  ReferralSpecialtyEnum,
} from './consultations.enums';
import { CreateReferralDto } from './dto/create-referral.dto';

describe('normalizeReferralSpecialty', () => {
  it('passes current specialty names through canonically', () => {
    expect(normalizeReferralSpecialty('Cardiologist')).toBe(
      ReferralSpecialtyEnum.CARDIOLOGIST,
    );
    expect(normalizeReferralSpecialty('Dentist')).toBe(
      ReferralSpecialtyEnum.DENTIST,
    );
  });

  it('is case-insensitive on current names', () => {
    expect(normalizeReferralSpecialty('cardiologist')).toBe(
      ReferralSpecialtyEnum.CARDIOLOGIST,
    );
    expect(normalizeReferralSpecialty(' ent specialist ')).toBe(
      ReferralSpecialtyEnum.ENT_SPECIALIST,
    );
  });

  it.each(Object.entries(LEGACY_REFERRAL_SPECIALTY_TITLES))(
    'maps legacy title "%s" to %s',
    (title, expected) => {
      expect(normalizeReferralSpecialty(title)).toBe(expected);
    },
  );

  it('maps legacy titles case-insensitively', () => {
    expect(normalizeReferralSpecialty('consultant cardiologist')).toBe(
      ReferralSpecialtyEnum.CARDIOLOGIST,
    );
  });

  it('returns null for unknown or empty values', () => {
    expect(normalizeReferralSpecialty('Chief Wizard of Cardiology')).toBeNull();
    expect(normalizeReferralSpecialty('')).toBeNull();
    expect(normalizeReferralSpecialty(null)).toBeNull();
    expect(normalizeReferralSpecialty(undefined)).toBeNull();
  });
});

describe('ReferralSpecialtyEnum', () => {
  it('holds no consultant-title values and mirrors the frontend master list size', () => {
    const values = Object.values(ReferralSpecialtyEnum);
    expect(values).toHaveLength(33);
    expect(values.some((value) => /^Consultant\b/.test(value))).toBe(false);
  });
});

/**
 * Replays real request bodies through the same transform + whitelist +
 * validation sequence the global ValidationPipe applies, so a staging
 * regression like response_code 006 ("specialty must be one of the following
 * values: Consultant Cardiologist, …") fails here first.
 */
describe('CreateReferralDto through ValidationPipe semantics', () => {
  const validator = new Validator();

  async function pipeLikeValidate(payload: Record<string, unknown>) {
    const instance = plainToInstance(CreateReferralDto, payload);
    const errors = await validator.validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return { instance, errors };
  }

  it('accepts the payload shape that failed on staging (name-based specialty)', async () => {
    const { instance, errors } = await pipeLikeValidate({
      specialty: 'Cardiologist',
      specialist_name: 'Dr. Okoh',
      hospital: 'Lagos University Teaching Hospital',
      hospital_address: ['Idi-Araba', 'Surulere', 'Lagos State', 'Nigeria'],
      attachment_investigation_ids: ['66c9f0e1a1b2c3d4e5f60718'],
      referral_details: 'Persistent chest pain; rule out cardiac involvement.',
      assign_to_patient: true,
    });
    expect(errors).toEqual([]);
    expect(instance.specialty).toBe(ReferralSpecialtyEnum.CARDIOLOGIST);
    expect(instance.hospital_address).toHaveLength(4);
    expect(instance.attachment_investigation_ids).toHaveLength(1);
  });

  it('still accepts retired consultant titles and stores the name equivalent', async () => {
    const { instance, errors } = await pipeLikeValidate({
      specialty: 'Consultant Obstetrician & Gynaecologist',
      specialist_name: 'Dr. Ada Obi',
      hospital: 'National Hospital Abuja',
      referral_details: 'Antenatal follow-up.',
    });
    expect(errors).toEqual([]);
    expect(instance.specialty).toBe(ReferralSpecialtyEnum.GYNAECOLOGIST);
  });

  it('keeps legacy payloads without the new fields valid', async () => {
    const { errors } = await pipeLikeValidate({
      specialist_name: 'Dr. Old Record',
      hospital: 'Some Clinic',
      referral_details: 'Legacy referral.',
    });
    expect(errors).toEqual([]);
  });

  it('degrades unknown specialty values to absent instead of failing the save', async () => {
    // Deliberate: after response_code 006 blocked staging saves, the pipe
    // must never reject a referral over the specialty list again. Unknown
    // values become undefined (optional field) and the letter omits the
    // specialty line; the UI select prevents this case in practice.
    const { instance, errors } = await pipeLikeValidate({
      specialty: 'Chief Wizard of Cardiology',
      specialist_name: 'Dr. X',
      hospital: 'Y',
      referral_details: 'Z',
    });
    expect(errors).toEqual([]);
    expect(instance.specialty).toBeUndefined();
  });
});
