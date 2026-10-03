-- Migration: 002_users_and_roles.sql
-- Core identity: users, application roles, and session persistence.
-- @rule:EMAIL_UNIQUENESS — Case-insensitive email uniqueness enforced at DB level.

-- ─── Users table ─────────────────────────────────────────────────────────────
CREATE TABLE users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  email          TEXT        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  password_hash  TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive unique index for normalized email lookup
CREATE UNIQUE INDEX users_email_normalized_idx
  ON users (lower(email));

-- ─── Application roles ────────────────────────────────────────────────────────
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

-- ─── User role assignments ───────────────────────────────────────────────────
CREATE TABLE user_roles (
  user_id     UUID  NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  role_name   TEXT  NOT NULL REFERENCES app_roles(name) ON DELETE RESTRICT,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID  REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_name)
);

CREATE INDEX user_roles_user_idx ON user_roles (user_id);

-- ─── Sessions table (connect-pg-simple compatible) ────────────────────────────
CREATE TABLE sessions (
  sid     TEXT        NOT NULL PRIMARY KEY,
  sess    JSONB       NOT NULL,
  expire  TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_expire_idx ON sessions (expire);
