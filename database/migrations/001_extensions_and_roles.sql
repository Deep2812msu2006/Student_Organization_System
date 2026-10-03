-- Migration: 001_extensions_and_roles.sql
-- Sets up extensions and application roles used by all later migrations.
-- Run once; schema_migrations prevents re-execution.
--
-- @rule:EMAIL_UNIQUENESS — email uniqueness is enforced at the DB level using
-- a UNIQUE index on lower(email). The index is created in 002_users.sql.

-- Enable UUID generation (available in PostgreSQL 13+; built-in in PG 17+).
-- pgcrypto gen_random_uuid() is the alternative if using older PG.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Application roles ────────────────────────────────────────────────────────
-- PROVISIONING NOTE: The `club_user` role must already exist before migrations
-- run; it is created by the DB administrator (see README.md setup block).
-- The GRANT below is idempotent and adds table-level access for tables
-- created in later migrations. In PostgreSQL 14+ we can use DEFAULT PRIVILEGES.

-- Grant future tables in this schema to the app role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO club_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO club_user;
