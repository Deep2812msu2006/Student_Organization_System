# Quick change guide

## Events and tickets (implemented)

- `@edit:EVENT_LIST` and `@edit:EVENT_CARD`: client/src/pages/events/EventsPage.jsx. Verify public and organizer lists, pagination and empty state.
- `@edit:EVENT_FORM`: client/src/pages/events/EventForm.jsx. Validate dates/capacity/minor-unit prices; update server/validators/event.schema.js if changing permitted input.
- `@edit:TICKET_LAYOUT`: client/src/pages/events/TicketsPage.jsx. Check pending has no admission code, confirmed eligibility and narrow screens.
- `@flow:EVENT_REGISTRATION`: server/services/event.service.js. Test price snapshots, duplicate keys and simultaneous last-seat requests.
- `@rule:EVENT_MEMBER_PRICE`: same service. Paid/current membership selects event member price without a second discount.
- Deep's existing `@rule:EVENT_CAPACITY`: server/model/event.model.js. Keep all allocation mutations under the event row lock.
- Layout: client/src/styles/events.css. Ticket token format: server/utils/ticketToken.js. Never expose keys/hash values while editing presentation.

## Authentication and membership additions

- `@edit:MEMBERSHIP_FORM`: client/src/pages/auth/AuthPage.jsx. Server rules: server/validators/auth.schema.js. Check form errors, signup and login.
- `@edit:MEMBERSHIP_PROFILE`: client/src/pages/members/MembershipPage.jsx. Check enrollment, reload persistence and benefit status.
- `@edit:MEMBER_DIRECTORY`: client/src/pages/members/MemberDirectory.jsx. API role enforcement: server/routes/member.routes.js. Check organizer access and member denial.
- `@edit:ACCOUNT_LAYOUT`: client/src/styles/account.css. Check mobile forms, profile card and directory.
- `@flow:MEMBER_SIGNUP`: server/services/auth.service.js. User and member role share a transaction; no password hash in HTTP responses.
- `@rule:ENROLLMENT_ONCE` and `@rule:MEMBER_DISCOUNT`: server/services/member.service.js. Check simultaneous enrollments and disabled pending/expired benefits.

My membership and organizer Members links are active. Remaining business navigation is planned. The older planned-feature list below is superseded for authentication/membership by this section.

Use Ctrl+Shift+F in your editor to search the exact tag. Paths below are relative to the repository root and exist now. Search tags have one authoritative implementation location; documentation repeats them for lookup. Change only the relevant source and verify the smallest affected flow.

## Navbar background/text/hover colors

- Tag: `@edit:NAVBAR_COLORS`
- File: client/src/styles/tokens.css
- Variables: --navbar-bg, --navbar-text, --navbar-hover-bg, --navbar-border.
- Consumed by client/src/components/Navbar.css.
- Verify: desktop and mobile menu, readable text, hover and keyboard focus. Brand SVG colors do not inherit navbar variables.

## Navbar links/order/labels

- Tag: `@edit:NAVBAR_LINKS`
- File: client/src/config/navigation.js
- Component: client/src/components/Navbar.jsx
- Verify: each public link reaches an existing section, mobile closes after selection and Escape restores menu-button focus. member/staff arrays are planned and not rendered as authenticated navigation. Do not enable links before routes/permissions exist.

## App name, logo and homepage copy

- Tag: `@edit:BRAND_NAME`
- File: client/src/config/site.js
- Logo: client/public/logo.svg. Tab title, description and favicon: client/index.html.
- Verify: navbar, hero, footer, browser title and narrow-screen wrapping. Modify the SVG only when the logo itself changes.

## Global palette and spacing

- Tag: `@edit:GLOBAL_COLORS`
- File: client/src/styles/tokens.css
- Layout selectors: client/src/styles/global.css
- Verify: text/status contrast, cards, small screens and no horizontal overflow. Navbar has separate variables by design.

## Buttons

- Tag: `@edit:BUTTON_STYLES`
- Colors: client/src/styles/tokens.css
- Shape/layout: .button and .button-secondary in client/src/styles/global.css.
- Verify: primary and secondary buttons, focus, hover and disabled “Checking…” state.

## Database health / error display

