/**
 * member.model.js — Deep owns this file.
 *
 * SQL models for membership profile, membership creation, and member listing.
 * Om's membership service calls these functions.
 *
 * Parameter convention:
 *   db — pg Pool or pg PoolClient. Never commits/rollbacks a caller transaction.
 *
 * @rule:MEMBERSHIP_VALIDITY — evaluated in getMemberProfile():
 *   ACTIVE = period exists AND starts_at <= $at AND expires_at > $at
 *            AND dues_obligation.status = 'paid'.
 *
 * @flow:MEMBER_PERSISTENCE — createMembership() must be called inside Om's
 *   service transaction (pass the checked-out PoolClient, not the pool).
 *
 * Public functions (Om can call immediately):
 *   getMemberProfile(db, userId, at) → profile with membership evidence | null
 *   listMembers(db, { page, pageSize }) → { rows, total }
 *   createMembership(db, { userId, planId, startsAt, expiresAt, duesAmountMinor, currency })
 *     → { membershipPeriodId, duesObligationId }
 */

// ─── getMemberProfile ─────────────────────────────────────────────────────────
/**
 * Return a user's public profile plus evaluated membership evidence.
 *
 * Evaluates all three MEMBERSHIP_VALIDITY conditions at the given instant.
 * @rule:MEMBERSHIP_VALIDITY
 *
 * Returns null if user does not exist.
 * Returns profile with membershipStatus='none' if no period exists.
 * Returns profile with membershipStatus='pending'|'active'|'expired' based
 * on the current period and dues state.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} userId — UUID
 * @param {Date|string} at — evaluation instant (use new Date() for "now")
 * @returns {Promise<object|null>}
 *
 * Returned shape (password_hash is NEVER included):
 * {
 *   id, name, email, createdAt,
 *   membershipStatus: 'active'|'pending'|'expired'|'none',
 *   -- present when a period exists:
 *   membershipPeriodId?, planId?, planName?,
 *   startsAt?, expiresAt?,
 *   duesStatus?: 'paid'|'pending'|'waived',
 *   duesAmountMinor?, currency?
 * }
 */
export async function getMemberProfile(db, userId, at) {
  // Single query: join user → latest membership period → dues obligation → plan.
  // LEFT JOINs so user without membership still returns a row.
  const { rows } = await db.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.created_at        AS "createdAt",
       mp.id               AS "membershipPeriodId",
       mp.plan_id          AS "planId",
       pl.name             AS "planName",
       mp.starts_at        AS "startsAt",
       mp.expires_at       AS "expiresAt",
       mp.dues_amount_minor AS "duesAmountMinor",
       mp.currency         AS "currency",
       do2.status          AS "duesStatus",
       -- @rule:MEMBERSHIP_VALIDITY: active iff all three conditions hold.
       CASE
         WHEN mp.id IS NULL                    THEN 'none'
         WHEN mp.expires_at <= $2              THEN 'expired'
         WHEN mp.starts_at  >  $2              THEN 'future'
         WHEN do2.status = 'paid'              THEN 'active'
         ELSE 'pending'
       END AS "membershipStatus"
     FROM users u
     LEFT JOIN LATERAL (
       -- Most recent period by starts_at; one period per evaluation.
       SELECT * FROM membership_periods
        WHERE user_id = u.id
        ORDER BY starts_at DESC
        LIMIT 1
     ) mp ON true
     LEFT JOIN membership_plans pl ON pl.id = mp.plan_id
     LEFT JOIN dues_obligations do2 ON do2.membership_period_id = mp.id
     WHERE u.id = $1`,
    [userId, at instanceof Date ? at.toISOString() : at]
  );
  return rows[0] ?? null;
}

// ─── listMembers ──────────────────────────────────────────────────────────────
/**
 * Paginated list of all users with their evaluated membership status.
 * Organizer-only endpoint — Om's controller must enforce the role check.
 *
 * @rule:MEMBERSHIP_VALIDITY — membershipStatus evaluated at call time.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ page: number, pageSize: number }} params — page >= 1, pageSize 1–50
 * @returns {Promise<{ rows: object[], total: number }>}
 *   rows: safe user+membership summaries (no password hashes)
 *   total: total user count for pagination
 */
export async function listMembers(db, { page, pageSize }) {
  const offset = (page - 1) * pageSize;
  const now = new Date().toISOString();

  const [countResult, rowsResult] = await Promise.all([
    db.query('SELECT COUNT(*) AS total FROM users'),
    db.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.created_at AS "createdAt",
         CASE
           WHEN mp.id IS NULL           THEN 'none'
           WHEN mp.expires_at <= $3     THEN 'expired'
           WHEN mp.starts_at  >  $3     THEN 'future'
           WHEN do2.status = 'paid'     THEN 'active'
           ELSE 'pending'
         END AS "membershipStatus",
         mp.expires_at AS "expiresAt"
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM membership_periods
          WHERE user_id = u.id
          ORDER BY starts_at DESC
          LIMIT 1
       ) mp ON true
       LEFT JOIN dues_obligations do2 ON do2.membership_period_id = mp.id
       ORDER BY u.created_at DESC, u.id
       LIMIT $1 OFFSET $2`,
      [pageSize, offset, now]
    ),
  ]);

  return {
    rows: rowsResult.rows,
    total: Number(countResult.rows[0].total),
  };
}

// ─── createMembership ─────────────────────────────────────────────────────────
/**
 * Insert a membership period and its associated dues obligation atomically.
 *
 * MUST be called with a PoolClient inside Om's service-owned transaction.
 * The service calls BEGIN before this and COMMIT/ROLLBACK after.
 * This function never calls BEGIN/COMMIT/ROLLBACK itself.
 *
 * @flow:MEMBER_PERSISTENCE — Om's POST /memberships service flow:
 *   client = await pool.connect()
 *   await client.query('BEGIN')
 *   const membership = await createMembership(client, {...})
 *   // Om's service may also assignRole here if first-time member
 *   await client.query('COMMIT')
 *
 * @param {import('pg').PoolClient} db — must be a checked-out client, not pool
 * @param {{
 *   userId: string,
 *   planId: string,
 *   startsAt: Date|string,
 *   expiresAt: Date|string,
 *   duesAmountMinor: number,
 *   currency: string
 * }} params
 * @returns {Promise<{ membershipPeriodId: string, duesObligationId: string }>}
 */
export async function createMembership(db, {
  userId, planId, startsAt, expiresAt, duesAmountMinor, currency,
}) {
  // Insert membership period.
  const { rows: [period] } = await db.query(
    `INSERT INTO membership_periods
       (user_id, plan_id, starts_at, expires_at, dues_amount_minor, currency)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, planId, startsAt, expiresAt, duesAmountMinor, currency]
  );

  // Insert dues obligation in 'pending' state.
  // @rule:MEMBERSHIP_VALIDITY: status starts as 'pending'; marked 'paid' by
  // treasurer via POST /payments/manual (Dharmik's milestone).
  const { rows: [obligation] } = await db.query(
    `INSERT INTO dues_obligations
       (membership_period_id, amount_minor, currency, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING id`,
    [period.id, duesAmountMinor, currency]
  );

  return {
    membershipPeriodId: period.id,
    duesObligationId: obligation.id,
  };
}
