import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService.getUserSummary', () => {
    const findOne = jest.fn();
    const repository = { findOne };

    let service: UsersService;

    const patient = (over: Record<string, any> = {}) => ({
        _id: 'patient-1',
        registration_no: 'REG-1',
        first_name: 'Ada',
        last_name: 'Obi',
        email: 'ada@example.com',
        verified: true,
        allergies: ['Peanuts', 'Latex'],
        previous_medical_conditions: ['Asthma'],
        ...over,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        service = new UsersService(
            repository as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
    });

    it('returns the stored allergies and previous medical conditions', async () => {
        findOne.mockResolvedValue(patient());

        const summary = await service.getUserSummary('patient-1');

        expect(summary.allergies).toEqual(['Peanuts', 'Latex']);
        expect(summary.previous_medical_conditions).toEqual(['Asthma']);
    });

    it('falls back to empty arrays for documents predating the medical fields', async () => {
        findOne.mockResolvedValue(
            patient({ allergies: undefined, previous_medical_conditions: undefined }),
        );

        const summary = await service.getUserSummary('patient-1');

        expect(summary.allergies).toEqual([]);
        expect(summary.previous_medical_conditions).toEqual([]);
    });

    it('throws when the patient does not exist', async () => {
        findOne.mockResolvedValue(null);

        await expect(service.getUserSummary('missing')).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });
});
