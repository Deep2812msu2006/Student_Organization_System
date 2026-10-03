# Membership Dues, Expense Lifecycle, and Financial Reporting Database Handoff

**Author:** Deep (Database & SQL Models)  
**Target Teammates:** Dharmik (Backend Services, APIs & Jobs), Om (Frontend Screens & Integration)  
**Branch:** `deep/dues-finance-database`  
**Prerequisite Commits:** Merged merchandise payment foundation (`5109de1` or newer)  
**Date:** October 2026

---

## 1. Overview & Architectural Boundaries

This handoff provides the database and SQL model layer for:
1. **Membership Dues Payment Confirmation & Waivers**: Extending durable payment records to membership dues obligations, strictly preserving membership periods and separating cash from waivers.
2. **Volunteer Expenses**: Complete lifecycle (`submitted` -> `approved` / `rejected` -> `reimbursed`) with actor tracking, reimbursement idempotency, and positive currency amounts.
3. **Financial Summary Reporting**: Parameterized queries for aggregate revenue across all streams (dues, events, merchandise), reimbursed expenses, committed liabilities, uncollected dues, and net recorded cash movement per currency.

### Team Ownership Reminder
- **Deep (Completed Here)**: Database schema (`009_dues_and_expenses.sql`), SQL models (`payment.model.js`, `expense.model.js`, `finance.model.js`), transaction invariants, isolation tests (`dues-finance.model.test.js`), and seed data (`005_dev_finance.js`).
- **Dharmik (Next Step)**: Express routes, Zod schemas, service transactions, staff permissions (`treasurer`, `organizer`), receipt upload storage/metadata, and error response formatting.
- **Om (Downstream)**: Dues payment UI, staff/treasurer dues confirmation, volunteer expense submission & approval screens, and treasurer financial reports dashboard.

---

## 2. Database Schema & Invariants (Migration `009_dues_and_expenses.sql`)

### 2.1 Extended `payment_records`
`payment_records` now records durable evidence for 3 distinct payment targets:
- `registration_id UUID NULL REFERENCES event_registrations(id) ON DELETE RESTRICT`
- `order_id UUID NULL REFERENCES orders(id) ON DELETE RESTRICT`
- `dues_obligation_id UUID NULL REFERENCES dues_obligations(id) ON DELETE RESTRICT`

#### Constraints:
- `@rule:PAYMENT_TARGET_MUTEX`: `CHECK (num_nonnulls(registration_id, order_id, dues_obligation_id) = 1)`. Exactly one payment target must be populated per payment record.
- `@rule:DUES_PAYMENT_ONCE`: `CREATE UNIQUE INDEX payment_records_unique_dues_obligation_idx ON payment_records (dues_obligation_id) WHERE dues_obligation_id IS NOT NULL`. Prevents duplicate payment records for the same dues obligation.

### 2.2 Volunteer `expenses` Table
```sql
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency VARCHAR(3) NOT NULL,
    purpose TEXT NOT NULL CHECK (char_length(trim(purpose)) >= 3),
    receipt_key TEXT NOT NULL,
    receipt_name TEXT NOT NULL,
    receipt_mime_type TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'submitted' 
        CHECK (status IN ('submitted', 'approved', 'rejected', 'reimbursed')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    decided_at TIMESTAMPTZ,
    rejection_reason TEXT,
    reimbursed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reimbursed_at TIMESTAMPTZ,
    reimbursement_payment_ref TEXT,
    reimbursement_idempotency_key VARCHAR(128) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT expenses_decision_check CHECK (
        (status = 'submitted' AND decided_by IS NULL AND decided_at IS NULL AND rejection_reason IS NULL) OR
        (status = 'approved' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND rejection_reason IS NULL) OR
        (status = 'rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND rejection_reason IS NOT NULL) OR
        (status = 'reimbursed' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND reimbursed_by IS NOT NULL AND reimbursed_at IS NOT NULL AND reimbursement_payment_ref IS NOT NULL)
    )
);
```

