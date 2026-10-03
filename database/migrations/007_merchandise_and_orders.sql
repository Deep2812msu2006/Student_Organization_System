-- Migration: 007_merchandise_and_orders.sql
-- Merchandise catalog, variant stock management, orders and order items.
--
-- @rule:VARIANT_LOCK_ORDER — When ordering multiple variants in a single transaction,
--   variants MUST be locked in deterministic UUID ascending order (ORDER BY id ASC FOR UPDATE)
--   to prevent PostgreSQL deadlocks under high concurrency.
--
-- @rule:STOCK_DEDUCT_ON_ORDER — Variant stock is checked and decremented inside
--   the order transaction. If any variant has insufficient stock (stock_quantity < quantity),
--   the transaction rolls back entirely, preventing overselling or partial orders.
--   The database constraint CHECK (stock_quantity >= 0) acts as an authoritative backstop.
--
-- @rule:ORDER_IDEMPOTENCY — Each order has a UNIQUE idempotency_key and an
--   idempotency_payload_hash. Retries with the identical payload return the existing
--   order (safe replay). Retries with a changed payload for the same key are rejected.
--
-- @rule:STOCK_RESTORE_ON_CANCEL — Order cancellation performs an atomic conditional
--   status transition (WHERE status IN ('pending', 'paid')) and restores variant stock
--   for each item inside the same transaction. Repeated cancellation calls affect zero
--   rows and cannot restore stock more than once.

-- ─── Products table ───────────────────────────────────────────────────────────
CREATE TABLE products (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description         TEXT        NOT NULL DEFAULT '',
  category            TEXT        NOT NULL DEFAULT 'apparel' CHECK (char_length(category) BETWEEN 1 AND 50),
  is_published        BOOLEAN     NOT NULL DEFAULT true,
  created_by          UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX products_published_idx
  ON products (is_published, created_at DESC)
  WHERE is_published = true;

-- ─── Product variants table ───────────────────────────────────────────────────
-- Each product can have multiple variants (e.g. sizes S, M, L, XL or colors).
CREATE TABLE product_variants (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  sku                 TEXT        CHECK (sku IS NULL OR char_length(sku) BETWEEN 1 AND 50),
  price_minor         INTEGER     NOT NULL CHECK (price_minor >= 0),
  currency            TEXT        NOT NULL CHECK (char_length(currency) = 3),
  stock_quantity      INTEGER     NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (product_id, name)
);

CREATE INDEX product_variants_product_idx
  ON product_variants (product_id, is_active);

-- ─── Orders table ─────────────────────────────────────────────────────────────
CREATE TABLE orders (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                    TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'paid', 'cancelled', 'fulfilled')),
  total_minor               INTEGER     NOT NULL CHECK (total_minor >= 0),
  currency                  TEXT        NOT NULL CHECK (char_length(currency) = 3),
  idempotency_key           TEXT        UNIQUE NOT NULL,
  idempotency_payload_hash  TEXT        NOT NULL,
  cancelled_at              TIMESTAMPTZ,
  cancelled_by              UUID        REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason       TEXT        NOT NULL DEFAULT '',
  paid_at                   TIMESTAMPTZ,
  fulfilled_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (cancelled_at IS NULL OR status = 'cancelled')
);

CREATE INDEX orders_user_idx
  ON orders (user_id, created_at DESC);

CREATE INDEX orders_idempotency_idx
  ON orders (idempotency_key);

-- ─── Order items table ────────────────────────────────────────────────────────
-- Snapshots product name, variant name, and unit price at purchase time.
CREATE TABLE order_items (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                  UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id                UUID        REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_snapshot     TEXT        NOT NULL,
  variant_name_snapshot     TEXT        NOT NULL,
  unit_price_minor_snapshot INTEGER     NOT NULL CHECK (unit_price_minor_snapshot >= 0),
  quantity                  INTEGER     NOT NULL CHECK (quantity > 0),
  total_minor               INTEGER     NOT NULL CHECK (total_minor >= 0),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX order_items_order_idx
  ON order_items (order_id);