- Tag: `@flow:DATABASE_HEALTH`
- Query: server/controllers/health.controller.js, createHealthController.
- UI: client/src/components/ConnectionStatus.jsx.
- Request: client/src/services/healthApi.js, getHealth.
- Retry/cancellation: client/src/hooks/useHealth.js, useHealth.
- Verify: configured/live DB → green connected status; missing/stopped DB → honest attention state; retry recovers. Never replace this with a hardcoded success.

## Server host/port/database destination

- Examples: server/.env.example and client/.env.example.
- Parser: server/config/env.js, readConfig; pool: server/config/db.js, createDatabase.
- Vite proxy: client/vite.config.js. If API port changes, update API_PROXY_TARGET in client/.env and restart Vite.
- Verify GET /api/live and /api/health through both API and frontend proxy. Never paste credentials in a screenshot or commit .env.

## Email uniqueness rule

- Tag: `@rule:EMAIL_UNIQUENESS`
- DB enforcement: `database/migrations/002_users_and_roles.sql`, index `users_email_normalized_idx` on `lower(email)`.
- Model: `server/model/auth.model.js`, `findUserByEmail` (normalize before call) and `createUser`.
- Verify: inserting the same email in any case variant raises SQLSTATE 23505. Test: `server/tests/auth.model.test.js`.

## Membership validity evaluation

- Tag: `@rule:MEMBERSHIP_VALIDITY`
- SQL: `server/model/member.model.js`, `getMemberProfile` CASE expression.
- Rule: ACTIVE requires period exists AND starts_at <= now AND expires_at > now AND dues status = 'paid'.
- Verify: four representative seeds (`database/seeds/002_dev_memberships.js`) and eight model tests in `server/tests/member.model.test.js`.

## Member persistence flow

- Tag: `@flow:MEMBER_PERSISTENCE`
- Models: `server/model/auth.model.js` → `createUser`, `assignRole`; `server/model/member.model.js` → `createMembership`.
- Om's service: BEGIN → createUser → assignRole('member') → createMembership → COMMIT.
- `createMembership` inserts both `membership_periods` and `dues_obligations` (pending) atomically.
- Verify: rollback test in `server/tests/member.model.test.js`.

## Event capacity allocation rule

- Tag: `@rule:EVENT_CAPACITY`
- DB schema: `database/migrations/005_events_and_registrations.sql`, index `registrations_event_status_idx`.
- Model: `server/model/event.model.js` (`lockEventForBooking` with `FOR UPDATE`, `countAllocatedSeats`).
- Policy: Pending and confirmed registrations both consume capacity. Cancelled registrations release capacity.
- Concurrency protection: Service acquires a transaction client, locks the event row (`FOR UPDATE`), checks `countAllocatedSeats(client, eventId) < event.capacity`, and inserts registration.
- Verify: Concurrency race test in `server/tests/event.model.test.js`.

## Atomic one-time ticket check-in rule

- Tag: `@rule:CHECKIN_ONCE`
- DB schema: `database/migrations/005_events_and_registrations.sql`, unique index on `token_hash`, check constraint `(checked_in_at IS NULL OR status = 'confirmed')`.
- Model: `server/model/event.model.js`, `checkInEligibleTicket`.
- Enforcement: Single conditional atomic UPDATE checking `event_id`, `token_hash`, `status = 'confirmed'`, and `checked_in_at IS NULL`. Returns updated row on first success, `null` on repeat or invalid attempts.
- Verify: Idempotency & duplicate check-in tests in `server/tests/event.model.test.js`.

## Add a new migration

- Tag: `@edit:ADD_MIGRATION`
- Create `database/migrations/NNN_description.sql` with the next sequence number.
- Run: `npm run migrate` from the repository root.
- Never edit an applied migration; add a new file.
- Verify: `npm run migrate:status` before and after.

## Change membership plan dues amount

- Tag: `@edit:MEMBERSHIP_PLAN`
- Provisional demo value: `database/migrations/003_membership.sql`, INSERT into `membership_plans`.
- IMPORTANT: Confirm official dues with the organization before changing. Add a new migration to ALTER the plan; do not re-run 003.

## Ticket check-in (implemented)

- `@edit:CHECKIN_UI`: client/src/pages/staff/CheckInPage.jsx. Staff check-in screen with manual admission-code entry, event selection, success/denial feedback and attendance totals.
- `@flow:CHECKIN`: server/services/checkin.service.js. Hash token → atomic conditional update → return result or denial.
- `@rule:CHECKIN_ONCE`: server/model/event.model.js, `checkInEligibleTicket`. Concurrent scans: only one succeeds.
- `@rule:STAFF_PERMISSION`: server/routes/checkin.routes.js. All routes require `requireRole('organizer')`.
- Staff styles: client/src/styles/staff.css. Check responsive layout on mobile devices.