#### Workflow Rules:
- Status transitions:
  - `submitted` -> `approved` (actor: `decided_by`, timestamp: `decided_at`)
  - `submitted` -> `rejected` (actor: `decided_by`, timestamp: `decided_at`, required `rejection_reason`)
  - `approved` -> `reimbursed` (actor: `reimbursed_by`, timestamp: `reimbursed_at`, `reimbursement_payment_ref`, unique `reimbursement_idempotency_key`)
- Constraints prevent illegal transitions (e.g. `rejected` cannot become `reimbursed`; `submitted` cannot bypass approval directly to `reimbursed`).

---

## 3. SQL Models & Signatures

All model functions are exported as plain async functions taking `db` or `client` as their first parameter. **Never call `BEGIN`/`COMMIT` inside models; transaction boundaries belong to Dharmik's services.**

### 3.1 Membership Dues (`server/model/payment.model.js`)

#### `lockDuesObligationForPayment(client, duesObligationId)`
- **Behavior**: Executes `SELECT ... FROM dues_obligations do JOIN membership_periods mp ON do.membership_period_id = mp.id JOIN users u ON mp.user_id = u.id WHERE do.id = $1 FOR UPDATE`.
- **Returns**: Locked obligation object with `id`, `membershipPeriodId`, `userId`, `userEmail`, `userName`, `amountMinor`, `currency`, `status`, `paymentRef`, `periodStartsAt`, `periodExpiresAt`.
- **Throws**: `Error('Dues obligation not found')` if missing.

#### `confirmDuesPayment(client, { duesObligationId, paymentRef, paidAt })`
- **Behavior**: Atomic conditional update: `UPDATE dues_obligations SET status = 'paid', payment_ref = $2, paid_at = $3, updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING ...`.
- **Returns**: Updated obligation row, or `null` if obligation was not in `pending` status.
- **Invariants**: Does NOT alter `membership_periods.starts_at` or `expires_at`. Membership validity is determined by whether `now()` falls within the pre-established period bounds.

#### `waiveDuesObligation(client, { duesObligationId, notes, at })`
- **Behavior**: Conditional update: `UPDATE dues_obligations SET status = 'waived', payment_ref = 'waived: ' || $2, updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING ...`.
- **Returns**: Updated obligation row, or `null` if not pending.
- **Invariants**: Does NOT create a `payment_records` row. Money was not collected.

#### `findPaymentByDuesObligation(db, duesObligationId)`
- **Behavior**: Looks up durable payment record linked to `dues_obligation_id`.

#### `listPendingDuesObligations(db, { page, pageSize })`
- **Behavior**: Returns paginated list of unpaid dues obligations joined with user details for staff review.

### 3.2 Volunteer Expenses (`server/model/expense.model.js`)

#### `createExpense(db, { userId, amountMinor, currency, purpose, receiptKey, receiptName, receiptMimeType })`
- **Behavior**: Inserts new expense in `submitted` status. Returns inserted record.

#### `getExpenseById(db, expenseId)`
- **Behavior**: Retrieves full expense record with user name/email join.

#### `listExpenses(db, { status, userId, page, pageSize })`
- **Behavior**: Filterable, paginated query returning total count and records ordered by `submitted_at DESC`.

#### `lockExpenseForDecision(client, expenseId)`
- **Behavior**: `SELECT * FROM expenses WHERE id = $1 FOR UPDATE`.

#### `decideExpense(client, { expenseId, status, decidedBy, rejectionReason, decidedAt })`
- **Behavior**: Conditionally transitions expense from `submitted` to `approved` or `rejected`.
- **Returns**: Updated row or `null` if transition invalid.

#### `lockExpenseForReimbursement(client, expenseId)`
- **Behavior**: `SELECT * FROM expenses WHERE id = $1 FOR UPDATE`.

#### `reimburseExpense(client, { expenseId, reimbursedBy, reimbursementPaymentRef, reimbursementIdempotencyKey, reimbursedAt })`
- **Behavior**: Conditionally transitions expense from `approved` to `reimbursed` (`WHERE id = $1 AND status = 'approved'`).
- **Returns**: Updated row or `null` if transition invalid.

