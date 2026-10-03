# Merchandise UI and API Handoff

Prepared by **Om** on branch `om/merchandise`.

---

## 1. Implemented Screens

### `/shop` — Official Club Merchandise Store
- **Tag:** `@edit:MERCHANDISE_LAYOUT`, `@edit:PRODUCT_CARD`
- **Features:**
  - Real-time catalog populated from PostgreSQL (`GET /api/v1/products`).
  - Category filter pills (`All Items`, `Apparel`, `Accessories`, `Collectibles`).
  - Product cards displaying category, title, description preview, price range or single price (in `INR`), and stock badge (`In Stock` / `Sold Out`).
  - Responsive grid layout adapting seamlessly from desktop to mobile screens.
  - Direct quick link to `/cart` with item count badge.

### `/shop/:id` — Product Detail & Variant Selection
- **Features:**
  - Product details fetched from `GET /api/v1/products/:id`.
  - Variant / size selection (buttons for `Small`, `Medium`, `Large`, `XL`, `500ml`, `750ml`, etc.).
  - Real-time stock availability display for the selected variant (e.g. `15 in stock` or `Out of Stock`).
  - Price updates dynamically to match selected variant.
  - Quantity selection with strict bounds (`1` to available stock).
  - Out-of-stock handling with disabled button and clear feedback.
  - Add to cart with feedback notification and quick access to cart.

### `/cart` — Order Review & Checkout
- **Tag:** `@edit:CART_UI`
- **Features:**
  - Client-side cart managed with `CartContext` and persisted in `localStorage`.
  - Itemized table with product name, variant/size option, unit price, quantity steppers, item subtotal, and remove action.
  - Empty cart state with direct link back to shop.
  - Order summary displaying total item count and estimated total in minor currency units (`paise`/`cents`).
  - Clear customer guidance: *"Submitted orders are created in Pending (Awaiting Payment) status. Payment confirmation is recorded by association staff."*
  - Authenticated checkout:
    - Automatically redirects unauthenticated guests to `/login?redirect=/cart`.
    - Generates and preserves `Idempotency-Key` across retries; updates key only when cart items change.
    - Sends `POST /api/v1/orders` with `Idempotency-Key` header and CSRF token.
    - Gracefully handles 409 `INSUFFICIENT_STOCK` errors, displaying which item had conflict and advising the user to adjust quantities.
    - On success: clears local cart and navigates to the order details page.

### `/orders` — Customer Order History
- **Tag:** `@edit:ORDER_STATUS`
- **Features:**
  - Protected route for authenticated users (`GET /api/v1/orders/me`).
  - Lists past orders placed by the user with order timestamp, item summaries, total amount, and visual status badges.
  - Empty state with link to club store if no orders exist yet.

### `/orders/:id` — Order Details & Receipt
- **Tag:** `@edit:ORDER_STATUS`
- **Features:**
  - Displays full order receipt with snapshotted product names, variant names, unit prices, quantities, and line totals.
  - Visual status badge and contextual explanation:
    - **`pending`**: *"Awaiting Payment — Your order has been placed and inventory is reserved. Please complete payment with association staff."*
    - **`paid`**: *"Paid — Payment has been confirmed by staff. Your merchandise order is being prepared."*
    - **`cancelled`**: *"Cancelled — Order was cancelled; items returned to club inventory."*
    - **`fulfilled`**: *"Fulfilled — Order completed and delivered/collected."*
  - Customer cancellation:
    - Available for orders in `pending` or `paid` status.
    - Prompts for optional reason and calls `POST /api/v1/orders/:id/cancel`.
    - Atomically updates status to `cancelled` and restores variant stock to inventory exactly once (`@rule:STOCK_RESTORE_ON_CANCEL`).

---

## 2. API Routes Implemented (`server/routes/merchandise.routes.js`)

All routes mounted under `/api/v1` in `server/app.js`:

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/products` | Public | Paginated catalog list with optional `?category=` filter |
| `GET` | `/products/:id` | Public | Product detail with active variants and stock levels |
| `POST` | `/orders` | Yes (CSRF + Idempotency-Key) | Authenticated order placement with atomic stock deduction |
| `GET` | `/orders/me` | Yes | Paginated order history for current user |
| `GET` | `/orders/:id` | Yes | Order detail view restricted to owner |
| `POST` | `/orders/:id/cancel` | Yes (CSRF) | Order cancellation restoring stock to inventory |

---

## 3. Business Invariants Enforced

- **`@rule:VARIANT_LOCK_ORDER`**: Multi-item checkout transactions sort variant IDs and lock rows in deterministic UUID ASC order (`ORDER BY id ASC FOR UPDATE`) to prevent deadlocks under high concurrency.
- **`@rule:STOCK_DEDUCT_ON_ORDER`**: Variant stock is verified and decremented inside the order transaction. If any item is out of stock, the transaction rolls back completely (no partial deductions or overselling).
- **`@rule:ORDER_IDEMPOTENCY`**: The `Idempotency-Key` header is checked. Identical payloads return the existing order (200 OK replay); altered payloads for the same key are rejected with 409 Conflict.
- **`@rule:STOCK_RESTORE_ON_CANCEL`**: Cancellation conditionally transitions status `WHERE status IN ('pending', 'paid')` and restores variant stock for each item inside the same transaction. Repeated calls affect 0 rows and cannot double-restore stock.
- **Server-Derived Pricing**: Client-supplied prices, totals, currencies, or statuses are strictly rejected by `server/validators/merchandise.schema.js`. All totals are calculated from trusted database snapshots.

---

## 4. Payment Integration and Dependencies on Dharmik

### Current State
- Submitted merchandise orders are placed in **`pending`** status awaiting payment confirmation.
- The UI and API honestly reflect this state as **"Awaiting Payment"**.
- Orders are **never** marked paid simply because submission succeeded.

### Task for Dharmik
- In Dharmik's payment module (`payment_records` table and `/payments/manual` endpoint):
  - Currently `payment_records.registration_id` references event registrations only.
  - To support merchandise payment confirmation, Dharmik/Deep should add an `order_id UUID REFERENCES orders(id)` column (or make registration_id nullable).
  - Dharmik's payment confirmation endpoint can then call Deep's existing `updateOrderStatus(client, { orderId, status: 'paid', paidAt })` inside a transaction while writing durable payment evidence.

---

## 5. Hackathon Demo Flow

1. **Browse Catalog**:
   - Open `/shop`. Filter by `Apparel` or `Accessories`.
   - Notice live product prices and in-stock badges.
2. **Select Variants & Quantity**:
   - Click **Official Skyline Club Hoodie**.
   - Select size `Medium` (price: ₹1,200, 25 in stock).
   - Increase quantity to 2. Click **Add to Cart**.
3. **Review Cart**:
   - Navigate to `/cart`.
   - Verify items, quantities, subtotal, and the honest payment note: *"Submitted orders are created in Pending (Awaiting Payment) status."*
4. **Place Order**:
   - Click **Place Order**.
   - Receive instant redirection to `/orders/:id` with the **"Order placed successfully!"** confirmation banner and order status **PENDING**.
5. **Inspect Inventory Snapshot**:
   - Check the itemized table showing snapshotted prices and sizes.
6. **Cancel & Restore Stock**:
   - Click **Cancel this Order**, enter reason *"Testing restock"*, and confirm.
   - Status transitions to **CANCELLED** and stock is restored immediately to club inventory.
