/**
 * server/model/merchandise.model.js — Deep owns this file.
 *
 * Merchandise catalog, variants, stock allocation, orders and order items.
 *
 * Design constraints:
 *  - Parameterized SQL only ($1, $2, ...).
 *  - Accepts `db` (pg.Pool or pg.PoolClient).
 *  - Services own transactions. Functions participating in transactions
 *    use the caller's PoolClient; they never issue BEGIN, COMMIT, or ROLLBACK.
 *  - Prices stored in integer minor units (paise/cents).
 *  - Order items preserve product/variant name and price snapshots.
 *
 * Invariants:
 *  - @rule:VARIANT_LOCK_ORDER: Multi-variant orders lock variants deterministically
 *    by UUID ASC (ORDER BY id ASC FOR UPDATE) to eliminate deadlock risks.
 *  - @rule:STOCK_DEDUCT_ON_ORDER: Variant stock is verified and decremented inside
 *    the order transaction. Orders with insufficient stock rollback entirely.
 *  - @rule:ORDER_IDEMPOTENCY: Same idempotency key + matching payload returns existing order.
 *    Same idempotency key + different payload is rejected.
 *  - @rule:STOCK_RESTORE_ON_CANCEL: Order cancellation conditionally updates status
 *    and restores variant stock at most once.
 */

/**
 * List published products with active variants and stock availability.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ page?: number, pageSize?: number, category?: string | null }} [params]
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number }>}
 */
export async function listPublishedProducts(db, { page = 1, pageSize = 20, category = null } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (safePage - 1) * safePageSize;

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM products
     WHERE is_published = true
       AND ($1::text IS NULL OR category = $1)`,
    [category]
  );
  const total = countResult.rows[0]?.total ?? 0;

  const { rows } = await db.query(
    `SELECT
       p.id,
       p.name,
       p.description,
       p.category,
       p.is_published AS "isPublished",
       p.created_at AS "createdAt",
       COALESCE(
         json_agg(
           json_build_object(
             'id', pv.id,
             'name', pv.name,
             'sku', pv.sku,
             'priceMinor', pv.price_minor,
             'currency', pv.currency,
             'stockQuantity', pv.stock_quantity,
             'inStock', pv.stock_quantity > 0,
             'isActive', pv.is_active
           ) ORDER BY pv.price_minor ASC, pv.name ASC
         ) FILTER (WHERE pv.id IS NOT NULL),
         '[]'::json
       ) AS variants
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
     WHERE p.is_published = true
       AND ($1::text IS NULL OR p.category = $1)
     GROUP BY p.id
     ORDER BY p.created_at DESC, p.id ASC
     LIMIT $2 OFFSET $3`,
    [category, safePageSize, offset]
  );

  return {
    rows,
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

/**
 * Fetch a single product with its active variants by ID.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} productId
 * @returns {Promise<object | null>}
 */
export async function getProductById(db, productId) {
  const { rows } = await db.query(
    `SELECT
       p.id,
       p.name,
       p.description,
       p.category,
       p.is_published AS "isPublished",
       p.created_at AS "createdAt",
       COALESCE(
         json_agg(
           json_build_object(
             'id', pv.id,
             'name', pv.name,
             'sku', pv.sku,
             'priceMinor', pv.price_minor,
             'currency', pv.currency,
             'stockQuantity', pv.stock_quantity,
             'inStock', pv.stock_quantity > 0,
             'isActive', pv.is_active
           ) ORDER BY pv.price_minor ASC, pv.name ASC
         ) FILTER (WHERE pv.id IS NOT NULL),
         '[]'::json
       ) AS variants
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
     WHERE p.id = $1
     GROUP BY p.id`,
    [productId]
  );

  return rows[0] ?? null;
}

/**
 * Create a new product.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ name: string, description?: string, category?: string, isPublished?: boolean, createdBy?: string | null }} params
 * @returns {Promise<object>}
 */
export async function createProduct(db, {
  name,
  description = '',
  category = 'apparel',
  isPublished = true,
  createdBy = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO products
       (name, description, category, is_published, created_by)
     VALUES
       ($1, $2, $3, $4, $5)
     RETURNING
       id,
       name,
       description,
       category,
       is_published AS "isPublished",
       created_by AS "createdBy",
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [name, description, category, isPublished, createdBy]
  );

  return rows[0];
}

/**
 * Create a product variant.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ productId: string, name: string, sku?: string | null, priceMinor: number, currency: string, stockQuantity?: number, isActive?: boolean }} params
 * @returns {Promise<object>}
 */
export async function createProductVariant(db, {
  productId,
  name,
  sku = null,
  priceMinor,
  currency,
  stockQuantity = 0,
  isActive = true,
}) {
  const { rows } = await db.query(
    `INSERT INTO product_variants
       (product_id, name, sku, price_minor, currency, stock_quantity, is_active)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7)
     RETURNING
       id,
       product_id AS "productId",
       name,
       sku,
       price_minor AS "priceMinor",
       currency,
       stock_quantity AS "stockQuantity",
       is_active AS "isActive",
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [productId, name, sku, priceMinor, currency, stockQuantity, isActive]
  );

  return rows[0];
}

