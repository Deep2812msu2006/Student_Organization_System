/**
 * server/model/expense.model.js — Deep owns this file.
 *
 * Volunteer expense submissions, decisions, and reimbursement database layer.
 *
 * Design constraints:
 *  - Parameterized queries ONLY ($1, $2, ...).
 *  - Accepts `db` (pg.Pool or pg.PoolClient).
 *  - Services own transactions; functions here never issue BEGIN/COMMIT/ROLLBACK.
 *  - Exact money stored as positive integer minor units (paise/cents).
 *
 * State Machine & Invariants:
 *  - @rule:EXPENSE_TRANSITIONS — Permitted transitions:
 *      submitted -> approved | rejected (decided by treasurer/organizer)
 *      approved  -> reimbursed (reimbursement recorded by treasurer)
 *  - @rule:EXPENSE_NO_SELF_APPROVAL — Service/business policy must prevent submitters from deciding own expenses.
 *  - @rule:REIMBURSEMENT_ONCE — Idempotency key uniqueness prevents duplicate reimbursements.
 */

/**
 * Submit a new volunteer expense.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{
 *   requesterId: string,
 *   amountMinor: number,
 *   currency: string,
 *   purpose: string,
 *   receiptKey: string
 * }} params
 * @returns {Promise<object>}
 */
export async function createExpense(db, {
  requesterId,
  amountMinor,
  currency,
  purpose,
  receiptKey,
}) {
  const { rows } = await db.query(
    `INSERT INTO expenses
       (requester_id, amount_minor, currency, purpose, receipt_key, status)
     VALUES
       ($1, $2, $3, $4, $5, 'submitted')
     RETURNING
       id,
       requester_id AS "requesterId",
       amount_minor AS "amountMinor",
       currency,
       purpose,
       receipt_key AS "receiptKey",
       status,
       submitted_at AS "submittedAt",
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [requesterId, amountMinor, currency, purpose, receiptKey]
  );
  return rows[0];
}

/**
 * Fetch an expense by ID with joined requester information.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} expenseId
 * @param {string | null} [requesterId] Optional filter for submitter scoping
 * @returns {Promise<object | null>}
 */
export async function getExpenseById(db, expenseId, requesterId = null) {
  const { rows } = await db.query(
    `SELECT
       e.id,
       e.requester_id AS "requesterId",
       u.name AS "requesterName",
       u.email AS "requesterEmail",
       e.amount_minor AS "amountMinor",
       e.currency,
       e.purpose,
       e.receipt_key AS "receiptKey",
       e.status,
       e.submitted_at AS "submittedAt",
       e.decided_at AS "decidedAt",
       e.decided_by AS "decidedBy",
       du.name AS "decidedByName",
       e.decision_reason AS "decisionReason",
       e.reimbursed_at AS "reimbursedAt",
       e.reimbursed_by AS "reimbursedBy",
       ru.name AS "reimbursedByName",
       e.reimbursement_reference AS "reimbursementReference",
       e.reimbursement_idempotency_key AS "reimbursementIdempotencyKey",
       e.created_at AS "createdAt",
       e.updated_at AS "updatedAt"
     FROM expenses e
     JOIN users u ON u.id = e.requester_id
     LEFT JOIN users du ON du.id = e.decided_by
     LEFT JOIN users ru ON ru.id = e.reimbursed_by
     WHERE e.id = $1
       AND ($2::uuid IS NULL OR e.requester_id = $2)`,
    [expenseId, requesterId]
  );
  return rows[0] ?? null;
}

/**
 * List expenses with pagination and optional status/requester filters.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{
 *   page?: number,
 *   pageSize?: number,
 *   status?: string | null,
 *   requesterId?: string | null
 * }} [params]
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number }>}
 */
export async function listExpenses(db, {
  page = 1,
  pageSize = 20,
  status = null,
  requesterId = null,
} = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (safePage - 1) * safePageSize;

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM expenses
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::uuid IS NULL OR requester_id = $2)`,
    [status, requesterId]
  );
  const total = countResult.rows[0]?.total ?? 0;

  const { rows } = await db.query(
    `SELECT
       e.id,
       e.requester_id AS "requesterId",
       u.name AS "requesterName",
       u.email AS "requesterEmail",
       e.amount_minor AS "amountMinor",
       e.currency,
       e.purpose,
       e.receipt_key AS "receiptKey",
       e.status,
       e.submitted_at AS "submittedAt",
       e.decided_at AS "decidedAt",
       e.decided_by AS "decidedBy",
       du.name AS "decidedByName",
       e.decision_reason AS "decisionReason",
       e.reimbursed_at AS "reimbursedAt",
       e.reimbursed_by AS "reimbursedBy",
       ru.name AS "reimbursedByName",
       e.reimbursement_reference AS "reimbursementReference",
       e.created_at AS "createdAt"
     FROM expenses e
     JOIN users u ON u.id = e.requester_id
     LEFT JOIN users du ON du.id = e.decided_by
     LEFT JOIN users ru ON ru.id = e.reimbursed_by
     WHERE ($1::text IS NULL OR e.status = $1)
       AND ($2::uuid IS NULL OR e.requester_id = $2)
     ORDER BY e.created_at DESC, e.id ASC
     LIMIT $3 OFFSET $4`,
    [status, requesterId, safePageSize, offset]
  );

  return { rows, total, page: safePage, pageSize: safePageSize };
}

