# Authentication and membership handoff

Implemented on `om/auth-membership`, based on merged main b693070. No push/merge is implied by this handoff.

## Working now

- `/register`, `/login`, `/membership`, organizer-only `/members`.
- Bcrypt password hashing, PostgreSQL sessions, session regeneration at login/signup, CSRF tokens, auth rate limiting, strict request validation, safe errors and role checks on the server.
- Persistent member profile, database plans, pending-dues enrollment, current membership eligibility and organizer directory pagination.
- Enrollment locks the user row in a transaction; concurrent duplicates return 409. Client-supplied prices, roles or paid flags are rejected.

## Setup

Keep your ignored .env files; never copy another teammate's local database address blindly. `127.0.0.1` refers to your own machine.

```powershell
npm ci
# Set DATABASE_URL and a random SESSION_SECRET of at least 32 characters in server/.env.
npm run migrate
npm run seed:dev
npm run dev
```

Generate a secret locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and store it only in .env. Browser URL: http://127.0.0.1:5173. API: http://127.0.0.1:5000. Without a session secret the business router is not mounted.

For Om's machine, the separately approved development database uses port **55439**, database **student_organization_dev**, and role **club_user** with a generated local password stored only in server/.env. The existing PostgreSQL service on port 8000 was not modified. The separate instance is a local process, not an automatically started Windows service. Its cluster directory is `work/foundation-pg` relative to the parent chat workspace (outside this checkout); retain that directory. After a machine restart, start that cluster with PostgreSQL's pg_ctl before running the app:

```powershell
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D '../../work/foundation-pg' -l '../../work/foundation-pg.log' -o '-h 127.0.0.1 -p 55439' -w start
```

Run that command from this checkout root. Other teammates should use their own PostgreSQL setup instead. Development database connections require a password. Temporary isolated test databases remain separate from development data.

## Synthetic development logins

Only after `seed:dev`, which refuses production:

- Member: `dev-member@example.local` / `Dev$Member1!`
- Organizer: `dev-organizer@example.local` / `Dev$Org1!`
- Treasurer: `dev-treasurer@example.local` / `Dev$Treasurer1!`

These are synthetic local fixtures, not real accounts or production credentials. Signup creates a member-role account only. Role does not imply paid membership. Seed membership dates remain demonstration fixtures, not a rolling production policy.

## Implemented API delta

All business routes use `/api/v1`. GET `/auth/csrf` starts a session and returns `{data:{csrfToken}}`. Send the session cookie and `X-CSRF-Token` on every POST. Registration/login regenerate the session and return `{data:{user,csrfToken}}`; use that new token afterward. GET `/auth/me` has the same data shape. Logout invalidates the session and returns 204.

- POST `/auth/register`: strict name/email/password; minimum password length 10, maximum 72 UTF-8 bytes.
- POST `/auth/login`: email/password; generic invalid-credentials response.
- GET `/members/me`: safe profile plus server-computed benefits.
- GET `/membership-plans`: authenticated plans plus provisional year-end policy metadata.
- POST `/memberships`: `{planId}` only; server sets dates, amount and pending dues.
- GET `/members?page=1&pageSize=20`: organizer only; size max 50.

Membership year-end defaults to March 31 **UTC**, exclusive of April 1 midnight, configurable via MEMBERSHIP_YEAR_END_MONTH/DAY. This is a provisional demo policy, not a confirmed organization requirement. Enrollment is intentionally blocked when a current/future period already exists; advanced early renewals are not part of this slice.

## Repairs to the merged database foundation

- Tests now clean up rows before closing their pools. Previously 13 of 21 tests failed with a live database even though a no-database run skipped them.
- Development users now receive real bcrypt hashes; only the exact previous placeholder on known synthetic identities is repaired. Real passwords are not overwritten.
- Profile/directory period selection prefers a current period over a future renewal.
- Migration 004 enforces trimmed/lowercase email uniqueness; service/model normalization matches it. Legacy collisions fail safely rather than deleting accounts.
- Migration/seed runners reuse the configured pool and TLS settings rather than forcing SSL off.

## Verification

24 tests passed with NODE_TEST_DATABASE_URL pointing to an isolated migrated PostgreSQL database; none skipped. Includes Deep's model tests, API session persistence, role/CSRF checks, concurrent duplicate enrollment, logout invalidation, normalized duplicate signup, pending benefits, renewal selection and expiry boundaries. Production frontend build passed.

Browser verification: signup → enrollment → refresh persistence → denied member-directory access → logout → seeded organizer login and directory → seeded active-member login → mobile layout/menu. No JavaScript page errors or mobile horizontal overflow were observed. Fresh migrations and repeated migrations/seeds also passed for the new local development database.

## Remaining work

Dharmik: trusted payment evidence/recording, reminder job, check-in, expenses, tasks and announcements. Om/Deep: events/tickets and merchandise layers. Password reset, email verification, persistent distributed rate limits and production deployment are not implemented. Expired session cleanup is currently disabled to avoid background test timers; schedule session cleanup before production. Payment settlement must update dues through an authorized transaction with evidence; do not add a public paid flag or UI shortcut.
