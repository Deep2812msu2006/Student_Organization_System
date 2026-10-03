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

### Om: merchandise (implemented)

- GET `/products`: public published products and variants `{data:[{id,name,description,category,variants:[{id,name,sku,priceMinor,currency,stockQuantity,inStock}]}]}` with optional `category` filter and pagination.
- GET `/products/:id`: public product detail with variants and real-time inventory counts.
- POST `/orders`: authenticated customer `{items:[{variantId,quantity}]}` with `Idempotency-Key` header and CSRF token → 201 `{data:{id,status:'pending',totalMinor,currency,items:[{variantId,productName,variantName,unitPriceMinor,quantity,totalMinor}]}}` or 200 replay on identical request. Rejects client-supplied prices, totals or status. Deterministically locks variants (UUID ASC) and decrements stock atomically inside one transaction (@rule:VARIANT_LOCK_ORDER, @rule:STOCK_DEDUCT_ON_ORDER).
- GET `/orders/me`: authenticated customer paginated order history with item summaries.
- GET `/orders/:id`: authenticated customer order detail restricted to the owner (404/403 for non-owners).
- POST `/orders/:id/cancel`: authenticated customer order cancellation `{reason?}`; verifies ownership, transitions status to `cancelled` and restores variant stock exactly once inside the transaction (@rule:STOCK_RESTORE_ON_CANCEL). Only `pending` orders may be cancelled (@rule:PENDING_ONLY_CANCEL); paid orders cannot be cancelled through this customer prototype.

### Dharmik: check-in (implemented)

- POST `/checkins`: organizer-role staff `{eventId,ticketToken}` → 200 `{data:{registrationId,eventId,status,checkedInAt,checkedInBy}}`. Requires CSRF. Token is SHA-256 hashed and matched against `registrations.token_hash`. Atomic conditional UPDATE ensures one-time admission. Invalid/unconfirmed/cancelled/wrong-event/already-used → 409 `CHECKIN_DENIED`. Staff identity and check-in time are recorded.
- GET `/events/:eventId/attendance`: organizer-role → `{data:{eventId,eventTitle,capacity,totalRegistrations,confirmed,pending,cancelled,checkedIn}}`. Database-backed counts.
- GET `/events/:eventId/pending-registrations`: staff (`treasurer` and `organizer` roles) → `{data:[{id,eventId,userId,userName,userEmail,priceMinor,currency,status,createdAt}]}`. Lists pending-only registrations.

### Dharmik: manual payment confirmation (implemented)

- POST `/payments/manual`: staff (`treasurer` and `organizer` roles) `{registrationId,amountMinor,currency,method,externalReference?,notes?}` + `Idempotency-Key` header (16–100 chars) → 201 `{data:{payment,registration},replayed:false}` or 200 for replay. Validates amount/currency against registration snapshot. Rejects cancelled registrations (409 `REGISTRATION_CANCELLED`). Zero-price path: amountMinor must be 0, method set to `zero_price`. Inserts durable `payment_records` evidence and confirms registration pending→confirmed in one transaction. Idempotent: duplicate keys return existing result. Does not simulate a payment gateway or collect card details.

### Dharmik: merchandise manual payment confirmation (implemented)

- GET `/orders/pending` and GET `/staff/orders/pending`: staff (`treasurer` and `organizer` roles; regular members and volunteers denied 403) → 200 `{data:[{id,userId,userName,userEmail,status,totalMinor,currency,createdAt,items:[{id,productName,variantName,unitPriceMinor,quantity,totalMinor}]}],pagination:{page,pageSize,total}}`. Static route prevents route conflicts with customer `/orders/:id`. Never exposes internal idempotency keys in response payloads.
- POST `/payments/merchandise/manual`: staff (`treasurer` and `organizer` roles) `{orderId,amountMinor,currency,method,externalReference?,notes?}` + `Idempotency-Key` header (16–100 chars) + CSRF token → 201 `{data:{payment,order},replayed:false}` or 200 for replay.
  - Permissions: Explicitly supports `treasurer` role; `organizer` role is also authorized. Ordinary members and volunteers receive 403 `FORBIDDEN`.
  - Scoped Idempotency: Key is scoped to authenticated staff user ID (`SHA-256(staffId:key)`). Identical retries return original result with `replayed: true`. Reusing key for different order returns 409 `IDEMPOTENCY_CONFLICT`. Modifying payload with same key returns 409 `IDEMPOTENCY_PAYLOAD_MISMATCH`. Simultaneous concurrent requests with same key resolve cleanly without duplicate payment or error.
  - Transaction handling: Acquires order row lock (`lockOrderForPayment` with `FOR UPDATE`), re-checks status/amount/currency inside the transaction, inserts `payment_records` row with `order_id`, and transitions order from `pending` to `paid` (`confirmOrderPayment`) atomically.
  - Rejection: Rejects cancelled orders (409 `ORDER_CANCELLED`), fulfilled orders (409 `ORDER_FULFILLED`), and already-paid orders (409 `ALREADY_PAID`).
  - Zero-price orders: Handled honestly with `amountMinor: 0` and method `zero_price`.
  - Stock invariant: Inventory was allocated and deducted at checkout; stock is NOT deducted again during payment confirmation.
  - Sanitization: Internal idempotency keys and hashes are stripped from API response.

