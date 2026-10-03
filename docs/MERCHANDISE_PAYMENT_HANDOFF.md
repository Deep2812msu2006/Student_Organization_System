# Step 7 — Merchandise Payment Database Foundation & Handoff

**Author:** Deep (Database schema, migrations, seed data, SQL models, transaction correctness, isolated database tests)  
**Consumer:** Dharmik (Payment confirmation service, API endpoints, staff treasurer UI)  
**Branch:** `deep/merchandise-payments`  
**Migration:** `008_merchandise_payments.sql`  

---

## 1. Overview of Delivered Foundation

Deep has delivered the database layer and transaction-safe models for durable merchandise order payment confirmation, extending the audit trail in `payment_records` while preserving full backwards compatibility with event ticket registration payments.

### Key Capabilities Provided:
1. **Durable Payment Evidence for Orders:** `payment_records` now accepts an `order_id` foreign key referencing `orders(id) ON DELETE RESTRICT`.
2. **Mutual Exclusion Constraint:** Exactly one target entity (`registration_id` XOR `order_id`) is allowed per payment record (`@rule:PAYMENT_TARGET_MUTEX`).
3. **One-Time Confirmation Invariant:** `UNIQUE INDEX payment_records_unique_order_idx ON payment_records(order_id)` and atomic conditional update `status = 'pending' -> 'paid'` ensure an order cannot be confirmed multiple times (`@rule:PAYMENT_ONCE`).
4. **Consistent Lock Ordering:** `lockOrderForPayment` and `cancelOrder` both lock the `orders` row via `SELECT ... FOR UPDATE` first (`@rule:ORDER_LOCK_ORDER`), eliminating race conditions and deadlocks.
5. **Paid-Order Cancellation Guard:** Orders can only be cancelled while in `pending` status (`@rule:PENDING_ONLY_CANCEL`). Paid order cancellation is rejected at the model and service layer until an audited refund workflow is designed.
6. **Treasurer Pending Orders Query:** `listPendingOrders(db, { page, pageSize })` provides paginated pending orders joined with customer contact info and snapshotted items for the staff treasurer interface.

---

## 2. Database Schema (Migration 008)

Migration file: `database/migrations/008_merchandise_payments.sql`

```sql
-- 1. Allow registration_id to be NULL so order payments can omit it
ALTER TABLE payment_records
  ALTER COLUMN registration_id DROP NOT NULL;

-- 2. Add order_id referencing orders(id) with RESTRICT on delete
ALTER TABLE payment_records
  ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE RESTRICT;

-- 3. Enforce exactly one target per payment record (either registration or order)
ALTER TABLE payment_records
  ADD CONSTRAINT payment_records_target_check
  CHECK (
    (registration_id IS NOT NULL AND order_id IS NULL) OR
    (registration_id IS NULL AND order_id IS NOT NULL)
  );

-- 4. Index for order payment lookups
CREATE INDEX payment_records_order_idx
  ON payment_records (order_id)
  WHERE order_id IS NOT NULL;

-- 5. Enforce uniqueness: at most one payment record per order
CREATE UNIQUE INDEX payment_records_unique_order_idx
  ON payment_records (order_id)
  WHERE order_id IS NOT NULL;
```

---

## 3. Ready SQL Models

Available in `server/model/payment.model.js` and `server/model/merchandise.model.js`:

### `insertPaymentRecord(client, params)`
```js
await insertPaymentRecord(client, {
  registrationId?: string|null,
  orderId?: string|null,
  amountMinor: number,
  currency: string,
  method: string,               // 'cash' | 'bank_transfer' | 'upi' | 'card' | 'zero_price'
  externalReference?: string|null, // UTR, transaction ID, or receipt number
  notes?: string,
  recordedBy: string,           // Treasurer user UUID
  idempotencyKey: string
});
```
*Returns created payment record with `id`, `registrationId`, `orderId`, `amountMinor`, `currency`, `method`, `externalReference`, `notes`, `recordedBy`, `idempotencyKey`, `createdAt`.*