/**
 * Lock variants in deterministic order (by UUID ASC) inside an order transaction.
 *
 * @rule:VARIANT_LOCK_ORDER — Prevents deadlocks during concurrent multi-item checkout.
 *
 * @param {import('pg').PoolClient} client
 * @param {Array<string>} variantIds
 * @returns {Promise<Array<object>>}
 */
export async function lockVariantsForOrder(client, variantIds) {
  if (!variantIds || variantIds.length === 0) return [];

  const { rows } = await client.query(
    `SELECT
       pv.id,
       pv.product_id AS "productId",
       pv.name AS "variantName",
       pv.sku,
       pv.price_minor AS "priceMinor",
       pv.currency,
       pv.stock_quantity AS "stockQuantity",
       pv.is_active AS "isActive",
       p.name AS "productName"
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.id = ANY($1::uuid[])
     ORDER BY pv.id ASC
     FOR UPDATE`,
    [variantIds]
  );

  return rows;
}

/**
 * Decrement variant stock inside a transaction.
 *
 * @rule:STOCK_DEDUCT_ON_ORDER — Decrements only if current stock >= quantity.
 *
 * @param {import('pg').PoolClient} client
 * @param {{ variantId: string, quantity: number }} params
 * @returns {Promise<object | null>} Updated row or null if insufficient stock.
 */
export async function decrementVariantStock(client, { variantId, quantity }) {
  const { rows } = await client.query(
    `UPDATE product_variants
     SET
       stock_quantity = stock_quantity - $1,
       updated_at = now()
     WHERE id = $2 AND stock_quantity >= $1
     RETURNING
       id,
       stock_quantity AS "stockQuantity"`,
    [quantity, variantId]
  );

  return rows[0] ?? null;
}

/**
 * Increment variant stock (used on cancellation or restock).
 *
 * @param {import('pg').PoolClient} client
 * @param {{ variantId: string, quantity: number }} params
 * @returns {Promise<object | null>}
 */
export async function incrementVariantStock(client, { variantId, quantity }) {
  const { rows } = await client.query(
    `UPDATE product_variants
     SET
       stock_quantity = stock_quantity + $1,
       updated_at = now()
     WHERE id = $2
     RETURNING
       id,
       stock_quantity AS "stockQuantity"`,
    [quantity, variantId]
  );

  return rows[0] ?? null;
}

/**
 * Find an order by ID.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} orderId
 * @returns {Promise<object | null>}
 */
export async function findOrderById(db, orderId) {
  const { rows } = await db.query(
    `SELECT
       id,
       user_id AS "userId",
       status,
       total_minor AS "totalMinor",
       currency,
       idempotency_key AS "idempotencyKey",
       idempotency_payload_hash AS "idempotencyPayloadHash",
       cancelled_at AS "cancelledAt",
       cancelled_by AS "cancelledBy",
       cancellation_reason AS "cancellationReason",
       paid_at AS "paidAt",
       fulfilled_at AS "fulfilledAt",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM orders
     WHERE id = $1`,
    [orderId]
  );

  return rows[0] ?? null;
}

/**
 * Find an order by idempotency key.
 *
 * @rule:ORDER_IDEMPOTENCY — Used to detect duplicate requests.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} idempotencyKey
 * @returns {Promise<object | null>}
 */
