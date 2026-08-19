import { InternalServerErrorException } from '@nestjs/common';
import { MrnService } from './mrn.service';
import { MrnOwnerType } from 'src/common/enums';
import { MRN_REGEX } from 'src/utils/code-generator.util';

/** What Mongo raises when the unique index on mrn_registry.mrn rejects an insert. */
function duplicateKeyError() {
    return Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
}

describe('MrnService', () => {
    const registryModel = { create: jest.fn(), updateOne: jest.fn() };

    let service: MrnService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new MrnService(registryModel as any);
    });

    describe('generateUniqueMrn', () => {
        it('returns a well-formed MRN once the reservation lands', async () => {
            registryModel.create.mockResolvedValue({});

            await expect(service.generateUniqueMrn(MrnOwnerType.PATIENT)).resolves.toMatch(
                MRN_REGEX,
            );
            expect(registryModel.create).toHaveBeenCalledTimes(1);
        });

        it('reserves the value it returns, tagged with the owner type', async () => {
            registryModel.create.mockResolvedValue({});

            const mrn = await service.generateUniqueMrn(MrnOwnerType.DOCTOR);

            expect(registryModel.create).toHaveBeenCalledWith({
                mrn,
                owner_type: MrnOwnerType.DOCTOR,
                owner_id: null,
            });
        });

        it('treats E11000 as "taken" and retries', async () => {
            registryModel.create
                .mockRejectedValueOnce(duplicateKeyError())
                .mockRejectedValueOnce(duplicateKeyError())
                .mockResolvedValue({});

            await expect(service.generateUniqueMrn(MrnOwnerType.PATIENT)).resolves.toMatch(
                MRN_REGEX,
            );
            expect(registryModel.create).toHaveBeenCalledTimes(3);
        });

        it('draws a fresh candidate on each retry rather than resubmitting the same one', async () => {
            registryModel.create
                .mockRejectedValueOnce(duplicateKeyError())
                .mockResolvedValue({});

            await service.generateUniqueMrn(MrnOwnerType.PATIENT);

            const [first, second] = registryModel.create.mock.calls;
            expect(first[0].mrn).not.toEqual(second[0].mrn);
        });

        // A dropped connection is not a collision — retrying 10 times would bury the
        // real fault and hand back an MRN that was never actually reserved.
        it('propagates non-duplicate errors instead of retrying', async () => {
            const boom = Object.assign(new Error('connection reset'), { code: 89 });
            registryModel.create.mockRejectedValue(boom);

            await expect(service.generateUniqueMrn(MrnOwnerType.PATIENT)).rejects.toBe(boom);
            expect(registryModel.create).toHaveBeenCalledTimes(1);
        });

        it('gives up after MAX_ATTEMPTS rather than looping forever', async () => {
            registryModel.create.mockRejectedValue(duplicateKeyError());

            await expect(service.generateUniqueMrn(MrnOwnerType.PATIENT)).rejects.toBeInstanceOf(
                InternalServerErrorException,
            );
            expect(registryModel.create).toHaveBeenCalledTimes(10);
        });
    });

    describe('claim', () => {
        it('attaches the owner to the reserved row', async () => {
            registryModel.updateOne.mockResolvedValue({ matchedCount: 1 });

            await service.claim('C-ABC123', 'deadbeefdeadbeefdeadbeef');

            expect(registryModel.updateOne).toHaveBeenCalledWith(
                { mrn: 'C-ABC123' },
                { $set: { owner_id: 'deadbeefdeadbeefdeadbeef' } },
            );
        });

        // The account already exists by the time this runs. Uniqueness was settled at
        // reservation, so losing the owner breadcrumb must not fail the signup.
        it('swallows failures so it cannot break an already-created account', async () => {
            registryModel.updateOne.mockRejectedValue(new Error('write concern timeout'));

            await expect(service.claim('C-ABC123', 'deadbeefdeadbeefdeadbeef')).resolves.toBeUndefined();
        });
    });
});
