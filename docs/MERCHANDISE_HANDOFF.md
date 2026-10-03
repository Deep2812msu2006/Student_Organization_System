# Merchandise and Orders Database Handoff

Prepared on branch `deep/merchandise-database`.

---

## 1. Database Schema (`007_merchandise_and_orders.sql`)

### Tables
- **`products`**: `id` (UUID PK), `name` (1–200 chars), `description`, `category` (default `'apparel'`), `is_published` (boolean), `created_by` (FK `users.id`), `created_at`, `updated_at`.
- **`product_variants`**: `id` (UUID PK), `product_id` (FK `products.id` CASCADE), `name` (1–100 chars, e.g. `'Small'`, `'500ml'`), `sku`, `price_minor` (integer >= 0), `currency` (CHAR(3)), `stock_quantity` (INTEGER >= 0, `CHECK (stock_quantity >= 0)`), `is_active` (boolean), `created_at`, `updated_at`. Unique constraint on `(product_id, name)`.
- **`orders`**: `id` (UUID PK), `user_id` (FK `users.id` CASCADE), `status` (`'pending'|'paid'|'cancelled'|'fulfilled'`), `total_minor` (integer >= 0), `currency` (CHAR(3)), `idempotency_key` (UNIQUE), `idempotency_payload_hash` (TEXT), `cancelled_at`, `cancelled_by`, `cancellation_reason`, `paid_at`, `fulfilled_at`, `created_at`, `updated_at`.
- **`order_items`**: `id` (UUID PK), `order_id` (FK `orders.id` CASCADE), `variant_id` (FK `product_variants.id` SET NULL), `product_name_snapshot`, `variant_name_snapshot`, `unit_price_minor_snapshot` (integer >= 0), `quantity` (`CHECK (quantity > 0)`), `total_minor` (integer >= 0), `created_at`.

---

## 2. Invariant Rules

### `@rule:VARIANT_LOCK_ORDER`
When acquiring row locks for multiple variants in an order checkout transaction, variants **must** be sorted and locked in deterministic UUID ascending order:
```javascript
const sortedIds = [...variantIds].sort();
const lockedVariants = await lockVariantsForOrder(client, sortedIds);
```
This prevents PostgreSQL deadlocks when concurrent users purchase different items in overlapping orders.

### `@rule:STOCK_DEDUCT_ON_ORDER`
Stock is deducted inside the atomic order transaction:
1. Lock variants deterministically (`lockVariantsForOrder`).
2. Verify `variant.stockQuantity >= item.quantity` and `variant.isActive = true`.
3. If any item is out of stock, rollback transaction completely (no partial deductions).
4. Call `decrementVariantStock(client, { variantId, quantity })`.
5. Call `insertOrder` and `insertOrderItem` for each item.
6. Commit transaction.

### `@rule:ORDER_IDEMPOTENCY`
1. When receiving an order request with `Idempotency-Key`:
2. Compute `payloadHash = sha256(canonicalPayload)`.
3. Check `findOrderByIdempotencyKey(db, idempotencyKey)`:
   - If found and `idempotencyPayloadHash === payloadHash`: return existing order (200 OK replay).
   - If found and `idempotencyPayloadHash !== payloadHash`: reject with `409 Conflict` (`IDEMPOTENCY_PAYLOAD_MISMATCH`).
4. If not found, proceed with transactional order creation.

### `@rule:STOCK_RESTORE_ON_CANCEL`
When cancelling an order (`cancelOrder(client, { orderId, actorId, reason })`):
1. Atomically update `orders SET status = 'cancelled'` WHERE `status IN ('pending', 'paid')`.
2. If row was already cancelled or fulfilled, returns `null` and restores no stock.
3. If successful, queries all `order_items` and increments `product_variants.stock_quantity`.
4. Guarantees stock is restored **at most once**.

---

## 3. Model Functions in `server/model/merchandise.model.js`

All queries are parameterized and accept `db` (`pg.Pool` or `pg.PoolClient`):

```javascript
// Catalog queries
listPublishedProducts(db, { page, pageSize, category }) // → { rows, total, page, pageSize }
getProductById(db, productId) // → product object with variants: [...]
createProduct(db, { name, description, category, isPublished, createdBy })
createProductVariant(db, { productId, name, sku, priceMinor, currency, stockQuantity, isActive })

// Transaction-aware checkout & inventory
lockVariantsForOrder(client, variantIds) // → locked variant rows ordered by ID ASC
decrementVariantStock(client, { variantId, quantity }) // → updated row or null
incrementVariantStock(client, { variantId, quantity }) // → updated row or null
insertOrder(client, { userId, currency, totalMinor, status, idempotencyKey, payloadHash })
insertOrderItem(client, { orderId, variantId, productNameSnapshot, variantNameSnapshot, unitPriceMinor, quantity, totalMinor })

// Order lifecycle & queries
findOrderById(db, orderId) // → order row or null
findOrderByIdempotencyKey(db, idempotencyKey) // → order row or null
getOrderDetails(db, orderId, userId) // → order with items: [...]
cancelOrder(client, { orderId, actorId, reason, at }) // → cancelled order or null (@rule:STOCK_RESTORE_ON_CANCEL)
updateOrderStatus(client, { orderId, status, paidAt, fulfilledAt })
listUserOrders(db, userId, { page, pageSize }) // → paginated user orders
```

---

## 4. What Om Can Implement Next

1. **Merchandise Routes & Controllers (`server/routes/merchandise.routes.js`)**:
   - `GET /api/v1/products`: Public catalog listing with category filter and pagination.
   - `GET /api/v1/products/:id`: Product detail view.
   - `POST /api/v1/orders`: Authenticated checkout with `Idempotency-Key` header and CSRF.
   - `GET /api/v1/orders/me`: Customer order history.
   - `POST /api/v1/orders/:id/cancel`: Customer cancellation (if pending/paid).
2. **Frontend Pages (`client/src/pages/shop/`)**:
   - Shop catalog browsing, variant/size selection, and order history screens.

---

## 5. Remaining Dependencies on Dharmik

- **Payment Settlement**: Dharmik's payment flow (`POST /payments/manual` or future payment flow) can transition orders from `pending` → `paid` using `updateOrderStatus(client, { orderId, status: 'paid', paidAt })` and linking payment audit evidence. Orders remain `pending` until payment confirmation.