#### `findExpenseByReimbursementIdempotencyKey(db, idempotencyKey)`
- **Behavior**: Retrieves existing reimbursement for replay detection.

### 3.3 Financial Reporting (`server/model/finance.model.js`)

#### `getFinancialSummary(db, { from, to })`
- **Behavior**: Executes parameterized queries aggregating:
  - **Dues Receipts**: `SUM(pr.amount_minor)` WHERE `pr.dues_obligation_id IS NOT NULL` and `created_at` between timestamps.
  - **Event Receipts**: `SUM(pr.amount_minor)` WHERE `pr.registration_id IS NOT NULL`.
  - **Merchandise Receipts**: `SUM(pr.amount_minor)` WHERE `pr.order_id IS NOT NULL`.
  - **Reimbursed Expenses (Disbursements)**: `SUM(e.amount_minor)` WHERE `e.status = 'reimbursed'` and `reimbursed_at` between timestamps.
  - **Committed Liabilities**: `SUM(e.amount_minor)` WHERE `e.status = 'approved'` (awaiting reimbursement payout).
  - **Uncollected Dues**: Pending dues amounts count/sum vs. Waived dues count/sum.
- **Per-Currency Output**: Totals are strictly partitioned by currency (e.g. `INR`). Currencies are NEVER added together.
- **Reporting Invariant**: `netCashMovementMinor = totalReceiptsMinor - totalDisbursementsMinor`. Documented clearly as recorded transactional cash flow, not an audited bank balance.

---

## 4. Proposed API Endpoints (For Dharmik)

### 4.1 Membership Dues Management
1. `GET /api/v1/dues/pending`
   - **Auth**: `requireRole('treasurer', 'organizer')`
   - **Params**: `?page=1&pageSize=20`
   - **Response**: `{ items: [...], total, page, pageSize }`

2. `POST /api/v1/payments/dues/manual`
   - **Auth**: `requireRole('treasurer', 'organizer')`
   - **Headers**: `Idempotency-Key` (required)
   - **Body**: `{ duesObligationId, amountMinor, currency, method, externalReference?, notes? }`
   - **Transaction Pattern**:
     1. Pre-check idempotency key with `findPaymentByIdempotencyKey`. If found and matching target, return `200 OK` replay. If mismatch, `409 Conflict`.
     2. `BEGIN` transaction on client.
     3. Call `lockDuesObligationForPayment(client, duesObligationId)`.
     4. Validate `obligation.status === 'pending'`, `obligation.amountMinor === amountMinor`, `obligation.currency === currency`.
     5. Call `insertPaymentRecord(client, { duesObligationId, recordedBy: req.user.id, amountMinor, currency, method, externalReference, notes, idempotencyKey: scopedKey })`.
     6. Call `confirmDuesPayment(client, { duesObligationId, paymentRef, paidAt: new Date() })`.
     7. `COMMIT`. Return `201 Created`.

3. `POST /api/v1/dues/:id/waive`
   - **Auth**: `requireRole('treasurer', 'organizer')`
   - **Body**: `{ notes: string }`
   - **Pattern**: Inside transaction, lock obligation, check `status === 'pending'`, call `waiveDuesObligation`. No `payment_records` row is created.

### 4.2 Volunteer Expenses
1. `POST /api/v1/expenses`
   - **Auth**: `requireAuth` (any active member/volunteer)
   - **Body**: `{ amountMinor: number, currency: string, purpose: string, receiptKey: string, receiptName: string, receiptMimeType: string }`
   - **Response**: `201 Created` with expense details.

2. `GET /api/v1/expenses`
   - **Auth**: `requireAuth`. Regular members filter to `userId = req.user.id`. Treasurers/organizers can view all or filter by `?status=submitted&userId=...`.

