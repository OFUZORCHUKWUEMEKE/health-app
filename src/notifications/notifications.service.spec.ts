import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
    NotificationCategory,
    NotificationRecipientType,
    NotificationType,
} from 'src/common/enums';
import { NotificationSpec, NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
    const insertMany = jest.fn();
    const find = jest.fn();
    const countDocuments = jest.fn();
    const updateMany = jest.fn();

    const model = { insertMany, find, countDocuments, updateMany };
    const repository = {
        model: jest.fn(() => model),
        findOneAndUpdate: jest.fn(),
        delete: jest.fn(),
    };

    let service: NotificationsService;

    const scope = {
        recipient_id: new Types.ObjectId().toString(),
        recipient_type: NotificationRecipientType.PATIENT,
    };

    const spec = (over: Partial<NotificationSpec> = {}): NotificationSpec => ({
        recipient_id: scope.recipient_id,
        recipient_type: NotificationRecipientType.PATIENT,
        type: NotificationType.APPOINTMENT_BOOKED,
        category: NotificationCategory.APPOINTMENT,
        title: 'Appointment booked',
        body: 'Your appointment is booked.',
        event_key: 'appointment_booked:a1:patient:p1',
        ...over,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        service = new NotificationsService(repository as any);

        // find() is a chain: .sort().skip().limit().lean()
        find.mockReturnValue({
            sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }),
        });
        countDocuments.mockResolvedValue(0);
        insertMany.mockResolvedValue([{}]);
    });

    describe('createMany', () => {
        it('writes is_read false and read_at null together', async () => {
            await service.createMany([spec()]);
            const [docs] = insertMany.mock.calls[0];
            expect(docs[0]).toMatchObject({ is_read: false, read_at: null });
        });

        it('uses ordered:false so one deduped recipient does not abort the fan-out', async () => {
            await service.createMany([spec(), spec({ event_key: 'k2' })]);
            expect(insertMany).toHaveBeenCalledWith(expect.any(Array), { ordered: false });
        });

        it('treats a duplicate key as deduped, not as a failure', async () => {
            insertMany.mockRejectedValue({
                code: 11000,
                writeErrors: [{ err: { code: 11000 } }],
                insertedDocs: [],
            });
            await expect(service.createMany([spec()])).resolves.toBe(0);
        });

        it('never throws on a real error — a notification must not fail the operation', async () => {
            insertMany.mockRejectedValue(new Error('mongo is down'));
            await expect(service.createMany([spec()])).resolves.toBe(0);
        });

        it('is a no-op for an empty fan-out', async () => {
            await expect(service.createMany([])).resolves.toBe(0);
            expect(insertMany).not.toHaveBeenCalled();
        });
    });

    describe('tenancy', () => {
        // A feed leaking across recipients would expose PHI. Every query must be scoped,
        // and that must not depend on each caller remembering to pass a filter.
        it('scopes list()', async () => {
            await service.list(scope, {} as any);
            const [filter] = find.mock.calls[0];
            expect(filter.recipient_type).toBe(NotificationRecipientType.PATIENT);
            expect(String(filter.recipient_id)).toBe(scope.recipient_id);
        });

        it('scopes unreadCount()', async () => {
            await service.unreadCount(scope);
            const [filter] = countDocuments.mock.calls[0];
            expect(String(filter.recipient_id)).toBe(scope.recipient_id);
            expect(filter.is_read).toBe(false);
        });

        it('scopes markRead()', async () => {
            repository.findOneAndUpdate.mockResolvedValue({ _id: 'n1' });
            await service.markRead(scope, 'n1');
            const [filter] = repository.findOneAndUpdate.mock.calls[0];
            expect(String(filter.recipient_id)).toBe(scope.recipient_id);
            expect(filter._id).toBe('n1');
        });

        it('scopes markAllRead()', async () => {
            updateMany.mockResolvedValue({ modifiedCount: 3 });
            await service.markAllRead(scope);
            const [filter] = updateMany.mock.calls[0];
            expect(String(filter.recipient_id)).toBe(scope.recipient_id);
        });

        it('scopes remove()', async () => {
            repository.delete.mockResolvedValue(true);
            await service.remove(scope, 'n1');
            const [filter] = repository.delete.mock.calls[0];
            expect(String(filter.recipient_id)).toBe(scope.recipient_id);
        });

        it("404s on someone else's id rather than 403, which would confirm it exists", async () => {
            repository.findOneAndUpdate.mockResolvedValue(null);
            await expect(service.markRead(scope, 'other')).rejects.toBeInstanceOf(
                NotFoundException,
            );

            repository.delete.mockResolvedValue(false);
            await expect(service.remove(scope, 'other')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe('markRead / markAllRead', () => {
        it('sets is_read and read_at together, keeping the invariant', async () => {
            repository.findOneAndUpdate.mockResolvedValue({ _id: 'n1' });
            await service.markRead(scope, 'n1');
            const [, update] = repository.findOneAndUpdate.mock.calls[0];
            expect(update.$set.is_read).toBe(true);
            expect(update.$set.read_at).toBeInstanceOf(Date);
        });

        it('markAllRead only touches unread rows', async () => {
            updateMany.mockResolvedValue({ modifiedCount: 2 });
            expect(await service.markAllRead(scope)).toBe(2);
            expect(updateMany.mock.calls[0][0].is_read).toBe(false);
        });
    });

    describe('pagination', () => {
        it('clamps perPage to 100 and page to at least 1', async () => {
            const r = await service.list(scope, { page: 0, perPage: 5000 } as any);
            expect(r.pagination.perPage).toBe(100);
            expect(r.pagination.page).toBe(1);
        });

        it('reports total_pages as 1 when empty, matching the house convention', async () => {
            countDocuments.mockResolvedValue(0);
            const r = await service.list(scope, {} as any);
            expect(r.pagination.total_pages).toBe(1);
        });

        it('applies read/unread and category filters', async () => {
            await service.list(scope, {
                status: 'unread',
                category: NotificationCategory.REMINDER,
            } as any);
            const [filter] = find.mock.calls[0];
            expect(filter.is_read).toBe(false);
            expect(filter.category).toBe(NotificationCategory.REMINDER);
        });
    });
});