### Dharmik: expenses/finance (planned — not yet implemented)

- POST `/expenses`: authenticated allowed requester; multipart `amountMinor,currency,purpose,receipt` → pending expense. Private file storage with type/size restrictions and generated names.
- GET `/expenses`: own records; treasurer/authorized organizer may see the permitted full set.
- GET `/expenses/:id/receipt`: same record permission; authorized download, never public static uploads.
- PATCH `/expenses/:id/decision`: treasurer `{decision: "approved" | "rejected", reason}`; no self-approval under proposed policy.
- POST `/expenses/:id/reimburse`: treasurer, idempotency key → approved-to-paid transition once with audit record.
- GET `/finance/summary`: treasurer/authorized organizer, validated optional from/to dates → aggregated financial summary.

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

// merchandise.model.js / order.model.js (Implemented in server/model/merchandise.model.js)
listPublishedProducts(db, { page, pageSize, category }) // → { rows, total, page, pageSize }
getProductById(db, productId) // → product with variants or null
createProduct(db, { name, description, category, isPublished, createdBy })
createProductVariant(db, { productId, name, sku, priceMinor, currency, stockQuantity, isActive })
lockVariantsForOrder(client, variantIds) // deterministic order (UUID ASC); rows FOR UPDATE (@rule:VARIANT_LOCK_ORDER)
decrementVariantStock(client, { variantId, quantity }) // conditional update → row or null (@rule:STOCK_DEDUCT_ON_ORDER)
incrementVariantStock(client, { variantId, quantity }) // → row or null
insertOrder(client, { userId, currency, totalMinor, status, idempotencyKey, payloadHash })
insertOrderItem(client, { orderId, variantId, productNameSnapshot, variantNameSnapshot, unitPriceMinor, quantity, totalMinor })
findOrderById(db, orderId) // → order or null
findOrderByIdempotencyKey(db, idempotencyKey) // → order or null (@rule:ORDER_IDEMPOTENCY)
getOrderDetails(db, orderId, userId) // → order with items snapshot
cancelOrder(client, { orderId, actorId, reason, at }) // conditional update + stock restore (@rule:STOCK_RESTORE_ON_CANCEL)
updateOrderStatus(client, { orderId, status, paidAt, fulfilledAt })
listUserOrders(db, userId, { page, pageSize }) // → paginated orders with items

// payment.model.js (Implemented in server/model/payment.model.js — Supports Event Tickets, Merchandise Orders, and Membership Dues)
insertPaymentRecord(client, { registrationId, orderId, duesObligationId, amountMinor, currency, method, externalReference, notes, recordedBy, idempotencyKey }) // → payment record (@rule:PAYMENT_TARGET_MUTEX, @rule:PAYMENT_EVIDENCE)
findPaymentByIdempotencyKey(db, idempotencyKey) // → payment record or null
findPaymentsByRegistration(db, registrationId) // → array of payment records for event registration
findPaymentByOrder(db, orderId) // → payment record for merchandise order or null
findPaymentByDuesObligation(db, duesObligationId) // → payment record for membership dues obligation or null
lockOrderForPayment(client, orderId) // locks order row FOR UPDATE (@rule:ORDER_LOCK_ORDER)
confirmOrderPayment(client, { orderId, paidAt }) // conditional update pending → paid (@rule:PAYMENT_ONCE)
confirmRegistration(client, registrationId) // conditional update pending → confirmed (@rule:PAYMENT_ONCE)
lockDuesObligationForPayment(client, duesObligationId) // locks dues obligation row FOR UPDATE (@rule:DUES_PAYMENT_ONCE)
confirmDuesPayment(client, { duesObligationId, paymentRef, paidAt }) // conditional update pending → paid (@rule:DUES_PAYMENT_ONCE)
waiveDuesObligation(client, { duesObligationId, notes, at }) // conditional update pending → waived (no payment record)
listPendingRegistrations(db, eventId) // → pending registrations for event
listPendingOrders(db, { page, pageSize }) // → paginated pending merchandise orders with items for treasurer
listPendingDuesObligations(db, { page, pageSize }) // → paginated pending dues obligations with user/plan details
getAttendanceTotals(db, eventId) // → database-backed attendance summary

// expense.model.js (Implemented in server/model/expense.model.js)
createExpense(db, { requesterId, amountMinor, currency, purpose, receiptKey }) // → created expense row in 'submitted' status
getExpenseById(db, expenseId, requesterId) // → expense record with requester and decider details or null
listExpenses(db, { page, pageSize, status, requesterId }) // → { rows, total, page, pageSize }
lockExpenseForDecision(client, expenseId) // locks expense row FOR UPDATE
decideExpense(client, { expenseId, actorId, decision, reason, at }) // conditional update submitted → approved | rejected (@rule:EXPENSE_TRANSITIONS)
lockExpenseForReimbursement(client, expenseId) // locks approved expense row FOR UPDATE
reimburseExpense(client, { expenseId, actorId, reimbursementReference, idempotencyKey, at }) // conditional update approved → reimbursed (@rule:REIMBURSEMENT_ONCE)
findExpenseByReimbursementIdempotencyKey(db, idempotencyKey) // → expense record or null for replay detection

