-- Migration: 006_payment_records.sql
-- Durable payment evidence for manual payment confirmation workflow.
-- @rule:PAYMENT_ONCE — Idempotency key prevents duplicate confirmations.
-- @rule:PAYMENT_EVIDENCE — Stores durable payment proof.

-- ─── Payment records table ────────────────────────────────────────────────────
CREATE TABLE payment_records (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id     UUID        NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  amount_minor        INTEGER     NOT NULL CHECK (amount_minor >= 0),
  currency            TEXT        NOT NULL CHECK (char_length(currency) = 3),
  method              TEXT        NOT NULL CHECK (char_length(method) BETWEEN 1 AND 50),
  external_reference  TEXT        CHECK (external_reference IS NULL OR char_length(external_reference) BETWEEN 1 AND 200),
  notes               TEXT        NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  recorded_by         UUID        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key     TEXT        UNIQUE NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payment_records_registration_idx
  ON payment_records (registration_id);

CREATE INDEX payment_records_idempotency_idx
  ON payment_records (idempotency_key);
