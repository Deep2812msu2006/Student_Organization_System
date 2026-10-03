# Step 4 — events, registration and tickets

Branch: `om/events`, based on main `bc8c41e` (Deep's event work merged). Uses migration 005 and Deep's existing event models. No payment/check-in API was added. No push or merge is performed by this step.

## Working screens

- `/events`: public, paginated published events with real available seats and prices.
- `/events/:id`: details, server-evaluated eligible price, registration availability and reservation action.
- `/organizer/events`: organizer-only listing including drafts and cancelled events.
- `/events/new`, `/events/:id/edit`: organizer create/edit, dates, capacity and integer minor-unit prices.
- `/tickets`: own registrations with status, price snapshot, and a manual admission code when eligible. This implementation uses a readable code; a QR scanner is Dharmik's follow-up.

## Run

From repository root, with the existing ignored .env retained:

```powershell
npm ci
# Add a stable, independent TICKET_SECRET of at least 32 random characters to server/.env.
# Generate locally: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run migrate
npm run seed:dev
npm run dev
```

Om's local TICKET_SECRET is already generated and stored only in ignored server/.env. Do not copy that file into Git. Share a secret only through an appropriate private configuration mechanism when sharing one deployed database/environment. Different machines with separate databases may use separate secrets.

Browser: http://127.0.0.1:5173/events. API: port 5000. Existing PostgreSQL dev configuration remains unchanged. Existing synthetic member/organizer logins are documented in AUTH_MEMBERSHIP_HANDOFF.md.

## API contract (implemented)

All paths below are relative to `/api/v1`. Existing sessions, `X-CSRF-Token`, strict validation and organizer role checks apply. No-store headers prevent personalized prices/tokens being cached.

- GET `/events?page=1&pageSize=12`: public published-only list; `{data: Event[], pagination:{page,pageSize,total}}`. Page sizes 1–50.
- GET `/events/:id`: public published detail. Adds `eligiblePriceMinor`, `memberPriceEligible`, `bookingOpen`. Public visitors receive standard price. Draft/cancelled detail returns 404.
- GET `/organizer/events`, GET `/organizer/events/:id`: organizer-only management access to all publication states.
- POST `/events`: organizer, validated event object → 201.
- PATCH `/events/:id`: organizer, nonempty subset of allowed fields → updated event. Omitted fields are preserved (no creation defaults on PATCH).
- POST `/events/:id/registrations`: authenticated, strict empty JSON body `{}`, `Idempotency-Key` header of 16–100 letters/digits/hyphens/underscores. Returns 201 `{data: Registration,replayed:false}` or 200 for the same request replay.
- GET `/tickets/me`: authenticated owner-only ticket summaries, event metadata, `admissionCode` (string or null), and `codeStatus` (`ready`, `used`, `not_eligible`, `reissue_required`). No token hash, other user's ticket, or internal idempotency key is returned.

Event fields: title (1–200), description (0–5000), venue (1–200), startsAt/endsAt (ISO with timezone), capacity (1–100000), memberPriceMinor/publicPriceMinor (integers 0–100000000), currency (INR/USD/EUR/GBP), status (draft/published/cancelled). Creation/edit requires a future start and end after start. UI datetime inputs are local time and converted to ISO; detail display explicitly uses UTC. User content is rendered as text.

Errors include INVALID_ID, VALIDATION_ERROR, INVALID_DATES, EVENT_STARTED, EVENT_NOT_FOUND, REGISTRATION_CLOSED, EVENT_FULL, ALREADY_REGISTERED, IDEMPOTENCY_CONFLICT, CAPACITY_BELOW_ALLOCATED, EXISTING_REGISTRATIONS and TICKET_CONFIGURATION_REQUIRED, along with existing authentication/CSRF errors.

## Allocation and pricing rules

Deep's policy is retained: **pending and confirmed reserve seats**; cancelled does not. There is one active registration per user/event. Pending holds currently do not expire automatically. This is a limited manual-confirmation prototype, not a production checkout or payment gateway.

All new registrations, including zero-price registrations, start pending. No click on this UI records payment or confirms admission. Dharmik must supply trusted confirmation/cancellation and decide the release/expiry workflow. Do not claim simulated paid revenue from these reservations.

The service uses one transaction/client: scoped idempotency lock → replay lookup → event FOR UPDATE → capacity count → current membership lookup → insertion. Active paid membership selects the event's memberPriceMinor; other accounts use publicPriceMinor. Membership-plan percentage discounts are not stacked. The price is saved on the registration and does not change when event prices change.

Idempotency keys are SHA-256-scoped by user. Replays on the same event return the existing registration even when it later changes state; using that key for a different event returns 409. Different requests for the same active user/event are rejected by Deep's unique constraint. Event edits use the same row lock; capacity cannot fall below allocated seats. Currency/publication status cannot change with allocated seats until a cancellation workflow exists.

## Admission code handoff for Dharmik

`server/utils/ticketToken.js` defines the exact format:

1. Internal key = SHA-256 of `userId + ':' + clientIdempotencyKey` (UTF-8).
2. Admission token = `sky1_` + base64url HMAC-SHA256(TICKET_SECRET, `ticket:v1:` + internal key).
3. Stored `registrations.token_hash` = lowercase hex SHA-256 of the **entire displayed admission token**, including `sky1_`.

This is cryptographically pseudorandom to clients without the secret. Only a hash is stored; owners can retrieve the same code after refresh using the stable secret. Do not log tokens. Rotating TICKET_SECRET requires explicit code reissue; existing hashes are checked and mismatched codes are never returned.

New tickets show a code only when confirmed, not checked in, event published and event not ended. Pending/cancelled tickets show no code. Deep's legacy seeded confirmed tickets were created from unrelated synthetic token strings, so they correctly show `reissue_required`; their unknown raw tokens are not guessed, exposed or silently replaced.

For check-in, accept `{eventId,ticketToken}` with staff authentication/authorization, verify event status/time policy, calculate SHA-256 of the exact token, and call Deep's `checkInEligibleTicket` with that hash. Keep audit updates in the same transaction and handle a zero-row result as ineligible/already used. The existing low-level status setter does not by itself enforce event capacity or payment proof: wrap confirmation/cancellation/reactivation in the required event-lock/permission/payment-evidence workflow. Never reactivate a cancelled ticket without rechecking capacity.

## Additive model integration

- listPublishedEvents accepts `includeUnpublished` only from the server's organizer route, not from query-string input.
- updateEvent performs parameterized writes under the caller's event lock.
- listUserTickets retains its safe no-hash contract, with eventStatus added.
- ownedTicketCredentials is a separate internal, user-scoped lookup. The service strips its contents and returns only an eligible admission code.

## Verification completed

- All 33 tests passed with a real isolated migrated PostgreSQL test database, none skipped. Includes Deep's final-seat race and check-in model tests, plus event API role/visibility, malformed inputs, active/unpaid/expired/non-member pricing, tamper rejection, price snapshot preservation, capacity reduction rejection, replay/different-event key reuse, final-seat concurrency, pending no-code, confirmed token hash matching, and owner-only ticket access.
- Frontend production build passed.
- Browser checks: organizer creates and edits a published event; active member gets member price; reservation stays pending without admission code; ticket persists after refresh; mobile layout/menu has no horizontal overflow or JavaScript errors.
- Database-backed development health and migration/seed commands succeeded. Browser rehearsal created an explicitly synthetic “Demo workshop” event in the local development database.

Run isolated tests with `NODE_TEST_DATABASE_URL` pointed at a separate migrated test database, then `npm test`. Never point tests at shared/development records. Browser verification used a task-local Playwright script, not a committed browser test suite.

Remaining: Dharmik's payment confirmation, cancellation/hold-expiry workflow, scanner/check-in API, legacy code reissue and financial reporting. No deployment was attempted.