## Manual payment confirmation (implemented)

- `@edit:PAYMENT_UI`: client/src/pages/staff/PaymentPage.jsx. Treasurer screen for recording out-of-band payments. Clearly labeled as manual recording, not a payment gateway.
- `@flow:PAYMENT_CONFIRMATION`: server/services/payment.service.js. Validate → idempotency check → atomic transaction (payment evidence + registration confirmation).
- `@rule:PAYMENT_ONCE`: server/model/payment.model.js + server/services/payment.service.js. Idempotency key prevents duplicates. Cancelled registrations rejected.
- `@rule:PAYMENT_EVIDENCE`: server/model/payment.model.js. Durable `payment_records` table stores all manual payment evidence.
- Schema: database/migrations/006_payment_records.sql. Additive migration, no existing tables modified.
- Validation: server/validators/checkin.schema.js. Zod schemas for check-in and payment requests.

## Merchandise and Club Store (implemented)

- `@edit:MERCHANDISE_LAYOUT`: `client/src/styles/shop.css` and `client/src/pages/shop/ShopPage.jsx`. Catalog filter pills, product grid, responsive 2-column detail layout, and cart summary card.
- `@edit:PRODUCT_CARD`: `client/src/pages/shop/ShopPage.jsx`. Product card representation, category badge, dynamic price range, and in-stock/sold-out indicator.
- `@edit:CART_UI`: `client/src/pages/shop/CartPage.jsx`. Local cart management, quantity steppers, item removal, estimated subtotal, and stock-conflict error feedback.
- `@edit:ORDER_STATUS`: `client/src/pages/shop/OrdersPage.jsx` and `client/src/pages/shop/OrderDetailPage.jsx`. Distinct visual badges and explanations for `pending` (awaiting payment), `paid`, `cancelled` and `fulfilled`.
- `@flow:ORDER_SUBMISSION`: `server/services/merchandise.service.js`. Atomic checkout transaction locking variants deterministically, checking stock, deducting inventory, and snapshotting item names/prices.
- Router: `server/routes/merchandise.routes.js`. Public catalog (`GET /products`, `GET /products/:id`), authenticated ordering (`POST /orders` with `Idempotency-Key` and CSRF), user orders (`GET /orders/me`, `GET /orders/:id`), and cancellation (`POST /orders/:id/cancel`).
- Validation: `server/validators/merchandise.schema.js`. Rejects client-supplied prices, totals, currencies, and unauthorized statuses.

## Merchandise stock and ordering rules

- Tag: `@rule:VARIANT_LOCK_ORDER`
- Model: `server/model/merchandise.model.js`, `lockVariantsForOrder`.
- Service: `server/services/merchandise.service.js`, `submitOrder`.
- Invariant: Multi-item checkouts sort variant IDs and lock rows with `ORDER BY id ASC FOR UPDATE` to avoid PostgreSQL deadlocks under concurrency.

- Tag: `@rule:STOCK_DEDUCT_ON_ORDER`
- Schema: `database/migrations/007_merchandise_and_orders.sql`, `CHECK (stock_quantity >= 0)`.
- Model: `server/model/merchandise.model.js`, `decrementVariantStock`.
- Invariant: Stock is decremented inside the order creation transaction. If any item is out of stock, the entire transaction rolls back cleanly.

- Tag: `@rule:ORDER_IDEMPOTENCY`
- Schema: `database/migrations/007_merchandise_and_orders.sql`, UNIQUE constraint on `orders.idempotency_key`.
- Model: `server/model/merchandise.model.js`, `insertOrder`, `findOrderByIdempotencyKey`.
- Service: `server/services/merchandise.service.js`, `submitOrder`.
- Invariant: Orders with matching idempotency key and matching payload return the existing order (200 OK replay). Replays with changed payloads are rejected with 409 Conflict.

- Tag: `@rule:STOCK_RESTORE_ON_CANCEL`
- Model: `server/model/merchandise.model.js`, `cancelOrder`.
- Service: `server/services/merchandise.service.js`, `cancelCustomerOrder`.
- Invariant: Order cancellation conditionally transitions status `WHERE status = 'pending'` and restores variant stock for each item inside the transaction. Subsequent cancellation calls affect 0 rows and cannot double-restore stock.

