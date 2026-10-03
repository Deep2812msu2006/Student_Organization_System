-- Migration: 009_dues_and_expenses.sql
-- Membership dues payment evidence, volunteer expense workflow, and financial ledger.
-- @rule:PAYMENT_TARGET_MUTEX — Exactly one target entity permitted per payment row.
-- @rule:DUES_PAYMENT_ONCE — Dues obligation can be confirmed at most once.
-- @rule:EXPENSE_TRANSITIONS — submitted -> approved|rejected -> reimbursed.

-- 1. Extend payment_records to support dues obligations
ALTER TABLE payment_records
  ADD COLUMN dues_obligation_id UUID REFERENCES dues_obligations(id) ON DELETE RESTRICT;

-- 2. Drop previous 2-way target mutex constraint
ALTER TABLE payment_records
  DROP CONSTRAINT payment_records_target_check;

-- 3. Enforce 3-way mutual exclusion on payment targets
ALTER TABLE payment_records
  ADD CONSTRAINT payment_records_target_check
  CHECK (
    (registration_id IS NOT NULL AND order_id IS NULL AND dues_obligation_id IS NULL) OR
    (registration_id IS NULL AND order_id IS NOT NULL AND dues_obligation_id IS NULL) OR
    (registration_id IS NULL AND order_id IS NULL AND dues_obligation_id IS NOT NULL)
  );

-- 4. Indexes for dues payment lookups and uniqueness
CREATE INDEX payment_records_dues_idx
  ON payment_records (dues_obligation_id)
  WHERE dues_obligation_id IS NOT NULL;

CREATE UNIQUE INDEX payment_records_unique_dues_obligation_idx
  ON payment_records (dues_obligation_id)
  WHERE dues_obligation_id IS NOT NULL;

-- ─── Volunteer expenses table ─────────────────────────────────────────────────
CREATE TABLE expenses (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id                  UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_minor                  INTEGER     NOT NULL CHECK (amount_minor > 0),
  currency                      TEXT        NOT NULL CHECK (char_length(currency) = 3),
  purpose                       TEXT        NOT NULL CHECK (char_length(purpose) BETWEEN 3 AND 500),
  receipt_key                   TEXT        NOT NULL CHECK (char_length(receipt_key) BETWEEN 1 AND 500),
  status                        TEXT        NOT NULL DEFAULT 'submitted'
                                  CHECK (status IN ('submitted', 'approved', 'rejected', 'reimbursed')),
  submitted_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at                    TIMESTAMPTZ,
  decided_by                    UUID        REFERENCES users(id) ON DELETE SET NULL,
  decision_reason               TEXT        NOT NULL DEFAULT '' CHECK (char_length(decision_reason) <= 500),
  reimbursed_at                 TIMESTAMPTZ,
  reimbursed_by                 UUID        REFERENCES users(id) ON DELETE SET NULL,
  reimbursement_reference       TEXT        CHECK (reimbursement_reference IS NULL OR char_length(reimbursement_reference) BETWEEN 1 AND 200),
  reimbursement_idempotency_key TEXT        UNIQUE CHECK (reimbursement_idempotency_key IS NULL OR char_length(reimbursement_idempotency_key) BETWEEN 16 AND 100),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Approved/Rejected states must record deciding actor and timestamp
  CHECK (
    status NOT IN ('approved', 'rejected') OR
    (decided_at IS NOT NULL AND decided_by IS NOT NULL)
  ),

  -- Reimbursed state must record decision, reimbursement actor, timestamp, and idempotency key
  CHECK (
    status != 'reimbursed' OR
    (decided_at IS NOT NULL AND decided_by IS NOT NULL AND reimbursed_at IS NOT NULL AND reimbursed_by IS NOT NULL AND reimbursement_idempotency_key IS NOT NULL)
  )
);

CREATE INDEX expenses_requester_idx ON expenses (requester_id);
CREATE INDEX expenses_status_idx ON expenses (status);
CREATE INDEX expenses_created_at_idx ON expenses (created_at DESC);
