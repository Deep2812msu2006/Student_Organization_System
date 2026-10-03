# Team ownership and merge order

## Om

Owns client/src and the shared shell/config/styles, core server configuration, auth/membership/event-registration/order routes/controllers/services. Coordinates changes to server/app.js, root package scripts and shared contracts. Dharmik may contribute a check-in component through an explicitly scoped PR.

## Deep

Owns database/migrations, database/seeds, database/queries and server/model. Implements parameterized SQL, database constraints, indexes, atomic operations and reporting queries. Reviews transaction design with service owners. Coordinates database pool changes with Om; do not create a second pool per module.

## Dharmik

Owns check-in, expense, finance, announcement and task routes/controllers/services; reminders in server/jobs; adapters in server/integrations; private receipt handling; postman collection, verification and delivery documentation. Writes integration/permission tests with Om and Deep. This is a development role, not just presentation ownership.

## Shared files and parallel work

- Agree request fields and model signatures before implementing either side; document amendments in API_CONTRACT.md.
- Om reviews shared app/router changes; Deep reviews all schema/model changes.
- Each contributor updates the root package-lock.json using npm from the repository root. Resolve dependency conflicts with npm, never manually splice lockfile internals.
- QUICK_CHANGE_GUIDE and CODE_WALKTHROUGH must describe the current code, not an intended future implementation.
- Do not copy auth/SQL implementations between modules or change another person's contract silently.

## Merge order

1. Om: om/project-setup (this branch). Verify install, tests, client build and health before merging.
2. Deep: users/sessions/membership schema and models; publish signatures early.
3. Om: auth and persistent member flow. Dharmik prepares Postman/permission tests in parallel.
4. Deep: event/ticket models; Om: event/registration services/UI; Dharmik: check-in after token/auth contracts exist.
5. Deep: finance/expense/order/stock models. Dharmik: expense/finance API; Om: shop and expense/dashboard screens.
6. Dharmik: task/announcement/reminder APIs with Deep's models; Om: corresponding screens.
7. Integrate, verify, document gaps and rehearse. No new features near demo freeze.

## Git workflow

All three people clone the same repository, configure their own real Git identity, and create short feature branches from the latest merged main. Do not share one working directory between active teammate sessions. Push only when the branch is reviewed locally; use PRs into main and have another teammate review. Do not force-push, reset others' work or merge automatically.

Example (after ensuring your current changes are committed or otherwise safely preserved):

```sh
git switch main
git pull --ff-only
git switch -c deep/member-schema
# Make and check the scoped change.
git add database server/model docs
git diff --cached
git commit -m "Add membership schema and queries"
git push -u origin deep/member-schema
```

GitHub collaborator access must be granted by the repository owner. Local file edits do not prove remote push permission. This foundation run does not push, merge or impersonate team contributions.
