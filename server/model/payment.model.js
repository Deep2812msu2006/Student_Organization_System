/**
 * server/model/payment.model.js — Dharmik and Deep maintain this file.
 *
 * Payment evidence and manual confirmation database layer.
 * Supports both event ticket registrations and merchandise orders.
 *
 * Design constraints (same as event.model.js & merchandise.model.js):
 *  - Parameterized queries ONLY ($1, $2, ...).
 *  - Accepts `db` (pg.Pool or pg.PoolClient).
 *  - Services own transactions; functions here never issue BEGIN/COMMIT/ROLLBACK.
 *  - Exact money stored as integer minor units.
 *
 * @rule:PAYMENT_ONCE — A registration or order can only be confirmed once.
 *   insertPaymentRecord checks idempotency_key uniqueness and target constraints.
 *   confirmRegistration and confirmOrderPayment are conditional updates that only
 *   transition pending → confirmed/paid; cancelled/fulfilled rows are rejected.
 *
 * @rule:PAYMENT_EVIDENCE — Every manual confirmation writes a durable
 *   payment_records row before changing registration/order status. The payment
 *   and status change must be in the same transaction.
 *
 * @rule:ORDER_LOCK_ORDER — Lock order rows with SELECT ... FOR UPDATE before
 *   updating status or writing payment records to eliminate race conditions with cancellation.
 */

/**
 * Insert a durable payment evidence record for an event registration or merchandise order.
 *
 * @rule:PAYMENT_TARGET_MUTEX — Exactly one of registrationId OR orderId must be supplied.
 *
 * @param {import('pg').PoolClient} client - Must be inside caller's transaction
 * @param {{
 *   registrationId?: string|null,
 *   orderId?: string|null,
 *   amountMinor: number,
 *   currency: string,
 *   method: string,
 *   externalReference?: string|null,
 *   notes?: string,
 *   recordedBy: string,
 *   idempotencyKey: string
 * }} params
 * @returns {Promise<object>} The created payment record
 */
export async function insertPaymentRecord(client, {
  registrationId = null,
  orderId = null,
  amountMinor,
  currency,
  method,
  externalReference = null,
  notes = '',
  recordedBy,
  idempotencyKey,
}) {
  const { rows } = await client.query(
    `INSERT INTO payment_records
       (registration_id, order_id, amount_minor, currency, method, external_reference,
        notes, recorded_by, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING
       id,
       registration_id AS "registrationId",
       order_id AS "orderId",
       amount_minor AS "amountMinor",
       currency,
       method,
       external_reference AS "externalReference",
       notes,
       recorded_by AS "recordedBy",
       idempotency_key AS "idempotencyKey",
       created_at AS "createdAt"`,
    [registrationId, orderId, amountMinor, currency, method, externalReference,
     notes, recordedBy, idempotencyKey]
  );
  return rows[0];
}

/**
 * Find existing payment record by idempotency key.
 * Used for replay detection before inserting a duplicate payment.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} idempotencyKey
 * @returns {Promise<object|null>}
 */
