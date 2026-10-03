-- Migration: 003_membership.sql
-- Membership plans, membership periods, and dues obligations.
--
-- @rule:MEMBERSHIP_VALIDITY — a user's membership is ACTIVE when:
--   1. A membership_periods row exists for the user,
--   2. starts_at <= now() AND expires_at > now(),
--   3. The dues obligation for that period is in state 'paid'.
-- The getMemberProfile() model evaluates all three conditions.
--
-- PROVISIONAL POLICY (demo; must be confirmed with Om before production):
--   - Membership year-end = March 31 of the next calendar year from signup.
--     Example: signup 2026-10-03 → expires 2027-03-31 23:59:59+00.
--   - This is a provisional demo policy, NOT a stated source requirement.
--     Confirm the official academic/calendar year-end with the organization
--     before implementing renewal reminders or displaying this to users.
--   - Currency is 'INR' for demo; this is a suggested demo value, not a
--     source requirement.
--   - Exact money stored as integer minor units (paise for INR).
--     1 rupee = 100 paise. NEVER store money as FLOAT or NUMERIC with division.
--
-- @flow:MEMBER_PERSISTENCE — Om's membership service will:
--   1. BEGIN transaction (own the client).
--   2. Call createMembership(client, {...}) to insert period + dues.
--   3. COMMIT (or ROLLBACK on any error).

-- ─── Membership plans ────────────────────────────────────────────────────────
-- Plans are configuration, not user data. Organizers set them; the server
-- applies them. Clients never supply a price or eligibility directly.
CREATE TABLE membership_plans (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description           TEXT        NOT NULL DEFAULT '',
  -- dues_amount_minor: fee in integer minor currency units (e.g., paise for INR).
  dues_amount_minor     INTEGER     NOT NULL CHECK (dues_amount_minor >= 0),
  currency              TEXT        NOT NULL CHECK (char_length(currency) = 3),
  -- Benefits: snapshot member discount percentage at plan creation.
  -- Provisional: ticket/merch discount. Confirm policy before use.
  ticket_discount_pct   SMALLINT    NOT NULL DEFAULT 0
                          CHECK (ticket_discount_pct BETWEEN 0 AND 100),
  merch_discount_pct    SMALLINT    NOT NULL DEFAULT 0
                          CHECK (merch_discount_pct BETWEEN 0 AND 100),
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert a single provisional demo plan. ON CONFLICT DO NOTHING is safe on
-- re-runs because id is deterministic (we use a fixed value for the seed plan).
-- Actual plan management belongs to the organizer admin API (future milestone).
-- PROVISIONAL DEMO: 500 INR = 50000 paise. Not a stated source requirement.
INSERT INTO membership_plans
  (id, name, description, dues_amount_minor, currency, ticket_discount_pct, merch_discount_pct)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'Standard Membership',
    'Annual Skyline Student Association membership. PROVISIONAL demo plan.',
    50000,   -- 500.00 INR in paise (PROVISIONAL demo value)
    'INR',
    10,      -- 10% ticket discount (PROVISIONAL)
    5        -- 5% merchandise discount (PROVISIONAL)
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Membership periods ───────────────────────────────────────────────────────
-- One row per user per membership period. Renewal creates a new row.
-- @rule:MEMBERSHIP_VALIDITY — starts_at and expires_at define the window.
CREATE TABLE membership_periods (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
  plan_id         UUID        NOT NULL REFERENCES membership_plans(id)  ON DELETE RESTRICT,
  starts_at       TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  -- snapshot the plan's dues at enrollment so plan changes do not retroactively
  -- affect existing obligations.
  dues_amount_minor INTEGER   NOT NULL CHECK (dues_amount_minor >= 0),
  currency          TEXT      NOT NULL CHECK (char_length(currency) = 3),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (expires_at > starts_at)
);

-- @rule:MEMBERSHIP_VALIDITY — index for "is this user a current member?" query.
CREATE INDEX membership_periods_user_expiry_idx
  ON membership_periods (user_id, expires_at);

-- A user should not have two overlapping periods for the same plan.
-- Partial uniqueness: enforce no duplicate active periods for the same user.
-- (Full overlap detection needs an EXCLUSION constraint with tstzrange;
--  that requires btree_gist extension. For now, enforce at service level and
--  document the limitation.)

-- ─── Dues obligations ─────────────────────────────────────────────────────────
-- Tracks whether a membership period's dues have been paid.
-- Payment recording is Dharmik's POST /payments/manual endpoint.
-- This table records the obligation; the payment table (future milestone)
-- records the evidence. The model getMemberProfile() joins both.
--
-- @rule:MEMBERSHIP_VALIDITY — status must be 'paid' for membership to be active.
CREATE TABLE dues_obligations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_period_id UUID       NOT NULL UNIQUE
                        REFERENCES membership_periods(id) ON DELETE CASCADE,
  amount_minor        INTEGER     NOT NULL CHECK (amount_minor >= 0),
  currency            TEXT        NOT NULL CHECK (char_length(currency) = 3),
  -- status transitions: pending → paid | waived
  -- paid:    payment evidence recorded by treasurer (POST /payments/manual).
  -- waived:  treasurer granted exemption (not yet implemented; reserved).
  -- pending: awaiting payment.
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','paid','waived')),
  paid_at             TIMESTAMPTZ,
  -- payment_ref links to the payments table (future Dharmik milestone).
  -- NULL until payment is recorded. This is NOT a FK yet because the
  -- payments table is created in a later migration.
  payment_ref         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (status != 'paid' OR paid_at IS NOT NULL)
);

CREATE INDEX dues_obligations_period_idx
  ON dues_obligations (membership_period_id);
