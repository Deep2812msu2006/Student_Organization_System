# Foundation verification

> New milestone: all 24 tests passed with a real isolated PostgreSQL test database, with no skips; frontend build and browser signup/enrollment/session/role flows passed. Details and database-foundation repairs are in [AUTH_MEMBERSHIP_HANDOFF.md](AUTH_MEMBERSHIP_HANDOFF.md). The record below is the original foundation verification.

Verified on 2026-10-03 in the local Windows checkout on branch `om/project-setup`.

## Passed

- Node.js 24.12.0 / npm 11.6.2; dependency installation completed and root npm-workspace package-lock.json generated.
- `npm ci` completed successfully, verifying reproducible installation from the lockfile.
- `npm test`: six automated API tests passed. Coverage: liveness without DB; real query invocation through an injected dependency; missing configuration; sanitized driver failure; unknown route; malformed/oversized JSON.
- `npm run build`: Vite 8.3.2 compiled the React application successfully.
- `npm ls --depth=0`: all workspace dependencies resolved without invalid/missing dependencies.
- A separate temporary PostgreSQL 18 cluster was initialized under the task's scratch directory and bound to 127.0.0.1:55439. The API on test port 5057 returned 200 with database=connected from a real SELECT 1 query. No existing user database was modified.
- After stopping that temporary database, `/api/health` returned 503 DATABASE_UNAVAILABLE while `/api/live` still returned 200.
- Headless Edge browser checks at 1440x1050 and 390x844: live connection display, retry, six clearly planned modules, mobile menu toggle, Escape/focus behavior, closing menu on navigation, no horizontal overflow and no JavaScript page errors.
- A simulated 503 browser response displayed an honest error and recovered after retrying against the live API.
- Desktop/mobile full-page screenshots were visually inspected for layout and clipping.
- npm reported zero known vulnerabilities during installation. This is a registry snapshot, not a security audit of the application.

## Scope and limits

API tests use an injected database query dependency; real PostgreSQL smoke verification is reported separately. Browser checks were performed with a task-local Playwright script and are not yet a committed end-to-end suite. Dharmik can add that suite in his testing work.

No business tables, auth, permission enforcement, transactions for booking/stock, uploads, payments or mail exist, so none are claimed tested. No deployment, GitHub push or merge occurred. Local changes are left for review, not automatically committed. The temporary PostgreSQL cluster and test API/Vite processes were stopped after verification. The user's permanent local database and .env remain to be configured using README.md.
