import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FilterQuery, Types } from 'mongoose';
import {
    NotificationCategory,
    NotificationRecipientType,
    NotificationType,
} from 'src/common/enums';
import { ListNotificationsQueryDto } from './dto/list-notifications.dto';
import { NotificationDocument } from './models/notification.model';
import { NotificationsRepository } from './notifications.repository';

/**
 * What a listener hands over. Deliberately not a Mongoose object: listeners own the copy,
 * this service owns persistence, and neither knows about the other's internals.
 */
export interface NotificationSpec {
    recipient_id: string | Types.ObjectId;
    recipient_type: NotificationRecipientType;
    type: NotificationType;
    category: NotificationCategory;
    title: string;
    body: string;
    event_key: string;
    data?: Record<string, unknown>;
    appointment_id?: string | Types.ObjectId | null;
    consultation_id?: string | Types.ObjectId | null;
    actor_id?: string | Types.ObjectId | null;
    actor_type?: NotificationRecipientType | null;
    deep_link?: string | null;
}

interface RecipientScope {
    recipient_id: string;
    recipient_type: NotificationRecipientType;
}

const MAX_PER_PAGE = 100;
const DEFAULT_PER_PAGE = 20;

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(private readonly repository: NotificationsRepository) { }

    // ─── Write ──────────────────────────────────────────

    /**
     * The single seam for delivery. Email, push and realtime all attach HERE later — adding
     * a second sink after the insert is the entire change, and nothing above this method
     * needs to know.
     *
     * Never throws. A notification failure must not fail the domain operation that caused
     * it, matching the codebase's `try { await } catch { logger.warn }` idiom. Listener
     * errors are already suppressed by @nestjs/event-emitter, but that suppression is
     * per-handler; this keeps one bad recipient from losing the others.
     */
    async createMany(specs: NotificationSpec[]): Promise<number> {
        if (!specs.length) return 0;

        const docs = specs.map((spec) => ({
            recipient_id: new Types.ObjectId(String(spec.recipient_id)),
            recipient_type: spec.recipient_type,
            type: spec.type,
            category: spec.category,
            title: spec.title,
            body: spec.body,
            data: spec.data ?? {},
            appointment_id: spec.appointment_id
                ? new Types.ObjectId(String(spec.appointment_id))
                : null,
            consultation_id: spec.consultation_id
                ? new Types.ObjectId(String(spec.consultation_id))
                : null,
            actor_id: spec.actor_id ? new Types.ObjectId(String(spec.actor_id)) : null,
            actor_type: spec.actor_type ?? null,
            deep_link: spec.deep_link ?? null,
            is_read: false,
            read_at: null,
            event_key: spec.event_key,
        }));

        try {
            // insertMany with ordered:false, NOT CoreRepository.createMany — that delegates
            // to Model.create(array), which is ordered, so one duplicate aborts every
            // remaining recipient. Here a deduped row must not cost the others.
            const inserted = await this.repository
                .model()
                .insertMany(docs, { ordered: false });
            return inserted.length;
        } catch (error: any) {
            // E11000 means the event_key unique index caught a replay — a retried request,
            // a polled endpoint, a re-run scheduler tick. That is the index doing its job,
            // not a fault.
            const writeErrors = error?.writeErrors ?? [];
            const duplicates = writeErrors.filter((e: any) => e?.err?.code === 11000).length;
            const inserted = error?.insertedDocs?.length ?? 0;

            if (error?.code === 11000 || duplicates === writeErrors.length) {
                this.logger.debug(
                    `Skipped ${duplicates || specs.length} duplicate notification(s); inserted ${inserted}.`,
                );
                return inserted;
            }

            this.logger.warn(
                `Failed to create notification(s): ${error?.message ?? error}. ` +
                `Inserted ${inserted}/${specs.length}. The originating operation is unaffected.`,
            );
            return inserted;
        }
    }

    // ─── Read ───────────────────────────────────────────

    async list(scope: RecipientScope, query: ListNotificationsQueryDto) {
        const page = Math.max(1, Number(query.page) || 1);
        const perPage = Math.min(
            Math.max(1, Number(query.perPage) || DEFAULT_PER_PAGE),
            MAX_PER_PAGE,
        );

        const filter = this.scopedFilter(scope);
        if (query.status === 'read') filter.is_read = true;
        if (query.status === 'unread') filter.is_read = false;
        if (query.category) filter.category = query.category;
        if (query.type) filter.type = query.type;

        const [items, total, unread_count] = await Promise.all([
            this.repository
                .model()
                .find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * perPage)
                .limit(perPage)
                .lean(),
            this.repository.model().countDocuments(filter),
            this.unreadCount(scope),
        ]);

        return {
            items,
            pagination: {
                total,
                page,
                perPage,
                total_pages: total === 0 ? 1 : Math.ceil(total / perPage),
            },
            // Bundled so a client rendering a bell badge alongside a list needs one call.
            unread_count,
        };
    }

    async unreadCount(scope: RecipientScope): Promise<number> {
        return this.repository
            .model()
            .countDocuments({ ...this.scopedFilter(scope), is_read: false });
    }

    // ─── Mutate ─────────────────────────────────────────

    async markRead(scope: RecipientScope, id: string): Promise<NotificationDocument> {
        const updated = await this.repository.findOneAndUpdate(
            { ...this.scopedFilter(scope), _id: id },
            { $set: { is_read: true, read_at: new Date() } },
            {},
        );

        // Scoped filter means someone else's id is indistinguishable from a missing one —
        // a 404, never a 403 that would confirm the row exists.
        if (!updated) throw new NotFoundException('Notification not found');
        return updated;
    }

    async markAllRead(scope: RecipientScope): Promise<number> {
        const result = await this.repository
            .model()
            .updateMany(
                { ...this.scopedFilter(scope), is_read: false },
                { $set: { is_read: true, read_at: new Date() } },
            );
        return result.modifiedCount ?? 0;
    }

    async remove(scope: RecipientScope, id: string): Promise<void> {
        const deleted = await this.repository.delete({
            ...this.scopedFilter(scope),
            _id: id,
        });
        if (!deleted) throw new NotFoundException('Notification not found');
    }

    /**
     * Every query in this service goes through here. Tenancy is not optional and not the
     * caller's job to remember — a feed leaking across recipients would expose PHI.
     */
    private scopedFilter(scope: RecipientScope): FilterQuery<NotificationDocument> {
        return {
            recipient_id: new Types.ObjectId(String(scope.recipient_id)),
            recipient_type: scope.recipient_type,
        };
    }
}