- Tag: `@rule:PENDING_ONLY_CANCEL`
- Model: `server/model/merchandise.model.js`, `cancelOrder`.
- UI: `client/src/pages/shop/OrderDetailPage.jsx`.
- Invariant: Cancellation is restricted exclusively to `pending` orders. Paid orders cannot be cancelled through this customer prototype.

## Merchandise manual payment confirmation (implemented)

- `@edit:MERCHANDISE_PAYMENT_UI`: `client/src/pages/staff/PaymentPage.jsx`. Staff payment screen featuring a dedicated "Merchandise Orders" tab, clearly labeled operation "Record manual payment received", items summary breakdown table, preserved idempotency key across uncertain retries, responsive design, keyboard accessibility, and loading/conflict/success states.
- `@flow:MERCHANDISE_PAYMENT`: `server/services/payment.service.js`. Scopes key to recorder ID (`scopedKey(staffId, key)`), pre-checks order status, acquires order row lock (`lockOrderForPayment` with `FOR UPDATE`), inserts durable payment record linking `order_id`, and transitions order from `pending` to `paid` (`confirmOrderPayment`) atomically inside a transaction.
- `@flow:MERCHANDISE_PAYMENT_LIST`: `server/routes/checkin.routes.js`, `server/services/payment.service.js`. Paginated list of pending orders for staff (`GET /orders/pending` and `GET /staff/orders/pending`). Internal idempotency keys are stripped from response payloads.
- `@rule:ORDER_LOCK_ORDER`: `server/model/payment.model.js`, `server/model/merchandise.model.js`. Payment confirmation and cancellation acquire order row lock (`FOR UPDATE`) with deterministic ordering to avoid PostgreSQL deadlocks.
- `@rule:PAYMENT_TARGET_MUTEX`: `database/migrations/008_merchandise_payments.sql`. Check constraint `payment_records_target_check` ensures each payment record links to EITHER a `registration_id` OR an `order_id`, never both and never neither.
- Validation: `server/validators/checkin.schema.js`, `merchandisePaymentSchema` and `pendingOrderQuerySchema`.
- Permissions: Explicitly supports `treasurer` role; `organizer` is also authorized. Ordinary members and volunteers are strictly denied (403 `FORBIDDEN`).

## Membership Dues and Waiver rules (implemented database layer)

- Tag: `@rule:DUES_PAYMENT_ONCE`
- Schema: `database/migrations/009_dues_and_expenses.sql`, unique partial index `payment_records_unique_dues_obligation_idx`.
- Model: `server/model/payment.model.js`, `confirmDuesPayment`, `lockDuesObligationForPayment`.
- Invariant: Dues payments link durable payment evidence to `dues_obligation_id`. Atomic update conditionally checks `WHERE status = 'pending'`. Membership period dates are preserved and never altered. Waivers (`waiveDuesObligation`) mark obligation `waived` without creating payment records.

## Volunteer Expense Lifecycle rules (implemented database layer)

- Tag: `@rule:EXPENSE_LIFECYCLE`
- Schema: `database/migrations/009_dues_and_expenses.sql`, `expenses` table with check constraint `expenses_decision_check`.
- Model: `server/model/expense.model.js`, `createExpense`, `decideExpense`, `reimburseExpense`.
- Invariant: Minimal state machine `submitted` -> `approved`/`rejected` -> `reimbursed`. Rejections mandate a reason. Reimbursements require approval, reimbursement actor, timestamp, payment reference, and unique `reimbursement_idempotency_key`.

## Financial Summary Reporting (implemented database layer)

- Tag: `@flow:FINANCIAL_SUMMARY`
- Model: `server/model/finance.model.js`, `getFinancialSummary`.
- Invariant: Parameterized aggregation of durable payment records (dues, event tickets, merchandise orders) and reimbursed expenses. Currencies are strictly separated and never mixed. Distinguishes approved unpaid expenses (liabilities) and uncollected dues (pending vs. waived). Net cash movement (`totalReceipts - reimbursedExpenses`) is documented as transactional flow, not an audited bank balance.

## Planned features — not yet implemented

Frontend screens and API endpoints for dues collection, expense submission/approval, and treasurer reporting are assigned to Dharmik (APIs) and Om (UI). Use docs/DUES_FINANCE_DATABASE_HANDOFF.md to coordinate implementation.

