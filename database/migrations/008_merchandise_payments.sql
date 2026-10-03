-- Migration: 008_merchandise_payments.sql
-- Extend payment_records to support merchandise orders.
-- @rule:PAYMENT_TARGET_MUTEX — Payment must reference either an event ticket or order.
-- @rule:PAYMENT_ONCE — Merchandise order can be confirmed at most once.

-- 1. Allow registration_id to be NULL for order payments
ALTER TABLE payment_records
  ALTER COLUMN registration_id DROP NOT NULL;

-- 2. Add order_id foreign key
ALTER TABLE payment_records
  ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE RESTRICT;

-- 3. Enforce mutual exclusion between event ticket and order targets
ALTER TABLE payment_records
  ADD CONSTRAINT payment_records_target_check
  CHECK (
    (registration_id IS NOT NULL AND order_id IS NULL) OR
    (registration_id IS NULL AND order_id IS NOT NULL)
  );

-- 4. Indexes for order payment lookups and uniqueness
CREATE INDEX payment_records_order_idx
  ON payment_records (order_id)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX payment_records_unique_order_idx
  ON payment_records (order_id)
  WHERE order_id IS NOT NULL;