export async function findPaymentByIdempotencyKey(db, idempotencyKey) {
  const { rows } = await db.query(
    `SELECT
       id,
       registration_id AS "registrationId",
       order_id AS "orderId",
       amount_minor AS "amountMinor",
       currency,
       method,
       external_reference AS "externalReference",
       notes,
       recorded_by AS "recordedBy",
       idempotency_key AS "idempotencyKey",
       created_at AS "createdAt"
     FROM payment_records
     WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  return rows[0] ?? null;
}

/**
 * Find payment records for a given registration.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} registrationId
 * @returns {Promise<Array<object>>}
 */
export async function findPaymentsByRegistration(db, registrationId) {
  const { rows } = await db.query(
    `SELECT
       id,
       registration_id AS "registrationId",
       amount_minor AS "amountMinor",
       currency,
       method,
       recorded_by AS "recordedBy",
       idempotency_key AS "idempotencyKey",
       created_at AS "createdAt"
     FROM payment_records
     WHERE registration_id = $1
     ORDER BY created_at DESC`,
    [registrationId]
  );
  return rows;
}

/**
 * Find payment record for a given merchandise order.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
export async function findPaymentByOrder(db, orderId) {
  const { rows } = await db.query(
    `SELECT
       id,
       order_id AS "orderId",
       amount_minor AS "amountMinor",
       currency,
       method,
       external_reference AS "externalReference",
       notes,
       recorded_by AS "recordedBy",
       idempotency_key AS "idempotencyKey",
       created_at AS "createdAt"
     FROM payment_records
     WHERE order_id = $1`,
    [orderId]
  );
  return rows[0] ?? null;
}

/**
 * Lock an order row for payment confirmation.
 * Enforces consistent lock ordering (@rule:ORDER_LOCK_ORDER) to prevent deadlocks with cancellation.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
export async function lockOrderForPayment(client, orderId) {
  const { rows } = await client.query(
    `SELECT
       id,
       user_id AS "userId",
       status,
       total_minor AS "totalMinor",
       currency,
       paid_at AS "paidAt",
       cancelled_at AS "cancelledAt",
       fulfilled_at AS "fulfilledAt"
     FROM orders
     WHERE id = $1
     FOR UPDATE`,
    [orderId]
  );
  return rows[0] ?? null;
}

/**
 * Conditionally transition an order from 'pending' to 'paid' atomically.
 * Returns null if the order is not in 'pending' status (already paid, cancelled, or fulfilled).
 *
 * @rule:PAYMENT_ONCE — An order can only transition to 'paid' from 'pending'.
 *
 * @param {import('pg').PoolClient} client - Inside caller's transaction
 * @param {{ orderId: string, paidAt?: string }} params
 * @returns {Promise<object|null>} Updated order record or null if no eligible row
 */
export async function confirmOrderPayment(client, { orderId, paidAt = new Date().toISOString() }) {
  const { rows } = await client.query(
    `UPDATE orders
     SET
       status = 'paid',
       paid_at = $1,
       updated_at = now()
     WHERE id = $2 AND status = 'pending'
     RETURNING
       id,
       user_id AS "userId",
       status,
       total_minor AS "totalMinor",
       currency,
       paid_at AS "paidAt",
       updated_at AS "updatedAt"`,
    [paidAt, orderId]
  );
  return rows[0] ?? null;
}

/**
 * Conditionally confirm a pending registration — pending → confirmed only.
 * Returns null if the registration is not in 'pending' status (cancelled/already confirmed).
 *
 * @rule:PAYMENT_ONCE — Will not confirm already-confirmed or cancelled registrations.
 *
 * @param {import('pg').PoolClient} client - Inside caller's transaction
 * @param {string} registrationId
 * @returns {Promise<object|null>} Updated registration or null if no eligible row
 */
export async function confirmRegistration(client, registrationId) {
  const { rows } = await client.query(
    `UPDATE registrations
     SET status = 'confirmed', updated_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING
       id,
       event_id AS "eventId",
       user_id AS "userId",
       price_minor AS "priceMinor",
       currency,
       status,
       updated_at AS "updatedAt"`,
    [registrationId]
  );
  return rows[0] ?? null;
}

/**
 * Get pending registrations for an event, for treasurer confirmation screen.
 * Only returns registrations that are eligible for payment confirmation.
 * Does NOT expose token_hash or admission codes.
 *
 * @param {import('pg').Pool} db
 * @param {string} eventId
 * @returns {Promise<Array<object>>}
 */
export async function listPendingRegistrations(db, eventId) {
  const { rows } = await db.query(
    `SELECT
       r.id,
       r.event_id AS "eventId",
       r.user_id AS "userId",
       u.name AS "userName",
       u.email AS "userEmail",
       r.price_minor AS "priceMinor",
       r.currency,
       r.status,
       r.created_at AS "createdAt"
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     WHERE r.event_id = $1 AND r.status = 'pending'
     ORDER BY r.created_at ASC`,
    [eventId]
  );
  return rows;
}

/**
 * List pending merchandise orders for treasurer confirmation screen.
 * Returns pending orders joined with customer profile and snapshotted items summary.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ page?: number, pageSize?: number }} [params]
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number }>}
 */
export async function listPendingOrders(db, { page = 1, pageSize = 20 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (safePage - 1) * safePageSize;

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM orders WHERE status = 'pending'`
  );
  const total = countResult.rows[0]?.total ?? 0;

  const { rows } = await db.query(
    `SELECT
       o.id,
       o.user_id AS "userId",
       u.name AS "userName",
       u.email AS "userEmail",
       o.status,
       o.total_minor AS "totalMinor",
       o.currency,
       o.idempotency_key AS "idempotencyKey",
       o.created_at AS "createdAt",
       COALESCE(
         json_agg(
           json_build_object(
             'id', oi.id,
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
     JOIN users u ON u.id = o.user_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.status = 'pending'
     GROUP BY o.id, u.id
     ORDER BY o.created_at ASC
     LIMIT $1 OFFSET $2`,
    [safePageSize, offset]
  );

  return { rows, total, page: safePage, pageSize: safePageSize };
}

/**
 * Get attendance totals for an event (database-backed).
 *
 * @param {import('pg').Pool} db
 * @param {string} eventId
 * @returns {Promise<object>}
 */
export async function getAttendanceTotals(db, eventId) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int AS "totalRegistrations",
       COUNT(*) FILTER (WHERE status = 'confirmed')::int AS "confirmed",
       COUNT(*) FILTER (WHERE status = 'pending')::int AS "pending",
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS "cancelled",
       COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL)::int AS "checkedIn"
     FROM registrations
     WHERE event_id = $1`,
    [eventId]
  );
  return rows[0];
}

