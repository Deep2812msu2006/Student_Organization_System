-- Migration: 003_membership.sql
-- Membership plans, membership periods, and dues obligations.
-- @rule:MEMBERSHIP_VALIDITY — Active status requires valid date window and paid dues.
-- Note: Currency amounts are stored in integer minor units (e.g. paise for INR).

-- ─── Membership plans ────────────────────────────────────────────────────────
CREATE TABLE membership_plans (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description           TEXT        NOT NULL DEFAULT '',
  dues_amount_minor     INTEGER     NOT NULL CHECK (dues_amount_minor >= 0),
  currency              TEXT        NOT NULL CHECK (char_length(currency) = 3),
  ticket_discount_pct   SMALLINT    NOT NULL DEFAULT 0
                          CHECK (ticket_discount_pct BETWEEN 0 AND 100),
  merch_discount_pct    SMALLINT    NOT NULL DEFAULT 0
                          CHECK (merch_discount_pct BETWEEN 0 AND 100),
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed standard annual plan
INSERT INTO membership_plans
  (id, name, description, dues_amount_minor, currency, ticket_discount_pct, merch_discount_pct)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'Standard Membership',
    'Annual Student Association membership',
    50000,
    'INR',
    10,
    5
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Membership periods ───────────────────────────────────────────────────────
CREATE TABLE membership_periods (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
  plan_id           UUID        NOT NULL REFERENCES membership_plans(id)  ON DELETE RESTRICT,
  starts_at         TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  dues_amount_minor INTEGER     NOT NULL CHECK (dues_amount_minor >= 0),
  currency          TEXT        NOT NULL CHECK (char_length(currency) = 3),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (expires_at > starts_at)
);

CREATE INDEX membership_periods_user_expiry_idx
  ON membership_periods (user_id, expires_at);

-- ─── Dues obligations ─────────────────────────────────────────────────────────
CREATE TABLE dues_obligations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_period_id UUID        NOT NULL UNIQUE
                         REFERENCES membership_periods(id) ON DELETE CASCADE,
  amount_minor         INTEGER     NOT NULL CHECK (amount_minor >= 0),
  currency             TEXT        NOT NULL CHECK (char_length(currency) = 3),
  status               TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','paid','waived')),
  paid_at              TIMESTAMPTZ,
  payment_ref          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (status != 'paid' OR paid_at IS NOT NULL)
);

CREATE INDEX dues_obligations_period_idx
  ON dues_obligations (membership_period_id);
