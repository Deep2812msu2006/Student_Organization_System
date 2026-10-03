/**
 * server/model/payment.model.js — Dharmik owns this file; Deep reviews schema.
 *
 * Payment evidence and manual confirmation database layer.
 *
 * Design constraints (same as event.model.js):
 *  - Parameterized queries ONLY ($1, $2, ...).
 *  - Accepts `db` (pg.Pool or pg.PoolClient).
 *  - Services own transactions; functions here never issue BEGIN/COMMIT/ROLLBACK.
 *
 * @rule:PAYMENT_ONCE — A registration can only be confirmed once.
 *   insertPaymentRecord checks idempotency_key uniqueness.
 *   confirmRegistrationWithPayment is a conditional update that only
 *   transitions pending → confirmed; cancelled registrations are rejected.
 *
 * @rule:PAYMENT_EVIDENCE — Every manual confirmation writes a durable
 *   payment_records row before changing registration status. The payment
 *   and status change must be in the same transaction.
 */

/**
 * Insert a durable payment evidence record.
 *
 * @param {import('pg').PoolClient} client - Must be inside caller's transaction
 * @param {{
 *   registrationId: string,
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
  registrationId,
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
       (registration_id, amount_minor, currency, method, external_reference,
        notes, recorded_by, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING
       id,
       registration_id AS "registrationId",
       amount_minor AS "amountMinor",
       currency,
       method,
       external_reference AS "externalReference",
       notes,
       recorded_by AS "recordedBy",
       idempotency_key AS "idempotencyKey",
       created_at AS "createdAt"`,
    [registrationId, amountMinor, currency, method, externalReference,
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
       created_at AS "createdAt"
     FROM payment_records
     WHERE registration_id = $1
     ORDER BY created_at DESC`,
    [registrationId]
  );
  return rows;
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
