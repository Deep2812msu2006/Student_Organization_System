-- Migration: 002_users_and_roles.sql
-- Core identity: users, application roles, and user-role assignments.
--
-- @rule:EMAIL_UNIQUENESS — email must be normalized (trimmed, lowercased)
-- by the model layer before any INSERT or lookup. The unique index on
-- lower(email) is the authoritative DB-level enforcement. The model
-- findUserByEmail() must pass lower(trim(email)) as the query parameter.
--
-- @flow:MEMBER_PERSISTENCE — user creation is the first step; role assignment
-- and membership follow in later migrations. Om's auth service will call
-- createUser() then assign the 'member' role in one service transaction.
--
-- Provisional decisions (document, do not invent silently):
--  - Roles are a fixed application set; see app_role CHECK constraint.
--  - A user may hold multiple roles (e.g., member + volunteer + organizer).
--    Confirm with Om before UI assumes single-role.
--  - Password hashing algorithm (bcrypt/argon2) is Om's choice for the
--    auth service; the column stores the resulting hash string only.

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  -- @rule:EMAIL_UNIQUENESS: store email exactly as supplied (preserving case for
  -- display), but enforce uniqueness on the normalized lowercase form via the
  -- partial index below. Models MUST normalize before querying.
  email          TEXT        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  -- password_hash stores the full hash string (e.g., $2b$... for bcrypt).
  -- NEVER return this field in public profile objects.
  password_hash  TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @rule:EMAIL_UNIQUENESS — case-insensitive unique index. This is the
-- authoritative enforcement point. Inserting duplicate normalized email raises
-- unique_violation (SQLSTATE 23505); the model maps this to a domain conflict.
CREATE UNIQUE INDEX users_email_normalized_idx
  ON users (lower(email));

-- Speed up "find user by normalized email" used in every login/register.
-- (The unique index above is also used for lookups; the comment is for clarity.)

-- ─── Application roles ────────────────────────────────────────────────────────
-- Provisional role set per REQUIREMENTS.md. Confirm multiplicity with Om.
-- 'member'    — joined the organization; may purchase tickets at member price.
-- 'volunteer' — eligible for expense submissions; has task assignments.
-- 'organizer' — may manage events, announcements, tasks and view finance.
-- 'treasurer' — full finance access; may approve expenses and record payments.
CREATE TABLE app_roles (
  name        TEXT PRIMARY KEY CHECK (name IN ('member','volunteer','organizer','treasurer')),
  description TEXT NOT NULL DEFAULT ''
);

INSERT INTO app_roles (name, description) VALUES
  ('member',    'Organization member with ticket/merchandise discount eligibility'),
  ('volunteer', 'Volunteer eligible for expense submission and task assignments'),
  ('organizer', 'Event and announcement management; limited finance read access'),
  ('treasurer', 'Full finance access; expense approval and payment recording')
ON CONFLICT (name) DO NOTHING;

-- ─── User → role assignments ──────────────────────────────────────────────────
CREATE TABLE user_roles (
  user_id     UUID  NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  role_name   TEXT  NOT NULL REFERENCES app_roles(name) ON DELETE RESTRICT,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID  REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_name)
);

CREATE INDEX user_roles_user_idx ON user_roles (user_id);

-- ─── Sessions (PostgreSQL-backed) ─────────────────────────────────────────────
-- Compatible with connect-pg-simple / express-session.
-- Om owns the session middleware wiring; Deep owns this table definition.
-- The column names (sid, sess, expire) match connect-pg-simple defaults.
-- COORDINATION NOTE FOR OM: call createSessionStore(pool) from config/session.js
-- using connect-pg-simple. Pass the existing pool; do not create a second pool.
-- Prune expired sessions with the built-in ttl/pruning config.
CREATE TABLE sessions (
  sid     TEXT        NOT NULL PRIMARY KEY,
  sess    JSONB       NOT NULL,
  expire  TIMESTAMPTZ NOT NULL
);

-- connect-pg-simple queries sessions by expiry for cleanup.
CREATE INDEX sessions_expire_idx ON sessions (expire);
