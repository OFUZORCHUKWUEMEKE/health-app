import { model } from 'mongoose';
import { DoctorSchema } from './doctors.model';

describe('DoctorSchema toJSON', () => {
    const DoctorModel = model('DoctorSerialisationTest', DoctorSchema);

    const build = () =>
        new DoctorModel({
            doctor_no: 'DOC-TEST-0001',
            first_name: 'Ada',
            last_name: 'Obi',
            email: 'ada.obi@example.com',
            password_hash: 'hashed',
            mrn: 'C-3622ET',
            refresh_token_hash: 'refresh-hash',
        });

    it('never exposes mrn — doctors store one but responses must not carry it', () => {
        const json = build().toJSON() as Record<string, unknown>;
        expect(json.mrn).toBeUndefined();
    });

    it('still strips the secret fields', () => {
        const json = build().toJSON() as Record<string, unknown>;
        expect(json.password_hash).toBeUndefined();
        expect(json.refresh_token_hash).toBeUndefined();
        expect(json.__v).toBeUndefined();
    });

    it('keeps the fields responses do rely on', () => {
        const json = build().toJSON() as Record<string, unknown>;
        expect(json.doctor_no).toBe('DOC-TEST-0001');
        expect(json.email).toBe('ada.obi@example.com');
    });

    it('stores mrn on the document even though it is hidden', () => {
        expect(build().mrn).toBe('C-3622ET');
    });
});
