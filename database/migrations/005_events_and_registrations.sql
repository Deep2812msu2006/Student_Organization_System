-- Migration: 005_events_and_registrations.sql
-- Events and ticket registrations database layer.
--
-- @rule:EVENT_CAPACITY — Total allocated seats for an event equals the count of
--   registrations with status IN ('pending', 'confirmed').
--   Pending registrations DO consume capacity to prevent overselling while
--   awaiting payment settlement. Cancelled registrations release capacity.
--   Concurrent bookings must lock the target event row (FOR UPDATE) and verify
--   countAllocatedSeats < capacity before inserting a registration.
--
-- @rule:CHECKIN_ONCE — A ticket can be checked in exactly once.
--   Check-in performs an atomic conditional UPDATE checking:
--     1. event_id matches
--     2. token_hash matches
--     3. status = 'confirmed'
--     4. checked_in_at IS NULL
--   Subsequent or duplicate check-in attempts return zero rows (null in model).
--
-- @rule:REGISTRATION_UNIQUENESS — A user cannot hold duplicate active (pending or confirmed)
--   registrations for the same event. Enforced via unique partial index.
--   Idempotency key prevents duplicate requests from double-booking.

-- ─── Events table ─────────────────────────────────────────────────────────────
CREATE TABLE events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description         TEXT        NOT NULL DEFAULT '',
  venue               TEXT        NOT NULL CHECK (char_length(venue) BETWEEN 1 AND 200),
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  capacity            INTEGER     NOT NULL CHECK (capacity > 0),
  -- Prices stored as integer minor units (paise for INR, cents for USD).
  member_price_minor  INTEGER     NOT NULL CHECK (member_price_minor >= 0),
  public_price_minor  INTEGER     NOT NULL CHECK (public_price_minor >= 0),
  currency            TEXT        NOT NULL CHECK (char_length(currency) = 3),
  status              TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'cancelled')),
  created_by          UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (ends_at > starts_at)
);

-- Index for listing published events by start date.
CREATE INDEX events_published_starts_idx
  ON events (status, starts_at)
  WHERE status = 'published';

-- ─── Registrations table ──────────────────────────────────────────────────────
CREATE TABLE registrations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  price_minor         INTEGER     NOT NULL CHECK (price_minor >= 0),
  currency            TEXT        NOT NULL CHECK (char_length(currency) = 3),
  -- status transitions: pending → confirmed | cancelled
  -- pending:   seat reserved, awaiting payment
  -- confirmed: payment verified, ticket valid for check-in
  -- cancelled: seat released, cannot check in
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  -- token_hash: SHA-256 (or cryptographic hash) of the unguessable ticket token.
  -- Raw ticket tokens are NEVER stored in the database.
  token_hash          TEXT        NOT NULL UNIQUE,
  -- idempotency_key: client-supplied token to deduplicate booking requests safely.
  idempotency_key     TEXT        UNIQUE,
  -- Check-in fields: atomic one-time check-in recorded by authorized staff.
  checked_in_at       TIMESTAMPTZ,
  checked_in_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- @rule:CHECKIN_ONCE: Only confirmed tickets can have a check-in timestamp.
  CHECK (checked_in_at IS NULL OR status = 'confirmed')
);

-- @rule:EVENT_CAPACITY — Index for counting allocated seats (pending + confirmed).
CREATE INDEX registrations_event_status_idx
  ON registrations (event_id, status);

-- @rule:REGISTRATION_UNIQUENESS — Prevent duplicate active bookings per user per event.
CREATE UNIQUE INDEX registrations_active_user_event_idx
  ON registrations (event_id, user_id)
  WHERE status IN ('pending', 'confirmed');

-- Index for users listing their own tickets (GET /tickets/me).
CREATE INDEX registrations_user_idx
  ON registrations (user_id, created_at DESC);
