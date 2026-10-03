-- Migration: 001_extensions_and_roles.sql
-- UUID extension and default database privileges for application role.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Grant default privileges for future tables and sequences to club_user
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO club_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO club_user;
