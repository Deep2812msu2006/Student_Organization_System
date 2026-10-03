/**
 * auth.model.js — Deep owns this file.
 *
 * SQL models for user authentication and identity.
 * Om's auth service calls these functions; they never send HTTP responses.
 *
 * Parameter convention:
 *   db — a pg Pool (for single independent queries) OR a pg PoolClient
 *        (for queries inside a caller-owned transaction). The model never
 *        calls BEGIN, COMMIT or ROLLBACK; the service owns the transaction.
 *
 * @rule:EMAIL_UNIQUENESS — all email lookups and inserts use lower(trim(email)).
 *   Do not pass raw user-supplied email directly; normalize at call site.
 *
 * Public functions (Om can call immediately):
 *   findUserByEmail(db, normalizedEmail) → full user row (incl. passwordHash) | null
 *   createUser(db, { name, email, passwordHash }) → safe user (no hash)
 *   findUserById(db, userId) → safe user | null
 *   assignRole(db, { userId, roleName, grantedBy? }) → void
 *   getUserRoles(db, userId) → string[]
 */

// ─── findUserByEmail ──────────────────────────────────────────────────────────
/**
 * Find a user by their normalized email address.
 *
 * IMPORTANT: The returned object INCLUDES password_hash (renamed to
 * passwordHash). Om's auth service MUST NOT send this to the client.
 * It is returned here only so the service can compare the supplied
 * plaintext password against the stored hash.
 *
 * @rule:EMAIL_UNIQUENESS — queries lower(email) via the unique index.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} normalizedEmail — must be lower(trim(rawEmail)) before call
 * @returns {Promise<object|null>}
 */
export async function findUserByEmail(db, normalizedEmail) {
  const { rows } = await db.query(
    `SELECT id, name, email, password_hash AS "passwordHash", created_at AS "createdAt"
       FROM users
      WHERE lower(btrim(email)) = $1`,
    [normalizedEmail.trim().toLowerCase()]
  );
  return rows[0] ?? null;
}

// ─── createUser ───────────────────────────────────────────────────────────────
/**
 * Insert a new user. Normalizes the email for storage uniqueness check.
 *
 * On duplicate normalized email, PostgreSQL raises unique_violation (23505).
 * The caller (Om's auth service) should catch this and return 409.
 *
 * @rule:EMAIL_UNIQUENESS — the unique index on lower(email) is authoritative.
 * @flow:MEMBER_PERSISTENCE — first step before role/membership creation.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ name: string, email: string, passwordHash: string }} params
 * @returns {Promise<{ id: string, name: string, email: string, createdAt: string }>}
 *          Safe user object — password_hash is NOT included.
 */
export async function createUser(db, { name, email, passwordHash }) {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, created_at AS "createdAt"`,
    [name.trim(), email.trim().toLowerCase(), passwordHash]
  );
  return rows[0];
}

// ─── findUserById ─────────────────────────────────────────────────────────────
/**
 * Fetch a safe user profile by primary key.
 * Does NOT return password_hash.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} userId — UUID
 * @returns {Promise<{ id, name, email, createdAt }|null>}
 */
export async function findUserById(db, userId) {
  const { rows } = await db.query(
    `SELECT id, name, email, created_at AS "createdAt"
       FROM users
      WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

// ─── assignRole ───────────────────────────────────────────────────────────────
/**
 * Add an application role to a user. Idempotent: does nothing if already held.
 * Om's register service calls this after createUser() within the same transaction.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ userId: string, roleName: string, grantedBy?: string }} params
 * @returns {Promise<void>}
 */
export async function assignRole(db, { userId, roleName, grantedBy = null }) {
  await db.query(
    `INSERT INTO user_roles (user_id, role_name, granted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, roleName, grantedBy]
  );
}

// ─── getUserRoles ─────────────────────────────────────────────────────────────
/**
 * Return the list of role names held by a user. Used by GET /auth/me.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} userId — UUID
 * @returns {Promise<string[]>} e.g. ['member', 'organizer']
 */
export async function getUserRoles(db, userId) {
  const { rows } = await db.query(
    `SELECT role_name AS role FROM user_roles WHERE user_id = $1 ORDER BY role_name`,
    [userId]
  );
  return rows.map(r => r.role);
}
