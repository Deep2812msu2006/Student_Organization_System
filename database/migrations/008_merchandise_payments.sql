-- Migration: 008_merchandise_payments.sql
-- Additive migration extending payment_records to support merchandise orders
-- while preserving existing event registration payments.
--
-- Deep owns this migration; Dharmik integrates API and staff confirmation UI.
--
-- @rule:PAYMENT_TARGET_MUTEX — A payment record MUST reference exactly ONE target:
--   either registration_id (event ticket) OR order_id (merchandise order).
--
-- @rule:PAYMENT_ONCE — A merchandise order can only be confirmed once.
--   Enforced via UNIQUE index on payment_records(order_id) and atomic status update.
--
-- @rule:PAYMENT_EVIDENCE — Stores durable evidence with FK to orders(id).
--   Orders cannot be deleted while payment audit records exist (ON DELETE RESTRICT).

-- 1. Allow registration_id to be NULL so order payments can omit it
ALTER TABLE payment_records
  ALTER COLUMN registration_id DROP NOT NULL;

-- 2. Add order_id referencing orders(id) with RESTRICT on delete
ALTER TABLE payment_records
  ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE RESTRICT;

-- 3. Enforce exactly one target per payment record (either registration or order)
ALTER TABLE payment_records
  ADD CONSTRAINT payment_records_target_check
  CHECK (
    (registration_id IS NOT NULL AND order_id IS NULL) OR
    (registration_id IS NULL AND order_id IS NOT NULL)
  );

-- 4. Index for order payment lookups
CREATE INDEX payment_records_order_idx
  ON payment_records (order_id)
  WHERE order_id IS NOT NULL;

-- 5. Enforce uniqueness: at most one payment record per order
CREATE UNIQUE INDEX payment_records_unique_order_idx
  ON payment_records (order_id)
  WHERE order_id IS NOT NULL;