### `lockOrderForPayment(client, orderId)`
```js
const lockedOrder = await lockOrderForPayment(client, orderId);
// Returns: { id, userId, status, totalMinor, currency, paidAt, cancelledAt, fulfilledAt } or null
```
*Locks order row with `SELECT ... FOR UPDATE` inside caller's transaction.*

### `confirmOrderPayment(client, { orderId, paidAt })`
```js
const updatedOrder = await confirmOrderPayment(client, { orderId, paidAt: new Date().toISOString() });
// Returns: { id, userId, status: 'paid', totalMinor, currency, paidAt, updatedAt } or null
```
*Conditional update: transitions `pending` -> `paid`. Returns `null` if the order was not pending.*

### `findPaymentByOrder(db, orderId)`
```js
const payment = await findPaymentByOrder(db, orderId);
// Returns payment record or null
```

### `findPaymentByIdempotencyKey(db, idempotencyKey)`
```js
const payment = await findPaymentByIdempotencyKey(db, idempotencyKey);
// Returns payment record or null
```

### `listPendingOrders(db, { page, pageSize })`
```js
const { rows, total, page, pageSize } = await listPendingOrders(db, { page: 1, pageSize: 20 });
// rows: [{ id, userId, userName, userEmail, status: 'pending', totalMinor, currency, idempotencyKey, createdAt, items: [...] }]
```

---

## 4. Integration Guide for Dharmik

Dharmik should implement the service layer (`confirmMerchandisePayment`) and routes for staff confirmation:

### Step 1: Implement Service Workflow in `server/services/payment.service.js`

```js
import * as paymentModel from '../model/payment.model.js';
import * as merchModel from '../model/merchandise.model.js';
import { transaction } from '../utils/transaction.js';
import { HttpError } from '../utils/httpError.js';

export async function confirmMerchandisePayment(pool, params, treasurerId) {
  const { orderId, amountMinor, currency, method, externalReference = null, notes = '', idempotencyKey } = params;

  // 1. Initial order check
  const order = await merchModel.findOrderById(pool, orderId);
  if (!order) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  }
  if (order.status === 'cancelled') {
    throw new HttpError(409, 'ORDER_CANCELLED', 'This order was cancelled and cannot receive payment.');
  }
  if (order.status === 'fulfilled') {
    throw new HttpError(409, 'ORDER_FULFILLED', 'This order has already been fulfilled.');
  }

  // 2. Replay check by idempotency key
  const existingPayment = await paymentModel.findPaymentByIdempotencyKey(pool, idempotencyKey);
  if (existingPayment) {
    if (existingPayment.orderId !== orderId) {
      throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used for a different order.');
    }
    if (existingPayment.amountMinor !== amountMinor || existingPayment.currency !== currency) {
      throw new HttpError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'Payment parameters do not match initial request.');
    }
    const fullOrder = await merchModel.getOrderDetails(pool, orderId);
    return { payment: existingPayment, order: fullOrder, replayed: true };
  }

  if (order.status === 'paid') {
    throw new HttpError(409, 'ALREADY_PAID', 'This order has already been paid.');
  }

  // 3. Amount and currency validation
  if (amountMinor !== order.totalMinor) {
    throw new HttpError(400, 'AMOUNT_MISMATCH', `Payment amount (${amountMinor}) does not match order total (${order.totalMinor}).`);
  }
  if (currency !== order.currency) {
    throw new HttpError(400, 'CURRENCY_MISMATCH', `Currency (${currency}) does not match order currency (${order.currency}).`);
  }

  // 4. Atomic transaction
  const result = await transaction(pool, async client => {
    // 4a. Lock order row first (@rule:ORDER_LOCK_ORDER)
    const locked = await paymentModel.lockOrderForPayment(client, orderId);
    if (!locked || locked.status !== 'pending') {
      throw new HttpError(409, 'ORDER_NOT_PENDING', 'Order is no longer awaiting payment.');
    }

    // 4b. Write durable payment record
    const payment = await paymentModel.insertPaymentRecord(client, {
      orderId,
      amountMinor,
      currency,
      method,
      externalReference,
      notes,
      recordedBy: treasurerId,
      idempotencyKey,
    });

    // 4c. Update status pending -> paid
    const confirmed = await paymentModel.confirmOrderPayment(client, { orderId });
    if (!confirmed) {
      throw new HttpError(409, 'ALREADY_PAID', 'Order was confirmed by another process.');
    }

    const fullOrder = await merchModel.getOrderDetails(client, orderId);
    return { payment, order: fullOrder };
  });

  return { ...result, replayed: false };
}
```