/**
 * Lock an expense row for decision making.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} expenseId
 * @returns {Promise<object | null>}
 */
export async function lockExpenseForDecision(client, expenseId) {
  const { rows } = await client.query(
    `SELECT
       id,
       requester_id AS "requesterId",
       amount_minor AS "amountMinor",
       currency,
       purpose,
       receipt_key AS "receiptKey",
       status,
       submitted_at AS "submittedAt",
       decided_at AS "decidedAt",
       decided_by AS "decidedBy",
       decision_reason AS "decisionReason"
     FROM expenses
     WHERE id = $1
     FOR UPDATE`,
    [expenseId]
  );
  return rows[0] ?? null;
}

/**
 * Conditionally decide an expense (submitted -> approved | rejected).
 *
 * @rule:EXPENSE_TRANSITIONS — Only expenses in 'submitted' status can be decided.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   expenseId: string,
 *   actorId: string,
 *   decision: 'approved' | 'rejected',
 *   reason?: string,
 *   at?: string
 * }} params
 * @returns {Promise<object | null>} Updated row or null if not eligible.
 */
export async function decideExpense(client, {
  expenseId,
  actorId,
  decision,
  reason = '',
  at = new Date().toISOString(),
}) {
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error(`Invalid expense decision "${decision}". Must be "approved" or "rejected".`);
  }

  const { rows } = await client.query(
    `UPDATE expenses
     SET
       status = $1,
       decided_at = $2,
       decided_by = $3,
       decision_reason = $4,
       updated_at = now()
     WHERE id = $5 AND status = 'submitted'
     RETURNING
       id,
       requester_id AS "requesterId",
       amount_minor AS "amountMinor",
       currency,
       purpose,
       status,
       submitted_at AS "submittedAt",
       decided_at AS "decidedAt",
       decided_by AS "decidedBy",
       decision_reason AS "decisionReason",
       updated_at AS "updatedAt"`,
    [decision, at, actorId, reason, expenseId]
  );
  return rows[0] ?? null;
}

/**
 * Lock an approved expense row for reimbursement.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} expenseId
 * @returns {Promise<object | null>}
 */
export async function lockExpenseForReimbursement(client, expenseId) {
  const { rows } = await client.query(
    `SELECT
       id,
       requester_id AS "requesterId",
       amount_minor AS "amountMinor",
       currency,
       purpose,
       status,
       decided_at AS "decidedAt",
       decided_by AS "decidedBy",
       reimbursed_at AS "reimbursedAt",
       reimbursed_by AS "reimbursedBy",
       reimbursement_reference AS "reimbursementReference",
       reimbursement_idempotency_key AS "reimbursementIdempotencyKey"
     FROM expenses
     WHERE id = $1
     FOR UPDATE`,
    [expenseId]
  );
  return rows[0] ?? null;
}

/**
 * Conditionally mark an approved expense as reimbursed (approved -> reimbursed).
 *
 * @rule:EXPENSE_TRANSITIONS — Only expenses in 'approved' status can be reimbursed.
 * @rule:REIMBURSEMENT_ONCE — Reimbursement idempotency key enforces duplicate protection.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   expenseId: string,
 *   actorId: string,
 *   reimbursementReference?: string | null,
 *   idempotencyKey: string,
 *   at?: string
 * }} params
 * @returns {Promise<object | null>} Updated row or null if not eligible.
 */
export async function reimburseExpense(client, {
  expenseId,
  actorId,
  reimbursementReference = null,
  idempotencyKey,
  at = new Date().toISOString(),
}) {
  const { rows } = await client.query(
    `UPDATE expenses
     SET
       status = 'reimbursed',
       reimbursed_at = $1,
       reimbursed_by = $2,
       reimbursement_reference = $3,
       reimbursement_idempotency_key = $4,
       updated_at = now()
     WHERE id = $5 AND status = 'approved'
     RETURNING
       id,
       requester_id AS "requesterId",
       amount_minor AS "amountMinor",
       currency,
       purpose,
       status,
       decided_at AS "decidedAt",
       decided_by AS "decidedBy",
       reimbursed_at AS "reimbursedAt",
       reimbursed_by AS "reimbursedBy",
       reimbursement_reference AS "reimbursementReference",
       reimbursement_idempotency_key AS "reimbursementIdempotencyKey",
       updated_at AS "updatedAt"`,
    [at, actorId, reimbursementReference, idempotencyKey, expenseId]
  );
  return rows[0] ?? null;
}

/**
 * Find an expense by its reimbursement idempotency key for replay detection.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} idempotencyKey
 * @returns {Promise<object | null>}
 */
export async function findExpenseByReimbursementIdempotencyKey(db, idempotencyKey) {
  const { rows } = await db.query(
    `SELECT
       id,
       requester_id AS "requesterId",
       amount_minor AS "amountMinor",
       currency,
       purpose,
       status,
       decided_at AS "decidedAt",
       decided_by AS "decidedBy",
       reimbursed_at AS "reimbursedAt",
       reimbursed_by AS "reimbursedBy",
       reimbursement_reference AS "reimbursementReference",
       reimbursement_idempotency_key AS "reimbursementIdempotencyKey",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM expenses
     WHERE reimbursement_idempotency_key = $1`,
    [idempotencyKey]
  );
  return rows[0] ?? null;
}
