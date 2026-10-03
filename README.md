# Student Organization System

React + Vite + Express + PostgreSQL for the Skyline Student Association hackathon project. English-only. **Authentication and membership are now implemented.** See [the current handoff](docs/AUTH_MEMBERSHIP_HANDOFF.md) for setup, synthetic demo logins, API changes and verification.

## What works

- Responsive React shell, mobile navbar, accessible navigation, centralized CSS tokens and searchable edit comments.
- Live Express/PostgreSQL health status with retry, loading and honest error states.
- API liveness/readiness, bounded connection/query times, safe errors and baseline security headers.
- Required folder structure, shared contracts, ownership and development documentation.

Also working: signup/login/logout, PostgreSQL sessions, membership enrollment and eligibility, and an organizer-only directory. Not implemented: payment recording, events/tickets, shop, expenses, finance, tasks, mailing, uploads or deployment.

## Prerequisites

- Node.js **22.12 or newer** (Node 24 used for verification), npm, Git.
- A running PostgreSQL installation. PostgreSQL 18 was used for isolated smoke verification.
- One cloned checkout per teammate. No global Vite/Express installation is required.

## Local setup (PowerShell)

If you already have this checkout, start in its root rather than cloning again.

```powershell
git clone https://github.com/Deep2812msu2006/Student_Organization_System.git
Set-Location Student_Organization_System
# This branch exists only locally until Om deliberately pushes it.
# After it is pushed, teammates can switch to it or use the merged main.
npm ci
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

Do not overwrite an existing .env. Edit the copies for your local environment. Without DATABASE_URL, the API starts but readiness honestly returns 503.

Create a local development user/database from a PostgreSQL administrator session. `psql` must be on PATH; on Windows a typical full path is `C:\Program Files\PostgreSQL\18\bin\psql.exe`.

```powershell
psql -h 127.0.0.1 -U postgres -d postgres
```

Inside psql, execute (names must be new; preserve existing databases):

```sql
CREATE ROLE club_user LOGIN;
\password club_user
CREATE DATABASE student_organization OWNER club_user;
\q
```

Enter a local password interactively at the password prompt; do not commit it. Set server/.env DATABASE_URL to `postgresql://club_user:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/student_organization`. URL-encode special password characters. No business migrations are required for SELECT 1 health; Deep will supply migrations later.

Set a random SESSION_SECRET of at least 32 characters in server/.env. Keep existing local .env files. Initialize the schema and start both processes from the repository root:

```powershell
npm run migrate
npm run seed:dev
npm run dev
```

Open **http://127.0.0.1:5173**. The API defaults to http://127.0.0.1:5000. If npm.ps1 is blocked by your PowerShell policy, use `npm.cmd` in place of `npm` rather than changing system policy.

Separate terminals are also supported:

```powershell
npm run dev:server
```

```powershell
npm run dev:client
```

## Verify

```powershell
npm test
npm run build
Invoke-RestMethod http://127.0.0.1:5000/api/live
Invoke-RestMethod http://127.0.0.1:5000/api/health
```

Tests use an injected fake query dependency; a successful live health request separately proves a real DB connection. The browser must show connected only when the real query succeeds. Stop PostgreSQL or use an unreachable test connection and retry to verify the error state.

Optional built-frontend preview (keep the API running):

```powershell
npm run preview -w client
```

Open http://127.0.0.1:4173. Vite's preview proxy is local validation, not production hosting. `npm start` starts only the API. Production will require a frontend host/reverse proxy for /api and HTTPS; that is outside this step.

## Configuration

- server/.env: HOST, PORT, DATABASE_URL, DB_POOL_MAX, DB_CONNECT_TIMEOUT_MS, DB_QUERY_TIMEOUT_MS; optional DB_SSL_CA_FILE for remote TLS with certificate validation.
- client/.env: API_PROXY_TARGET if API host/port differs. Restart Vite after changes.
- Do not place database URLs/secrets in VITE_* variables; these can become browser-visible.
- Root package-lock.json is the shared npm-workspace lockfile. Commit it; ignore node_modules and .env.

## Structure and team docs

```text
client/src/  components layouts pages services hooks context utils styles config
server/      config routes controllers services model validators middleware jobs integrations utils tests
database/    migrations seeds queries
postman/     foundation health collection
docs/        contracts, ownership, requirements, quick edits and walkthrough
```

- [Requirements and boundaries](docs/REQUIREMENTS.md)
- [API/model contracts and transaction ownership](docs/API_CONTRACT.md)
- [Team ownership and merge order](docs/TEAM_OWNERSHIP.md)
- [Quick-change guide](docs/QUICK_CHANGE_GUIDE.md)
- [Code walkthrough](docs/CODE_WALKTHROUGH.md)
- [Verification record](docs/VERIFICATION.md)

Om owns UI/core APIs; Deep owns schema/models/transactions; Dharmik owns supporting APIs/testing/delivery. Start with Deep's users/memberships data contract, then Om's real signup-to-database flow. All teammates use their own feature branches and commits. No pushes or merges are performed by this setup automatically.