### Step 2: Route Endpoints in `server/routes/checkin.routes.js` (or `payment.routes.js`)

- **POST `/api/v1/payments/merchandise/manual`**
  - Requires: `requireUser(pool)`, `requireRole('organizer')`, `requireCsrf`, `validate(merchandisePaymentSchema)`.
  - Headers: `Idempotency-Key: <16-100 chars>`.
  - Body: `{ orderId, amountMinor, currency, method, externalReference?, notes? }`.
  - Response: 201 `{ data: { payment, order }, replayed: false }` or 200 on replay.

- **GET `/api/v1/orders/pending`**
  - Requires: `requireUser(pool)`, `requireRole('organizer')`.
  - Query: `page=1&pageSize=20`.
  - Response: 200 `{ data: rows, pagination: { page, pageSize, total } }`.

---

## 5. Error Code Taxonomy

| HTTP Status | Error Code | Description |
|:---|:---|:---|
| 400 | `INVALID_ID` | Malformed UUID parameter |
| 400 | `INVALID_IDEMPOTENCY_KEY` | Header missing or format invalid |
| 400 | `AMOUNT_MISMATCH` | Payment minor units do not match order total |
| 400 | `CURRENCY_MISMATCH` | Currency code does not match order currency |
| 404 | `ORDER_NOT_FOUND` | Order ID does not exist |
| 409 | `ORDER_CANCELLED` | Order was cancelled; cannot be confirmed |
| 409 | `ORDER_FULFILLED` | Order was already fulfilled |
| 409 | `ALREADY_PAID` | Order was already paid |
| 409 | `ORDER_NOT_PENDING` | Order state changed concurrently |
| 409 | `IDEMPOTENCY_CONFLICT` | Idempotency key reused for a different order |
| 409 | `IDEMPOTENCY_PAYLOAD_MISMATCH` | Idempotency key reused with modified amount/currency |

---

## 6. Membership Dues Status & Remaining Gap

- **Current State:** Membership periods and dues obligations are stored in `membership_periods` and `dues_obligations`. Dues obligations record status (`pending`/`paid`/`waived`) and a textual `payment_ref`.
- **Remaining Gap:** `payment_records` currently supports `registration_id` (event tickets) and `order_id` (merchandise orders). It does not yet have a foreign key to `dues_obligations`.
- **Future Milestone:** When membership dues manual recording is implemented, an additive migration can add `dues_obligation_id UUID REFERENCES dues_obligations(id)` to `payment_records` and update `payment_records_target_check` accordingly.

---

## 7. Migration & Verification Commands

```powershell
# Apply migration 008 to development database
npm run migrate

# Check migration status
npm run migrate:status

# Run model test suite (including all 9 merchandise payment tests)
$env:NODE_TEST_DATABASE_URL="postgresql://club_user:<password>@127.0.0.1:5432/student_org_test"
npm run test:models

# Run full project test suite
npm test
```

### Verification Results:
- `npm run test:models`: **39 / 39 model tests passing** (Auth, Member, Events, Merchandise Catalog/Orders, Merchandise Payments).
- `npm test`: **62 / 62 total tests passing** across the whole project.
