-- @rule:EMAIL_UNIQUENESS — trim as well as lowercase at the database boundary.
-- If legacy duplicates exist, fail safely for manual reconciliation; never delete users.
DROP INDEX users_email_normalized_idx;
CREATE UNIQUE INDEX users_email_normalized_idx ON users (lower(btrim(email)));
