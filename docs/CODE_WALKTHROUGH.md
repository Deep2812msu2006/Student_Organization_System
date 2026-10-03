# Foundation walkthrough

## Current event request flow

React event screens use services/api.js (session cookie, CSRF header, idempotency header) → event.routes.js (validation and permissions) → event.service.js (member price, same-event lock, capacity and replay policy) → Deep's event.model.js → PostgreSQL. Organizer PATCH holds the same event lock as registrations. My Tickets uses a safe summary query and an internal owner-scoped credential query; it never exposes stored hashes. See [EVENTS_HANDOFF.md](EVENTS_HANDOFF.md) for exact token and payment boundaries.

## Check-in and payment flow (Step 5)

Staff check-in: CheckInPage.jsx → api('/checkins') → checkin.routes.js (auth + organizer role + CSRF) → checkin.service.js → hashToken(submitted code) → event.model.js checkInEligibleTicket (atomic conditional UPDATE). Returns admission result or denial without exposing personal data.

Manual payment: PaymentPage.jsx → api('/payments/manual') → checkin.routes.js → payment.service.js → validates registration status + amount/currency → transaction(lockEvent + insertPaymentRecord + confirmRegistration) → returns payment evidence + confirmed registration. Zero-price path uses method='zero_price'. See [CHECKIN_PAYMENT_HANDOFF.md](CHECKIN_PAYMENT_HANDOFF.md) for full contract.

> This describes the original foundation. Authentication and membership now work; see [the current walkthrough and handoff](AUTH_MEMBERSHIP_HANDOFF.md). Business requests now pass through PostgreSQL sessions, CSRF verification, strict validation and role checks before the service/model layer.

## What happens when the page loads?

client/index.html loads client/src/main.jsx. React mounts App, which uses PublicLayout and HomePage. PublicLayout renders the skip link, Navbar, main landmark and footer. HomePage renders static roadmap/copy and a real ConnectionStatus component. Roadmap copy is static presentation metadata, not fabricated business data.

Navbar reads public links from config/navigation.js and brand values from config/site.js. Mobile menu state belongs to Navbar; Escape closes it and returns focus. All colors and spacing begin in styles/tokens.css. The required @edit comments are there or beside their config object.

## Where does the browser request enter?

ConnectionStatus calls useHealth, which calls getHealth in services/healthApi.js. fetch('/api/health') goes to Vite on the browser's origin. Vite's development/preview proxy forwards /api to Express (default port 5000). Browser code never connects directly to PostgreSQL and receives no database credentials.

useHealth cancels replaced/unmounted requests and gives up after ten seconds. Errors are shown honestly; “Check again” starts a new request. The UI does not poll continuously or claim that health implies business features are ready.

## How does the server start?

server/server.js reads server/.env through config/env.js using a path relative to the source file, so root workspace commands work. Configuration validates URL/port/pool bounds without printing the connection string. createDatabase in config/db.js creates a single pg pool only when DATABASE_URL exists. No implicit fallback to machine PG credentials is allowed.

createApp in app.js wires Helmet security headers, a bounded JSON parser, the liveness route, health router and safe errors. HOST defaults to loopback. The entry point handles shutdown and closes the pool.

## Where does SQL run?

routes/health.routes.js maps GET /api/health to createHealthController in controllers/health.controller.js. The @flow:DATABASE_HEALTH comment marks the real SELECT 1 query. This fixed query has no user input, so no interpolation is involved. Future business SQL belongs in server/model and must use pg parameters ($1, $2, ...).

No database schema is needed for health. Missing configuration or driver failure returns 503 without credentials or driver stack traces. GET /api/live returns 200 independently of PostgreSQL. An unknown business endpoint returns 404 rather than placeholder success.

## What is validated now?

Configuration bounds and PostgreSQL URL format; request JSON syntax and 100 KB body limit; expected health response shape on the client. There are no business forms or business permissions yet. Helmet is a baseline, not a substitute for auth, CSRF protection, validation or authorization.

## Why separate controller/service/model?

Controllers translate HTTP to domain input/output. Services own business decisions and transaction boundaries. Models own parameterized SQL. Deep implements the agreed model signatures; Om/Dharmik call them with the same checked-out client during a transaction. This avoids different queries accidentally running on different database connections.

## Questions judges may ask

- Is the data dynamic? The current health status is from a real API/database query. The cards are clearly labeled roadmap content. Business records are not implemented yet.
- Can I change navbar color quickly? Search @edit:NAVBAR_COLORS in tokens.css. Navbar.css consumes these variables.
- Can a hidden menu protect an API? No. Future permissions must be enforced by the server per route and record.
- What prevents duplicate bookings/check-ins? Bookings use Deep's row lock + unique constraint + advisory lock. Check-in uses atomic conditional UPDATE: `status = 'confirmed' AND checked_in_at IS NULL`. Payment confirmation uses idempotency keys + conditional `status = 'pending'` update. See @rule:CHECKIN_ONCE and @rule:PAYMENT_ONCE.
- Is the app production-ready? No. It needs HTTPS, production deployment, email verification, persistent rate limits, session cleanup scheduling. Manual payment is a demo workflow; a real payment gateway is not implemented.
- Is Odoo used? No. The user selected React/Express/PostgreSQL; no supplied requirement mandates Odoo integration.