export async function findOrderByIdempotencyKey(db, idempotencyKey) {
  const { rows } = await db.query(
    `SELECT
       id,
       user_id AS "userId",
       status,
       total_minor AS "totalMinor",
       currency,
       idempotency_key AS "idempotencyKey",
       idempotency_payload_hash AS "idempotencyPayloadHash",
       cancelled_at AS "cancelledAt",
       cancelled_by AS "cancelledBy",
       cancellation_reason AS "cancellationReason",
       paid_at AS "paidAt",
       fulfilled_at AS "fulfilledAt",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM orders
     WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  return rows[0] ?? null;
}

/**
 * Get complete order details with snapshotted items.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} orderId
 * @param {string | null} [userId] Optional user ID filter for customer scoping.
 * @returns {Promise<object | null>}
 */
export async function getOrderDetails(db, orderId, userId = null) {
  const { rows } = await db.query(
    `SELECT
       o.id,
       o.user_id AS "userId",
       o.status,
       o.total_minor AS "totalMinor",
       o.currency,
       o.idempotency_key AS "idempotencyKey",
       o.cancelled_at AS "cancelledAt",
       o.cancellation_reason AS "cancellationReason",
       o.paid_at AS "paidAt",
       o.fulfilled_at AS "fulfilledAt",
       o.created_at AS "createdAt",
       u.name AS "userName",
       u.email AS "userEmail",
       COALESCE(
         json_agg(
           json_build_object(
             'id', oi.id,
             'variantId', oi.variant_id,
             'productName', oi.product_name_snapshot,
             'variantName', oi.variant_name_snapshot,
             'unitPriceMinor', oi.unit_price_minor_snapshot,
             'quantity', oi.quantity,
             'totalMinor', oi.total_minor
           ) ORDER BY oi.created_at ASC, oi.id ASC
         ) FILTER (WHERE oi.id IS NOT NULL),
         '[]'::json
       ) AS items
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.id = $1
       AND ($2::uuid IS NULL OR o.user_id = $2)
     GROUP BY o.id, u.id`,
    [orderId, userId]
  );

  return rows[0] ?? null;
}

/**
 * Insert an order inside a transaction.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   userId: string,
 *   currency: string,
 *   totalMinor: number,
 *   status?: 'pending' | 'paid' | 'cancelled' | 'fulfilled',
 *   idempotencyKey: string,
 *   payloadHash: string
 * }} params
 * @returns {Promise<object>}
 */
export async function insertOrder(client, {
  userId,
  currency,
  totalMinor,
  status = 'pending',
  idempotencyKey,
  payloadHash,
}) {
  const { rows } = await client.query(
    `INSERT INTO orders
       (user_id, currency, total_minor, status, idempotency_key, idempotency_payload_hash)
     VALUES
       ($1, $2, $3, $4, $5, $6)
     RETURNING
       id,
       user_id AS "userId",
       status,
       total_minor AS "totalMinor",
       currency,
       idempotency_key AS "idempotencyKey",
       idempotency_payload_hash AS "idempotencyPayloadHash",
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [userId, currency, totalMinor, status, idempotencyKey, payloadHash]
  );

  return rows[0];
}

/**
 * Insert an order item with price and name snapshots.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   orderId: string,
 *   variantId: string,
 *   productNameSnapshot: string,
 *   variantNameSnapshot: string,
 *   unitPriceMinor: number,
 *   quantity: number,
 *   totalMinor: number
 * }} params
 * @returns {Promise<object>}
 */
export async function insertOrderItem(client, {
  orderId,
  variantId,
  productNameSnapshot,
  variantNameSnapshot,
  unitPriceMinor,
  quantity,
  totalMinor,
}) {
  const { rows } = await client.query(
    `INSERT INTO order_items
       (order_id, variant_id, product_name_snapshot, variant_name_snapshot,
        unit_price_minor_snapshot, quantity, total_minor)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7)
     RETURNING
       id,
       order_id AS "orderId",
       variant_id AS "variantId",
       product_name_snapshot AS "productNameSnapshot",
       variant_name_snapshot AS "variantNameSnapshot",
       unit_price_minor_snapshot AS "unitPriceMinorSnapshot",
       quantity,
       total_minor AS "totalMinor",
       created_at AS "createdAt"`,
    [
      orderId,
      variantId,
      productNameSnapshot,
      variantNameSnapshot,
      unitPriceMinor,
      quantity,
      totalMinor,
    ]
  );

  return rows[0];
}

