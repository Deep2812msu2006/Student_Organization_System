# API and model contracts

> Step 4 update: event/registration/ticket APIs are implemented. [EVENTS_HANDOFF.md](EVENTS_HANDOFF.md) is the current event contract, including pending-seat policy, idempotency and Dharmik's admission-token interface. Its implemented status supersedes older planned-event wording below.

> Current implementation: [AUTH_MEMBERSHIP_HANDOFF.md](AUTH_MEMBERSHIP_HANDOFF.md) specifies the implemented auth/member endpoints, CSRF handshake and response shapes. The foundation-only descriptions below are historical; use the handoff for the current milestone. Other business endpoints remain planned.

## Implemented now

GET `/api/live`: public liveness, no database dependency. 200 `{ "data": { "status": "ok", "api": "available" } }`.

GET `/api/health`: public readiness; runs a bounded `SELECT 1 AS healthy`. 200 `{ "data": { "status": "ok", "api": "available", "database": "connected", "checkedAt": "ISO timestamp" } }`. No tables are needed. 503 errors: `DATABASE_NOT_CONFIGURED` or `DATABASE_UNAVAILABLE`. It never returns connection strings or driver exceptions. Both endpoints set `Cache-Control: no-store`.

Unknown routes return 404 JSON, including all planned business routes below. Malformed JSON returns 400; JSON above 100 KB returns 413. No login, roles or sessions exist yet. Do not mount business data routes before their access controls are implemented.

## Shared conventions for planned business APIs

Prefix `/api/v1`; JSON camelCase, SQL snake_case. UUID identifiers and ISO timestamp strings are proposed. Monetary fields are integer minor units and include a currency context. Reject unknown privileged fields such as role/paymentStatus from public signup or checkout. Server computes prices and eligibility.

Success: `{ "data": ... }`; error: `{ "error": { "code": "STABLE_CODE", "message": "Safe human message", "fields": { "fieldName": "Optional validation message" } } }`.

Paginated list: `{ "data": [], "pagination": { "page": 1, "pageSize": 20, "total": 0 } }`. Validate positive integer page and pageSize 1–50. Use stable ordering with a unique tie-breaker. Planned statuses: 201 created, 204 successful bodyless action, 400 invalid input, 401 unauthenticated, 403 forbidden, 404 missing/not-visible record, 409 duplicate/capacity/stock/state conflict, 413 oversized upload/body, 429 rate limit, 500 safe internal error.

Authentication proposal: opaque HttpOnly cookie session stored in PostgreSQL. Secure cookies and HTTPS on deployment, appropriate SameSite and CSRF protection for cookie-authenticated state-changing requests. Same-origin reverse proxy in production; Vite proxy only for development/preview. Client navigation is never authorization.

## Planned routes — not mounted or implemented

### Om: auth/membership

- POST `/auth/register`: `{name,email,password}` → 201 `{id,name,email}`. Public; server assigns least privilege.
- POST `/auth/login`: `{email,password}` → user summary plus session cookie; rate-limited. POST `/auth/logout`: CSRF-protected session invalidation → 204.
- GET `/auth/me`: current user `{id,name,email,roles}` or 401.
- GET `/members/me`: own profile and membership `{status,startsAt,expiresAt,plan,duesAmountMinor,currency}`.
- GET `/members?page=1&pageSize=20`: organizer-only directory; do not expose it publicly.
- POST `/memberships`: authenticated `{planId}` → pending dues obligation. Server establishes dates/policy. It does not accept a client-supplied paid state.

### Om: events/tickets

- GET `/events`, GET `/events/:id`: published events public; safe fields `{id,title,venue,startsAt,endsAt,capacity,seatsAvailable,publicPriceMinor,currency}`. An authenticated response may include the server-derived eligible price; do not cache across users.
- POST `/events`: organizer `{title,venue,startsAt,endsAt,capacity,memberPriceMinor,publicPriceMinor,currency}` → 201 event.
- PATCH `/events/:id`: organizer; do not reduce capacity below allocated seats or silently reprice existing purchases.
- POST `/events/:id/registrations`: authenticated, idempotency key; server selects price and capacity treatment → `{id,eventId,status,priceMinor,currency}`. Decide manual vs asynchronous payment allocation policy before implementation.
- GET `/tickets/me`: own eligible registrations with display/check-in token; do not list another person's ticket token.

### Om: merchandise

- GET `/products`: published products and variants `{id,name,variants:[{id,size,priceMinor,stockAvailable}],currency}`.
- POST `/orders`: authenticated `{items:[{variantId,quantity}]}` plus idempotency key → server-priced order `{id,status,totalMinor,currency,items}`. Positive bounded quantities; lock variants in deterministic order.
- GET `/orders/me`: own paginated orders.

### Dharmik: check-in

- POST `/checkins`: event-authorized staff `{eventId,ticketToken}` → `{registrationId,checkedInAt}`. Invalid/unpaid/cancelled/wrong-event ticket rejected. Repeat → 409. Tokens must be unpredictable; store hashes and avoid raw-token logs.

### Dharmik: expenses/finance/payments

- POST `/expenses`: authenticated allowed requester; multipart `amountMinor,currency,purpose,receipt` → pending expense. Private file storage with type/size restrictions and generated names.
- GET `/expenses`: own records; treasurer/authorized organizer may see the permitted full set.
- GET `/expenses/:id/receipt`: same record permission; authorized download, never public static uploads.
- PATCH `/expenses/:id/decision`: treasurer `{decision: "approved" | "rejected", reason}`; no self-approval under proposed policy.
- POST `/expenses/:id/reimburse`: treasurer, idempotency key → approved-to-paid transition once with audit record.
- GET `/finance/summary`: treasurer/authorized organizer, validated optional from/to dates → `{currency,receivedMinor,paidMinor,cashBalanceMinor,outstandingDuesMinor,pendingReimbursementsMinor,totalsBySource}`. Approval does not itself reduce cash. Cash balance is not profit.
- POST `/payments/manual`: only if approved as demo mode; treasurer/authorized organizer `{purpose,referenceId,amountMinor,currency,method}` plus idempotency key. Server validates amount and links. Never let a student set paid=true. Manual recording is not online payment processing.