## Current checks

server/tests/health.test.js tests health/liveness, database exceptions, missing configuration, unknown routes and malformed/oversized JSON using an injected test database dependency. These tests do not alone prove PostgreSQL connectivity. A live PostgreSQL smoke check is separate. npm run build compiles the actual React application. See VERIFICATION.md for the checks actually run during this foundation work.

server/tests/auth.model.test.js and server/tests/member.model.test.js test the SQL models. They skip gracefully when NODE_TEST_DATABASE_URL is not set; run `npm test` to see skip markers, or set the variable and run `npm run test:models` to execute them against a real database.

## Database flow (deep/database-foundation additions)

### How migrations run

`npm run migrate` invokes `database/migrate.js`. The runner reads `server/.env` through `server/config/env.js` (same path logic as the API). It bootstraps `schema_migrations`, loads already-applied names, then iterates `database/migrations/NNN_*.sql` files in sorted order. Each unapplied file runs inside a transaction (BEGIN → DDL → INSERT INTO schema_migrations → COMMIT). If a migration fails, the transaction rolls back and the runner exits. Re-running is always safe.

### How models work

`server/model/auth.model.js` and `server/model/member.model.js` export plain async functions that accept `db` (a `pg.Pool` or `pg.PoolClient`). They never call `BEGIN`, `COMMIT` or `ROLLBACK`. They never send HTTP responses. Om's service checks out a client, calls `BEGIN`, calls the model functions with the client, then calls `COMMIT` or `ROLLBACK` in a `finally` block. This guarantees all queries in one service operation use the same database connection.

### Searchable code tags

- `@rule:EMAIL_UNIQUENESS` — `database/migrations/002_users_and_roles.sql` (index), `server/model/auth.model.js` (lookup/insert).
- `@rule:MEMBERSHIP_VALIDITY` — `database/migrations/003_membership.sql` (schema/constraints), `server/model/member.model.js` (CASE expression in getMemberProfile).
- `@flow:MEMBER_PERSISTENCE` — `server/model/auth.model.js` (createUser, assignRole), `server/model/member.model.js` (createMembership), `database/seeds/001_dev_users.js`, `database/seeds/002_dev_memberships.js`.
- `@flow:DATABASE_HEALTH` — `server/controllers/health.controller.js` (SELECT 1, unchanged from foundation).
- `@flow:CHECKIN` — `server/services/checkin.service.js` (hash token → atomic conditional update → result).
- `@flow:PAYMENT_CONFIRMATION` — `server/services/payment.service.js` (validate → idempotency → atomic transaction).
- `@rule:PAYMENT_ONCE` — `server/model/payment.model.js`, `server/services/payment.service.js` (idempotency + conditional status change).
- `@rule:PAYMENT_EVIDENCE` — `database/migrations/006_payment_records.sql`, `server/model/payment.model.js`.
- `@rule:STAFF_PERMISSION` — `server/routes/checkin.routes.js` (requireRole('organizer') on all routes).
- `@edit:CHECKIN_UI` — `client/src/pages/staff/CheckInPage.jsx`.
- `@edit:PAYMENT_UI` — `client/src/pages/staff/PaymentPage.jsx`.
- `@edit:ADD_MIGRATION` — `docs/QUICK_CHANGE_GUIDE.md`, `database/migrations/` (add NNN_description.sql).

### Key constraints enforced at DB level

| Rule | Mechanism | Location |
|---|---|---|
| Email uniqueness (case-insensitive) | UNIQUE INDEX on `lower(email)` | 002 migration |
| Password never exposed | Model function returns column list (no hash) | auth.model.js |
| Money is integer-only | `INTEGER NOT NULL` columns for `*_amount_minor` | 003 migration |
| Timestamps with timezone | `TIMESTAMPTZ NOT NULL` everywhere | 002–003 |
| expires_at > starts_at | CHECK constraint | 003 migration |
| Dues paid requires paid_at | CHECK `status != 'paid' OR paid_at IS NOT NULL` | 003 migration |
| Role set is fixed | CHECK constraint on `app_roles.name` | 002 migration |
| Check-in once only | Conditional UPDATE: `checked_in_at IS NULL` + `status = 'confirmed'` | 005 migration, event.model.js |
| Payment evidence durability | `payment_records` with UNIQUE `idempotency_key` | 006 migration |
| Registration confirmation atomic | Payment record + status change in one transaction | payment.service.js |

