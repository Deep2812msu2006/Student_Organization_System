-- Migration: 005_events_and_registrations.sql
-- Events and ticket registrations database layer.
-- @rule:EVENT_CAPACITY — Allocated seats = count of (pending + confirmed) registrations.
-- @rule:CHECKIN_ONCE — Confirmed tickets can be checked in exactly once.
-- @rule:REGISTRATION_UNIQUENESS — Prevent duplicate active bookings per user per event.

-- ─── Events table ─────────────────────────────────────────────────────────────
CREATE TABLE events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description         TEXT        NOT NULL DEFAULT '',
  venue               TEXT        NOT NULL CHECK (char_length(venue) BETWEEN 1 AND 200),
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  capacity            INTEGER     NOT NULL CHECK (capacity > 0),
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
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  token_hash          TEXT        NOT NULL UNIQUE,
  idempotency_key     TEXT        UNIQUE,
  checked_in_at       TIMESTAMPTZ,
  checked_in_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Only confirmed tickets can have a check-in timestamp
  CHECK (checked_in_at IS NULL OR status = 'confirmed')
);

-- Index for counting allocated seats
CREATE INDEX registrations_event_status_idx
  ON registrations (event_id, status);

-- Enforce at most one active registration per user per event
CREATE UNIQUE INDEX registrations_active_user_event_idx
  ON registrations (event_id, user_id)
  WHERE status IN ('pending', 'confirmed');

CREATE INDEX registrations_user_idx
  ON registrations (user_id, created_at DESC);
