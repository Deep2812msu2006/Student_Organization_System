# Run the integrated website and share database changes

## What Git shares
Git shares source code, migrations and synthetic seed definitions. It does not
synchronize PostgreSQL records, passwords, sessions or uploaded receipts.

Current integration branch: om/complete-integration. Base: main at 4520256.
This branch must be published before Deep can fetch it. Nothing is pushed automatically.

## Deep: apply this work after the branch is published
Commit or preserve your own changes first. Review the branch before merging.
From your existing repository:

```powershell
git fetch origin
git switch --track origin/om/complete-integration
npm ci
npm run migrate:status
npm run migrate
npm run build
npm run dev
```

If that local branch already exists, switch to it and use git pull --ff-only.
Keep YOUR server/.env pointing to YOUR PostgreSQL instance. Do not copy Om's
credentials or assume his port is your port. Back up important data before applying
migrations. Migration 010 adds community/outbox/tasks and receipt ownership tables.
Earlier migrations 006–009 are applied if your database does not yet have them.

For a disposable demo database only:
```powershell
npm run seed:dev
```
Seeds create known synthetic accounts and records and reset synthetic account
passwords. Never seed a database containing actual club data. Existing seed
membership dates are 2026/2027 demo fixtures, not a recurring policy.

## Two ways to work as a team
1. Separate local databases: everyone runs the same migrations. Records created on
   Om's machine do not appear on Deep's machine. This is the current setup.
2. One shared development database: both servers use the same privately shared
   DATABASE_URL and trusted TLS configuration. Obtain an authorized reachable
   database endpoint from Deep. 127.0.0.1 always means the machine running the
   server, not Deep's laptop. Use a private network or managed database access;
   do not expose a laptop's PostgreSQL publicly.

For the simplest shared demo, run one API server and have all browsers use it.
This also keeps uploaded receipts on one server. Sharing only PostgreSQL does not
share local receipt files. Keep SESSION_SECRET and TICKET_SECRET stable and
consistent across API instances, and share private receipt storage if running
multiple servers. Secrets stay out of Git and frontend code.

## Om's current local instance
Frontend: http://127.0.0.1:5173
API: http://127.0.0.1:5000
Dedicated PostgreSQL: 127.0.0.1:55439 (existing separate development cluster).
Normal start from repository root:

```powershell
npm ci
npm run migrate
npm run dev
```

If Om's dedicated PostgreSQL is stopped, this command applies only to this checkout:
```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D '../../work/foundation-pg' -l '../../work/foundation-pg/server.log' -o '-p 55439 -h 127.0.0.1' start
```

## Tests and local mail
Use a separate, disposable test database with all migrations applied.
Do not point NODE_TEST_DATABASE_URL at a teammate's working database.

```powershell
$env:NODE_TEST_DATABASE_URL = 'postgresql://TEST_USER:ENCODED_TEST_PASSWORD@127.0.0.1:TEST_PORT/ISOLATED_TEST_DB'
npm test
npm run build
npm run reminders:preview
```

Use your actual private test URL; placeholders above are not credentials.
The migration runner uses DATABASE_URL, not NODE_TEST_DATABASE_URL. Apply migrations
to the isolated test URL by setting DATABASE_URL for that command and restore/unset
the override before starting the application.

Mail is a PostgreSQL-backed local preview, not external SMTP. Members opt in on
/mail. Organizers queue reminders and process previews on /staff/mail. The job is
explicitly run; no scheduler is installed. Messages are deduplicated per source and
recipient and suppressed after opt-out. No external email delivery is claimed.

Manual payments record money already received outside the app. No card charging,
payment gateway or refunds are implemented. Paid order cancellation is blocked.
Check-in uses manual admission codes; camera QR scanning is not required or included.