/**
 * Cancel an order atomically and restore variant stock exactly once.
 *
 * @rule:STOCK_RESTORE_ON_CANCEL — Only orders in 'pending' or 'paid' status can be cancelled.
 * If already cancelled or fulfilled, returns null and restores no stock.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   orderId: string,
 *   actorId?: string | null,
 *   reason?: string,
 *   at?: string
 * }} params
 * @returns {Promise<object | null>} Cancelled order record or null if not eligible.
 */
export async function cancelOrder(client, {
  orderId,
  actorId = null,
  reason = '',
  at = new Date().toISOString(),
}) {
  // 1. Conditional status update
  const { rows: orderRows } = await client.query(
    `UPDATE orders
     SET
       status = 'cancelled',
       cancelled_at = $1,
       cancelled_by = $2,
       cancellation_reason = $3,
       updated_at = now()
     WHERE id = $4
       AND status IN ('pending', 'paid')
     RETURNING
       id,
       user_id AS "userId",
       status,
       total_minor AS "totalMinor",
       currency,
       cancelled_at AS "cancelledAt",
       cancellation_reason AS "cancellationReason"`,
    [at, actorId, reason, orderId]
  );

  if (orderRows.length === 0) {
    return null; // Not found, or already cancelled / fulfilled
  }

  // 2. Fetch all items in the cancelled order
  const { rows: itemRows } = await client.query(
    `SELECT variant_id AS "variantId", quantity
     FROM order_items
     WHERE order_id = $1
       AND variant_id IS NOT NULL`,
    [orderId]
  );

  // 3. Restore stock for each item
  for (const item of itemRows) {
    await client.query(
      `UPDATE product_variants
       SET
         stock_quantity = stock_quantity + $1,
         updated_at = now()
       WHERE id = $2`,
      [item.quantity, item.variantId]
    );
  }

  return orderRows[0];
}

/**
 * Update order status (e.g. mark paid or fulfilled).
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   orderId: string,
 *   status: 'pending' | 'paid' | 'cancelled' | 'fulfilled',
 *   paidAt?: string | null,
 *   fulfilledAt?: string | null
 * }} params
 * @returns {Promise<object | null>}
 */
export async function updateOrderStatus(client, {
  orderId,
  status,
  paidAt = null,
  fulfilledAt = null,
}) {
  const { rows } = await client.query(
    `UPDATE orders
     SET
       status = $1,
       paid_at = COALESCE($2, paid_at),
       fulfilled_at = COALESCE($3, fulfilled_at),
       updated_at = now()
     WHERE id = $4
     RETURNING
       id,
       user_id AS "userId",
       status,
       total_minor AS "totalMinor",
       currency,
       paid_at AS "paidAt",
       fulfilled_at AS "fulfilledAt",
       updated_at AS "updatedAt"`,
    [status, paidAt, fulfilledAt, orderId]
  );

  return rows[0] ?? null;
}

/**
 * List orders for a specific user.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} userId
 * @param {{ page?: number, pageSize?: number }} [params]
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number }>}
 */
export async function listUserOrders(db, userId, { page = 1, pageSize = 20 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (safePage - 1) * safePageSize;

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM orders WHERE user_id = $1`,
    [userId]
  );
  const total = countResult.rows[0]?.total ?? 0;

  const { rows } = await db.query(
    `SELECT
       o.id,
       o.user_id AS "userId",
       o.status,
       o.total_minor AS "totalMinor",
       o.currency,
       o.cancelled_at AS "cancelledAt",
       o.paid_at AS "paidAt",
       o.fulfilled_at AS "fulfilledAt",
       o.created_at AS "createdAt",
       COALESCE(
         json_agg(
           json_build_object(
             'id', oi.id,
             'variantId', oi.variant_id,
             'productName', oi.product_name_snapshot,
             'variantName', oi.variant_name_snapshot,
             'unitPriceMinor', oi.unit_price_minor_snapshot,
             'quantity', oi.quantity,
             'totalMinor', oi.total_minor
           ) ORDER BY oi.created_at ASC
         ) FILTER (WHERE oi.id IS NOT NULL),
         '[]'::json
       ) AS items
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.user_id = $1
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, safePageSize, offset]
  );

  return {
    rows,
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}
