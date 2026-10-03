-- Migration: 006_payment_records.sql
-- Durable payment evidence for manual payment confirmation workflow.
-- Dharmik owns this workflow; Deep reviews schema changes.
--
-- @rule:PAYMENT_ONCE — A payment record is an immutable audit record.
--   The idempotency_key prevents duplicate confirmations.
--   Confirmed registrations cannot be confirmed again.
--   Cancelled registrations cannot be silently restored via payment.
--
-- @rule:PAYMENT_EVIDENCE — Every status change from pending→confirmed
--   must reference a payment record (or a zero-price confirmation path).
--   This table stores durable evidence. It does not simulate a payment gateway.

-- ─── Payment records table ────────────────────────────────────────────────────
CREATE TABLE payment_records (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The registration this payment confirms
  registration_id     UUID        NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  -- Amount and currency must match the registration snapshot
  amount_minor        INTEGER     NOT NULL CHECK (amount_minor >= 0),
  currency            TEXT        NOT NULL CHECK (char_length(currency) = 3),
  -- Method describes how payment was received (cash, bank_transfer, upi, zero_price, etc.)
  method              TEXT        NOT NULL CHECK (char_length(method) BETWEEN 1 AND 50),
  -- Optional external reference (receipt number, transaction ID, etc.)
  external_reference  TEXT        CHECK (external_reference IS NULL OR char_length(external_reference) BETWEEN 1 AND 200),
  -- Notes from the treasurer recording this payment
  notes               TEXT        NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  -- Who recorded this payment (must be an authorized treasurer/organizer)
  recorded_by         UUID        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  -- Idempotency key scoped by recorder, prevents duplicate confirmations
  idempotency_key     TEXT        UNIQUE NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for looking up payment records by registration
CREATE INDEX payment_records_registration_idx
  ON payment_records (registration_id);

-- Index for idempotency key lookups
CREATE INDEX payment_records_idempotency_idx
  ON payment_records (idempotency_key);
