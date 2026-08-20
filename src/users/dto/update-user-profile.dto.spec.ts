import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdatePatientProfileDto } from './update-user-profile.dto';

/**
 * These endpoints declare multipart/form-data (they accept a profile image), and
 * multipart has no array type: one part arrives as a string, several as an array.
 * Before the transform, a single allergy was rejected with 400 while two were
 * accepted — so these cases are the regression guard.
 */
describe('UpdatePatientProfileDto — clinical array fields', () => {
    const build = (payload: Record<string, unknown>) =>
        plainToInstance(UpdatePatientProfileDto, payload);

    const errorsFor = (payload: Record<string, unknown>) =>
        validateSync(build(payload), { whitelist: true, forbidNonWhitelisted: true });

    const FIELDS = [
        'allergies',
        'previous_medical_conditions',
        'medical_flags',
    ] as const;

    describe.each(FIELDS)('%s', (field) => {
        it('accepts a single multipart value and wraps it in an array', () => {
            const dto = build({ [field]: 'Latex' });
            expect(dto[field]).toEqual(['Latex']);
            expect(errorsFor({ [field]: 'Latex' })).toHaveLength(0);
        });

        it('passes through repeated multipart values', () => {
            const dto = build({ [field]: ['Penicillin', 'Peanuts'] });
            expect(dto[field]).toEqual(['Penicillin', 'Peanuts']);
        });

        it('parses a JSON array string', () => {
            const dto = build({ [field]: '["Sulfa","Iodine"]' });
            expect(dto[field]).toEqual(['Sulfa', 'Iodine']);
        });

        it('treats an empty string as clearing the list', () => {
            expect(build({ [field]: '' })[field]).toEqual([]);
        });

        it('leaves the field undefined when absent, so it is not overwritten', () => {
            expect(build({})[field]).toBeUndefined();
        });

        it('trims values and drops blank entries', () => {
            expect(build({ [field]: ['  Asthma  ', '', '  '] })[field]).toEqual(['Asthma']);
        });

        it('rejects non-string entries', () => {
            expect(errorsFor({ [field]: [42] }).length).toBeGreaterThan(0);
        });
    });

    it('never splits on commas — a compound entry stays one value', () => {
        // Splitting would silently turn one allergy into two different ones.
        expect(build({ allergies: 'Peanuts, tree nuts' }).allergies).toEqual([
            'Peanuts, tree nuts',
        ]);
    });

    it('falls back to a single value when a JSON-looking string will not parse', () => {
        expect(build({ allergies: '[not valid json' }).allergies).toEqual(['[not valid json']);
    });

    it('still rejects an unknown property', () => {
        expect(errorsFor({ mrn: 'C-HACKED' }).length).toBeGreaterThan(0);
    });
});
