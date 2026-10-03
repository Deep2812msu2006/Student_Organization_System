# Database Setup

Owner: Deep. Last updated: 2026-10-03 on branch `deep/database-foundation`.

## Prerequisites

- PostgreSQL 18 running locally (service `postgresql-x64-18`).
- Node.js ≥ 22.12 and npm (installed with the repo).
- `server/.env` configured (copy from `server/.env.example`).

## One-time database provisioning (run as postgres superuser)

Open psql as the postgres superuser (supply your postgres password at the prompt):

```powershell
psql -h 127.0.0.1 -U postgres -d postgres
```

Inside psql, run exactly the following. These commands are idempotent if the role/database already exist with those names:

```sql
-- Create the non-superuser application role.
-- Do NOT use a superuser for the app; the README explains why.
CREATE ROLE club_user LOGIN;
\password club_user
-- (enter a strong local password at the prompts; do not commit it)

-- Create the development database owned by the app role.
CREATE DATABASE student_organization OWNER club_user;

-- Repeat for an isolated test database (required for npm run test:models).
CREATE DATABASE student_org_test OWNER club_user;

\q
```

## Configure server/.env

Edit `server/.env` (never commit this file):

```
NODE_ENV=development
HOST=127.0.0.1
PORT=5000
DATABASE_URL=postgresql://club_user:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/student_organization
DB_POOL_MAX=10
DB_CONNECT_TIMEOUT_MS=3000
DB_QUERY_TIMEOUT_MS=4000
```

URL-encode special characters in the password. For example, `@` becomes `%40`.
Do not add `sslmode` to the URL; use `DB_SSL_CA_FILE` for remote TLS only.

## Apply migrations

From the repository root:

```powershell
npm run migrate
```

Expected output:

```
  run    001_extensions_and_roles.sql ... done
  run    002_users_and_roles.sql ... done
  run    003_membership.sql ... done

3 migration(s) applied.
```

Re-running is safe:

```powershell
npm run migrate
# All migrations already applied. Nothing to do.
```

Check status without running:

```powershell
npm run migrate:status
```

## Apply development seeds (optional)

Seeds insert synthetic records only. They skip if records already exist.

```powershell
npm run seed:dev
```

Synthetic users created (local dev only; fake hashes, fake emails):

| Email | Roles | Membership |
|---|---|---|
| dev-member@example.local | member | Active paid (2026-04-01 → 2027-03-31) |
| dev-organizer@example.local | member, organizer | Pending unpaid |
| dev-treasurer@example.local | member, organizer, treasurer | Expired paid (2025-04-01 → 2026-03-31) |

## Run model integration tests

Set `NODE_TEST_DATABASE_URL` to the test database first:

```powershell
$env:NODE_TEST_DATABASE_URL = "postgresql://club_user:YOUR_PASSWORD@127.0.0.1:5432/student_org_test"

# Apply migrations to the test database first:
$env:DATABASE_URL = $env:NODE_TEST_DATABASE_URL
npm run migrate
$env:DATABASE_URL = "postgresql://club_user:YOUR_PASSWORD@127.0.0.1:5432/student_organization"

# Run model tests:
npm run test:models
```

Or run all tests (model tests skip gracefully if `NODE_TEST_DATABASE_URL` is unset):

```powershell
npm test
```

## Verify connectivity

After starting the server (`npm run dev:server`), check both endpoints:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/live
# → { data: { status: 'ok', api: 'available' } }

Invoke-RestMethod http://127.0.0.1:5000/api/health
# → { data: { status: 'ok', api: 'available', database: 'connected', checkedAt: '...' } }
```

## Migration file conventions

- Files live in `database/migrations/`.
- Name pattern: `NNN_description.sql` where `NNN` is a zero-padded 3-digit number.
- Applied migrations are tracked in `schema_migrations` (created automatically).
- Each migration runs inside a transaction; it rolls back on failure.
- Never edit an applied migration; add a new numbered file instead.

## Provisional decisions (must confirm before production)

| Topic | Provisional demo policy | Decision needed |
|---|---|---|
| Membership year-end | March 31 of the year after signup | Confirm academic calendar year-end |
| Currency | INR (paise minor units) | Confirm official currency |
| Standard plan dues | 500 INR (50 000 paise) | Confirm actual dues amount |
| Role multiplicity | Users may hold multiple roles | Confirm with Om |
| Payment mode | Manual recording by treasurer | Confirm: manual demo vs async gateway |

## Tables created by migrations

| Table | Migration | Purpose |
|---|---|---|
| `schema_migrations` | runner bootstrap | Applied migration tracking |
| `users` | 002 | Identity; email unique on `lower(email)` |
| `app_roles` | 002 | Fixed role set (member/volunteer/organizer/treasurer) |
| `user_roles` | 002 | User-to-role assignments |
| `sessions` | 002 | PostgreSQL-backed express-session store |
| `membership_plans` | 003 | Plan configuration with dues/discount snapshot |
| `membership_periods` | 003 | Per-user membership windows |
| `dues_obligations` | 003 | Dues state per period (pending/paid/waived) |