### Dharmik: communications/tasks

- GET `/announcements`: visibility-filtered list. POST `/announcements`: organizer `{title,body,audience}`.
- POST `/announcements/:id/send`: organizer; durable deduplication and delivery logs. Local mail capture must be labeled.
- GET `/tasks`: scoped list; POST `/tasks`: organizer `{title,assigneeId,dueAt,projectLabel}`; PATCH `/tasks/:id/status`: assignee/organizer `{status}` from allowed transitions.
- Renewal reminders run as a job with durable deduplication, using configured membership year-end and reminder lead time. No public trigger route is proposed.

## Proposed model signatures — Deep implements; service owners consume

Signatures below are a contract to agree, not files already created. Model modules belong in server/model. `db` means a pg Pool for one independent query or the service's checked-out PoolClient for every query in a transaction. Queries are parameterized. Models do not send HTTP responses or commit transactions owned by callers.

```js
// auth.model.js / member.model.js
findUserByEmail(db, normalizedEmail) // → user including passwordHash, or null; never send hash to client
createUser(db, { name, email, passwordHash }) // → safe user
getMemberProfile(db, userId, at) // → profile + evaluated membership evidence or null
listMembers(db, { page, pageSize }) // → { rows, total }
createMembership(db, { userId, planId, startsAt, expiresAt, duesAmountMinor, currency })

// event.model.js (Implemented in server/model/event.model.js)
listPublishedEvents(db, { page, pageSize }) // → { rows, total, page, pageSize } with seatsAvailable
getEventById(db, eventId) // → event object with seatsAvailable, or null
createEvent(db, { title, description, venue, startsAt, endsAt, capacity, memberPriceMinor, publicPriceMinor, currency, createdBy, status })
lockEventForBooking(client, eventId) // → event row FOR UPDATE, or null (@rule:EVENT_CAPACITY)
countAllocatedSeats(client, eventId) // → integer count of pending + confirmed registrations (@rule:EVENT_CAPACITY)
insertRegistration(client, { eventId, userId, priceMinor, currency, status, tokenHash, idempotencyKey }) // → registration row
checkInEligibleTicket(client, { eventId, tokenHash, staffId, at }) // conditional update → row or null (@rule:CHECKIN_ONCE)
listUserTickets(db, userId) // → registrations joined with event summary for user
findRegistrationById(db, registrationId) // → registration row or null
findRegistrationByIdempotencyKey(db, idempotencyKey) // → registration row or null
updateRegistrationStatus(client, { registrationId, status }) // → updated registration row or null

// order.model.js
lockVariants(client, variantIds) // deterministic order; rows FOR UPDATE
decrementStock(client, { variantId, quantity }) // conditional update → row or null
insertOrder(client, { userId, currency, totalMinor, status, idempotencyKey })
insertOrderItem(client, { orderId, variantId, quantity, unitPriceMinor })

// expense.model.js / payment.model.js / finance.model.js
insertExpense(db, { requesterId, amountMinor, currency, purpose, receiptKey })
decideExpense(client, { expenseId, actorId, decision, reason }) // legal transition only
markReimbursed(client, { expenseId, actorId, at, idempotencyKey }) // approved→paid once
recordPayment(client, { purpose, referenceId, amountMinor, currency, method, actorId, idempotencyKey })
getFinanceSummary(db, { from, to, currency })

// task.model.js / announcement.model.js
createTask(db, { title, assigneeId, dueAt, projectLabel, createdBy })
updateTaskStatus(db, { taskId, actorId, status }) // service supplies authorized actor
createAnnouncement(db, { title, body, audience, authorId })
listDueRenewals(db, { at, leadDays, limit })
claimDelivery(client, { messageKind, sourceId, recipientId, deduplicationKey })
```

Null from a conditional mutation means no eligible row changed; the service maps the reason to a safe not-found/conflict/forbidden response without leaking private data. Unique violations should map to documented domain conflicts. No model accepts arbitrary column names or raw SQL from clients.

## Transaction ownership

- Om's registration service: acquire one client → BEGIN → validate current membership/pricing evidence → lock event → check allocation → insert registration and related records → COMMIT. Every capacity-changing flow uses the same event lock policy.
- Om's order service: one client/transaction → lock variants deterministically → verify eligibility and prices → decrement/reserve stock → insert order/items and related records → commit; any failure rolls back all changes.
- Dharmik's check-in service: conditional update enforces one-time eligibility; use one client transaction if also writing an audit record.
- Dharmik's payment/reimbursement service: validate expected amount/permissions and state, mutate payment/source state and audit once within one transaction.
- All transaction services rollback on failure and release clients in finally. Never mix pool.query with client.query inside one transaction.
- Mail/network calls occur after commit, using delivery/outbox state. Do not hold row locks while calling external payment/mail services.
- Asynchronous payments need expiring seat/stock reservations, idempotent provider callbacks and release on failure. Manual demo mode must define allocation rules honestly. This foundation does not choose or implement either mode.

## Decisions to settle before business coding

Membership year-end/timezone; role multiplicity; whether one person may buy multiple tickets; when pending registrations count against capacity; refund/cancellation effects; discount percentages; payment mode; mail provider; currency and opening balance. These are not specified precisely enough by the source to silently invent.
