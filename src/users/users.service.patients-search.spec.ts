import { UsersService } from './users.service';
import { MAX_PER_PAGE } from 'src/common/utils/pagination.util';

/**
 * Regression tests for the two memory hazards on GET /doctors/patients:
 *
 *  1. `limit` arrived from the query string with no ceiling, so ?limit=1000000
 *     read the whole users collection into the heap as hydrated documents.
 *  2. The consultation fan-out read EVERY consultation belonging to the patients on
 *     the page — bounded by clinical history, not by page size — to keep one id each.
 *
 * Both are asserted on the query the service actually issues, not on the response,
 * because the response looked correct in both the fixed and the broken version.
 */
describe('UsersService.getPatientsWithSearch', () => {
    const limit = jest.fn().mockReturnThis();
    const skip = jest.fn().mockReturnThis();
    const sort = jest.fn().mockReturnThis();
    const lean = jest.fn();
    const find = jest.fn(() => ({ sort, skip, limit, lean }));
    const countDocuments = jest.fn();
    const userModel = { find, countDocuments };

    const aggregate = jest.fn();
    const distinct = jest.fn();
    const consultationFind = jest.fn();
    const consultationModel = { aggregate, distinct, find: consultationFind };

    let service: UsersService;

    beforeEach(() => {
        jest.clearAllMocks();
        sort.mockReturnThis();
        skip.mockReturnThis();
        limit.mockReturnThis();
        find.mockReturnValue({ sort, skip, limit, lean });
        lean.mockResolvedValue([{ _id: 'patient-1' }]);
        countDocuments.mockResolvedValue(1);
        aggregate.mockResolvedValue([
            { _id: 'patient-1', consultation_id: 'consultation-9' },
        ]);
        distinct.mockResolvedValue([]);

        service = new UsersService(
            { model: () => userModel } as any,
            consultationModel as any,
            {} as any,
            {} as any,
            {} as any,
        );
    });

    it('caps an oversized limit before it reaches the query', async () => {
        await service.getPatientsWithSearch('', 1, 1_000_000);

        expect(limit).toHaveBeenCalledWith(MAX_PER_PAGE);
    });

    it('reports the clamped limit back in the pagination metadata', async () => {
        const result = await service.getPatientsWithSearch('', 1, 1_000_000);

        expect(result.pagination.limit).toBe(MAX_PER_PAGE);
    });

    it('passes a sane limit through untouched', async () => {
        await service.getPatientsWithSearch('', 1, 25);

        expect(limit).toHaveBeenCalledWith(25);
    });

    it('rejects a page number that would make skip() go negative', async () => {
        await service.getPatientsWithSearch('', 0, 20);

        expect(skip).toHaveBeenCalledWith(0);
    });

    it('never issues an unbounded consultation find for the fan-out', async () => {
        await service.getPatientsWithSearch('', 1, 20);

        // The old implementation called consultationModel.find({ user_id: { $in } })
        // with no limit. Grouping now happens in the database.
        expect(consultationFind).not.toHaveBeenCalled();
        expect(aggregate).toHaveBeenCalledTimes(1);
    });

    it('groups in the database so at most one row per patient comes back', async () => {
        await service.getPatientsWithSearch('', 1, 20);

        const pipeline = aggregate.mock.calls[0][0];
        const group = pipeline.find((stage: any) => stage.$group);
        expect(group.$group._id).toBe('$user_id');
        expect(group.$group.consultation_id).toEqual({ $first: '$_id' });
    });

    it('still attaches the latest consultation id to each patient', async () => {
        const result = await service.getPatientsWithSearch('', 1, 20);

        expect(result.patients[0].consultation_id).toBe('consultation-9');
    });

    it('reads lean documents rather than hydrated ones', async () => {
        await service.getPatientsWithSearch('', 1, 20);

        expect(lean).toHaveBeenCalled();
    });

    it('uses distinct() for the doctor-association check, not a document read', async () => {
        distinct.mockResolvedValue(['patient-1']);

        const result = await service.getPatientsWithSearch(
            '',
            1,
            20,
            '507f1f77bcf86cd799439011',
        );

        expect(distinct).toHaveBeenCalledWith('user_id', expect.any(Object));
        expect(result.patients[0].has_consultation_with_doctor).toBe(true);
    });

    it('skips both consultation queries entirely when the page is empty', async () => {
        lean.mockResolvedValue([]);
        countDocuments.mockResolvedValue(0);

        await service.getPatientsWithSearch('', 1, 20, '507f1f77bcf86cd799439011');

        expect(aggregate).not.toHaveBeenCalled();
        expect(distinct).not.toHaveBeenCalled();
    });
});