// finance.model.js (Implemented in server/model/finance.model.js)
getFinancialSummary(db, { from, to }) // → comprehensive breakdown per currency: dues, events, merchandise receipts, reimbursed expenses, net cash movement, committed liabilities, and uncollected dues

// task.model.js / announcement.model.js (Planned)
createTask(db, { title, assigneeId, dueAt, projectLabel, createdBy })
updateTaskStatus(db, { taskId, actorId, status }) // service supplies authorized actor
createAnnouncement(db, { title, body, audience, authorId })
listDueRenewals(db, { at, leadDays, limit })
claimDelivery(client, { messageKind, sourceId, recipientId, deduplicationKey })
```

Null from a conditional mutation means no eligible row changed; the service maps the reason to a safe not-found/conflict/forbidden response without leaking private data. Unique violations should map to documented domain conflicts. No model accepts arbitrary column names or raw SQL from clients.

## Transaction ownership and lock ordering

- **Om's registration service**: acquire one client → BEGIN → validate current membership/pricing evidence → lock event → check allocation → insert registration and related records → COMMIT. Every capacity-changing flow uses the same event lock policy.
- **Om's order service**: one client/transaction → lock variants deterministically (`ORDER BY id ASC FOR UPDATE`) → verify eligibility and prices → decrement/reserve stock → insert order/items and related records → COMMIT; any failure rolls back all changes.
- **Dharmik's check-in service**: conditional update enforces one-time eligibility; use one client transaction if also writing an audit record.
- **Dharmik's payment confirmation services (Event, Merchandise & Dues)**:
  - Acquire one client → `BEGIN`.
  - Check idempotency: if key exists, verify matching payload or reject conflict.
  - **Lock ordering (@rule:ORDER_LOCK_ORDER, @rule:DUES_LOCK_ORDER)**: Lock target entity first (`lockOrderForPayment`, `lockEventForBooking`, or `lockDuesObligationForPayment`).
  - Validate exact amount and currency match the snapshot/obligation.
  - Write durable payment evidence into `payment_records` referencing exactly ONE of `registration_id`, `order_id`, or `dues_obligation_id` (@rule:PAYMENT_TARGET_MUTEX).
  - Conditionally update target status (`confirmOrderPayment` pending → paid, `confirmRegistration` pending → confirmed, or `confirmDuesPayment` pending → paid).
  - If target was not in pending status (e.g. cancelled concurrently), ROLLBACK and return 409 conflict.
  - `COMMIT` and return payment audit + updated details.
- **Dharmik's expense services**:
  - Decision: lock expense row (`lockExpenseForDecision`) → verify `status === 'submitted'` → `decideExpense` (submitted $\rightarrow$ approved/rejected) → `COMMIT`. Prevent self-approval at service layer (@rule:EXPENSE_NO_SELF_APPROVAL).
  - Reimbursement: acquire client → `BEGIN` → check `reimbursement_idempotency_key` replay → lock expense (`lockExpenseForReimbursement`) → verify `status === 'approved'` → `reimburseExpense` (approved $\rightarrow$ reimbursed) → `COMMIT`.
- **Cancellation lock ordering**: `cancelOrder` acquires `SELECT id, status FROM orders WHERE id = $1 FOR UPDATE` as its first step. Because payment confirmation and cancellation lock the exact same order row first, concurrent payment vs cancellation requests serialize cleanly with zero deadlocks.
- **Paid-order cancellation restriction (@rule:PENDING_ONLY_CANCEL)**: Customer cancellation is allowed only while `pending`. Paid order cancellation is rejected at the model level until an audited refund/credit note workflow is designed.
- **Financial Reporting & Ledger Principles**:
  - Only durable `payment_records` count as actual cash receipts.
  - Reimbursed expenses count as cash disbursements.
  - Net cash movement is `totalReceiptsMinor - reimbursedExpensesMinor` calculated strictly per currency.
  - Approved-but-unpaid expenses are tracked separately as committed liabilities.
  - Uncollected dues are broken down into pending vs waived obligations.
- All transaction services rollback on failure and release clients in finally. Never mix pool.query with client.query inside one transaction.
- Mail/network calls occur after commit, using delivery/outbox state. Do not hold row locks while calling external payment/mail services.

## Decisions to settle before business coding

Membership year-end/timezone; role multiplicity; whether one person may buy multiple tickets; when pending registrations count against capacity; refund/cancellation effects; discount percentages; payment mode; mail provider; currency and opening balance. These are not specified precisely enough by the source to silently invent.