3. `PATCH /api/v1/expenses/:id/decision`
   - **Auth**: `requireRole('treasurer', 'organizer')`
   - **Body**: `{ action: 'approve' | 'reject', rejectionReason?: string }`
   - **Transaction Pattern**: Lock expense `FOR UPDATE`, ensure `status === 'submitted'`, call `decideExpense`.

4. `POST /api/v1/expenses/:id/reimburse`
   - **Auth**: `requireRole('treasurer', 'organizer')`
   - **Headers**: `Idempotency-Key`
   - **Body**: `{ reimbursementPaymentRef: string }`
   - **Transaction Pattern**:
     1. Check `findExpenseByReimbursementIdempotencyKey`. If found for this expense, return `200 OK` replay.
     2. `BEGIN` transaction.
     3. Lock expense `lockExpenseForReimbursement`. Verify `status === 'approved'`.
     4. Call `reimburseExpense`.
     5. `COMMIT`. Return `200 OK`.

### 4.3 Financial Summary
1. `GET /api/v1/finance/summary`
   - **Auth**: `requireRole('treasurer', 'organizer')`
   - **Query**: `?from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z` (optional date bounds)
   - **Response**:
     ```json
     {
       "generatedAt": "2026-10-03T10:00:00.000Z",
       "period": { "from": null, "to": null },
       "summariesByCurrency": {
         "INR": {
           "currency": "INR",
           "revenue": {
             "duesMinor": 150000,
             "eventsMinor": 45000,
             "merchandiseMinor": 120000,
             "totalReceiptsMinor": 315000,
             "receiptCount": 12
           },
           "disbursements": {
             "reimbursedExpensesMinor": 35000,
             "reimbursedCount": 2
           },
           "netCashMovementMinor": 280000,
           "liabilities": {
             "approvedUnpaidExpensesMinor": 12000,
             "approvedCount": 1
           },
           "uncollectedDues": {
             "pendingDuesMinor": 50000,
             "pendingCount": 1,
             "waivedDuesMinor": 50000,
             "waivedCount": 1
           }
         }
       },
       "notes": "Net cash movement reflects recorded payment receipts minus recorded expense disbursements. It is not an audited bank balance."
     }
     ```

---

## 5. Error Cases & Handling Matrix

| Scenario | Layer Detected | Model / DB Reaction | Expected HTTP Code & Response |
|---|---|---|---|
| Multiple targets specified in payment record | Migration 009 constraint | SQL error `23514` (`payment_records_target_check`) | `400 Bad Request` |
| Attempt to confirm paid dues obligation again | `confirmDuesPayment` WHERE status='pending' | Returns `null` / 0 updated rows | `409 Conflict` ("Dues obligation already processed") |
| Idempotent replay of dues payment | Service / `findPaymentByIdempotencyKey` | Existing payment record returned | `200 OK` (Replay) |
| Idempotency key reused with different payload | Service | Hash/target comparison failure | `409 Conflict` ("Idempotency key collision with different parameters") |
| Expense amount <= 0 | Migration 009 constraint | SQL error `23514` (`CHECK (amount_minor > 0)`) | `400 Bad Request` |
| Rejecting expense without reason | Migration 009 constraint | SQL error `23514` (`expenses_decision_check`) | `400 Bad Request` ("Rejection reason required") |
| Reimbursing a `submitted` or `rejected` expense | `reimburseExpense` WHERE status='approved' | Returns `null` | `409 Conflict` ("Expense must be approved before reimbursement") |
| Duplicate reimbursement with same idempotency key | Migration 009 constraint / Service | SQL error `23505` on `reimbursement_idempotency_key` | `200 OK` (Replay) or `409 Conflict` |

---

## 6. Seed Data & Local Testing

- **Dev Seeds**: Run `npm run seed:dev` to populate sample dues payments, pending obligations, and volunteer expenses across all states (`submitted`, `approved`, `rejected`, `reimbursed`).
- **Automated Tests**: Run `npm run test:models` (or `npm test`) to execute the 6 integration tests in `server/tests/dues-finance.model.test.js`.
