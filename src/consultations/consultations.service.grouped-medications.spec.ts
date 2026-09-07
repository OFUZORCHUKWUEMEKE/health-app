import { ConsultationsService } from './consultations.service';
import { MAX_PER_PAGE } from 'src/common/utils/pagination.util';

/**
 * Regression tests for GET /doctors/consultations/medications/grouped (and its patient
 * twin).
 *
 * Both routes used to read every medication matching the filter — a doctor's entire
 * prescribing history — with a nested double-populate on each row, group them in JS,
 * and slice the page out afterwards. The pagination was cosmetic: the response was
 * correct, the memory cost was the whole history, and it grew with every prescription.
 *
 * So these assert on the QUERIES, not the response. A test that only checked the
 * returned groups passed against the broken version too — that is precisely why the
 * problem survived this long.
 */
describe('ConsultationsService — grouped medications paging', () => {
    const aggregate = jest.fn();
    const lean = jest.fn();
    const sort = jest.fn(() => ({ lean }));
    const populate = jest.fn();
    const find = jest.fn(() => ({ populate }));
    const medicationModel = { aggregate, find };

    let service: ConsultationsService;

    const DOCTOR_ID = '507f1f77bcf86cd799439011';
    const PATIENT_ID = '507f191e810c19729de860ea';

    const consultationA = { _id: 'consultation-a' };
    const consultationB = { _id: 'consultation-b' };

    const med = (over: Record<string, any> = {}) => ({
        _id: 'med-1',
        consultation_id: consultationA,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ...over,
    });

    const construct = () =>
        new ConsultationsService(
            {} as any, {} as any, {} as any, {} as any,
            { model: () => medicationModel } as any,
            {} as any, {} as any, {} as any, {} as any, {} as any,
            {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );

    beforeEach(() => {
        jest.clearAllMocks();
        // The populate chain is fluent and ends in .sort().lean().
        populate.mockReturnValue({ populate, sort });
        sort.mockReturnValue({ lean });
        find.mockReturnValue({ populate });
        lean.mockResolvedValue([med()]);
        aggregate.mockResolvedValue([
            { data: [{ _id: 'consultation-a' }], meta: [{ total: 37 }] },
        ]);
        service = construct();
    });

    describe('doctor route', () => {
        it('pages the consultation groups in the database before reading documents', async () => {
            await service.getDoctorMedicationsGroupedByConsultation(DOCTOR_ID, 2, 20);

            const pipeline = aggregate.mock.calls[0][0];
            const group = pipeline.find((s: any) => s.$group);
            const facet = pipeline.find((s: any) => s.$facet);

            expect(group.$group._id).toBe('$consultation_id');
            expect(facet.$facet.data).toEqual(
                expect.arrayContaining([{ $skip: 20 }, { $limit: 20 }]),
            );
        });

        it('keeps the paging pipeline cheap — no documents pushed, nothing joined', async () => {
            await service.getDoctorMedicationsGroupedByConsultation(DOCTOR_ID, 1, 20);

            const serialised = JSON.stringify(aggregate.mock.calls[0][0]);
            // $push of $$ROOT or a $lookup here would put the whole history back in
            // the widest stage, which is the cost this rewrite exists to remove.
            expect(serialised).not.toContain('$push');
            expect(serialised).not.toContain('$lookup');
        });

        it('restricts the populated read to the consultations on this page', async () => {
            await service.getDoctorMedicationsGroupedByConsultation(DOCTOR_ID, 1, 20);

            expect(find).toHaveBeenCalledWith(
                expect.objectContaining({
                    consultation_id: { $in: ['consultation-a'] },
                }),
            );
        });

        it('reports the total number of groups, not the size of the page', async () => {
            const result = await service.getDoctorMedicationsGroupedByConsultation(
                DOCTOR_ID,
                1,
                20,
            );

            expect(result.pagination.total).toBe(37);
            expect(result.pagination.total_pages).toBe(2);
            expect(result.groups).toHaveLength(1);
        });

        it('clamps an oversized page size before it reaches the pipeline', async () => {
            await service.getDoctorMedicationsGroupedByConsultation(
                DOCTOR_ID,
                1,
                1_000_000,
            );

            const facet = aggregate.mock.calls[0][0].find((s: any) => s.$facet);
            expect(facet.$facet.data).toEqual(
                expect.arrayContaining([{ $limit: MAX_PER_PAGE }]),
            );
        });

        it('does not read any document when the page is empty', async () => {
            aggregate.mockResolvedValue([{ data: [], meta: [] }]);

            const result = await service.getDoctorMedicationsGroupedByConsultation(
                DOCTOR_ID,
                9,
                20,
            );

            expect(find).not.toHaveBeenCalled();
            expect(result.groups).toEqual([]);
            expect(result.pagination.total).toBe(0);
        });

        it('groups the page by consultation and orders newest activity first', async () => {
            aggregate.mockResolvedValue([
                {
                    data: [{ _id: 'consultation-a' }, { _id: 'consultation-b' }],
                    meta: [{ total: 2 }],
                },
            ]);
            lean.mockResolvedValue([
                med({ _id: 'old', consultation_id: consultationA, createdAt: new Date('2026-01-01') }),
                med({ _id: 'new', consultation_id: consultationB, createdAt: new Date('2026-06-01') }),
                med({ _id: 'old-2', consultation_id: consultationA, createdAt: new Date('2026-02-01') }),
            ]);

            const result = await service.getDoctorMedicationsGroupedByConsultation(
                DOCTOR_ID,
                1,
                20,
            );

            expect(result.groups.map((g: any) => g.consultation._id)).toEqual([
                'consultation-b',
                'consultation-a',
            ]);
            expect(result.groups[1].medication_count).toBe(2);
        });

        it('does not leak the internal ordering key into the response', async () => {
            const result = await service.getDoctorMedicationsGroupedByConsultation(
                DOCTOR_ID,
                1,
                20,
            );

            expect(result.groups[0]).not.toHaveProperty('latest_created_at');
            expect(Object.keys(result.groups[0]).sort()).toEqual([
                'consultation',
                'medication_count',
                'medications',
            ]);
        });
    });

    describe('patient route', () => {
        beforeEach(() => {
            // buildPatientAssignedMedicationFilter reads the patient's consultation ids.
            (service as any).getPatientConsultationIds = jest
                .fn()
                .mockResolvedValue([]);
        });

        it('pages groups first and restricts the read to this page', async () => {
            await service.getPatientMedicationsGroupedByConsultation(
                PATIENT_ID,
                1,
                20,
            );

            expect(aggregate).toHaveBeenCalledTimes(1);
            expect(find).toHaveBeenCalledWith(
                expect.objectContaining({
                    consultation_id: { $in: ['consultation-a'] },
                }),
            );
        });

        it('keeps the assignment condition alongside the page restriction', async () => {
            await service.getPatientMedicationsGroupedByConsultation(
                PATIENT_ID,
                1,
                20,
            );

            // Narrowing to the page must not drop assign_to_patient, or the route
            // would start returning medications never released to the patient.
            expect(find).toHaveBeenCalledWith(
                expect.objectContaining({ assign_to_patient: true }),
            );
        });

        it('does not read any document when the page is empty', async () => {
            aggregate.mockResolvedValue([{ data: [], meta: [] }]);

            await service.getPatientMedicationsGroupedByConsultation(
                PATIENT_ID,
                1,
                20,
            );

            expect(find).not.toHaveBeenCalled();
        });
    });
});
