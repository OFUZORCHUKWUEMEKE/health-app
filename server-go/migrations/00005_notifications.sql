-- +goose Up
-- Milestone 5: notifications.
--
-- Intentional deviations from the Mongoose document:
-- * recipient_id is a plain UUID with NO foreign key — it points at patients
--   or doctors per recipient_type (was: no refPath, never populated).
-- * event_key is NOT NULL UNIQUE (was required+unique, never sparse — the
--   null-collision class cannot occur because NULLs are rejected outright).
-- * Retention has no TTL index in PG — created_at is indexed for a sweeper
--   job (domain milestone), same as OTP expiry in 00002.
-- * The is_read boolean is kept alongside read_at (was: booleans index
--   cleanly where read_at IS NULL does not), plus a partial index for the
--   unread-count query. The is_read === (read_at IS NOT NULL) invariant stays
--   service-side, as in NotificationsService.
-- * Reminder timestamps live on appointments (00003); no separate
--   reminder_claims table — the atomic UPDATE ... WHERE sent_at IS NULL is
--   the claim, matching the compare-and-set protocol.

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL,
    recipient_type TEXT NOT NULL
        CONSTRAINT notifications_recipient_check CHECK (recipient_type IN ('patient', 'doctor')),
    type TEXT NOT NULL
        CONSTRAINT notifications_type_check CHECK (type IN (
            'APPOINTMENT_BOOKED', 'APPOINTMENT_REQUEST_RECEIVED',
            'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED',
            'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_REASSIGNED',
            'APPOINTMENT_REMOVED', 'APPOINTMENT_REMINDER_24H',
            'APPOINTMENT_REMINDER_1H', 'CONSULTATION_SUMMARY_AVAILABLE',
            'INVESTIGATIONS_REQUESTED', 'PRESCRIPTION_READY',
            'REFERRAL_AVAILABLE', 'INVESTIGATION_RESULTS_UPLOADED',
            'VIDEO_ROOM_OPENED')),
    category TEXT NOT NULL
        CONSTRAINT notifications_category_check CHECK (category IN (
            'APPOINTMENT', 'CONSULTATION', 'CLINICAL', 'VIDEO', 'REMINDER')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    appointment_id UUID REFERENCES appointments (id) ON DELETE SET NULL,
    consultation_id UUID REFERENCES consultations (id) ON DELETE SET NULL,
    actor_id UUID,
    actor_type TEXT
        CONSTRAINT notifications_actor_check CHECK (actor_type IN ('patient', 'doctor')),
    deep_link TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    event_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER notifications_updated_at BEFORE UPDATE ON notifications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Feed newest-first; category/type filters are free residual columns.
CREATE INDEX notifications_feed_idx ON notifications (recipient_id, recipient_type, created_at DESC);
-- Unread count / unread feed.
CREATE INDEX notifications_unread_idx ON notifications (recipient_id, recipient_type, created_at DESC)
    WHERE is_read = false;
-- Retention sweeper scan.
CREATE INDEX notifications_retention_idx ON notifications (created_at);

-- +goose Down
DROP TABLE IF EXISTS notifications;
