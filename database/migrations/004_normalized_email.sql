-- Migration: 004_normalized_email.sql
-- @rule:EMAIL_UNIQUENESS — Trim and lowercase email at database boundary.

DROP INDEX users_email_normalized_idx;
CREATE UNIQUE INDEX users_email_normalized_idx ON users (lower(btrim(email)));
