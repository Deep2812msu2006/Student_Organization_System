# Step 5 — Ticket Check-In and Manual Payment Confirmation

Branch: `dharmik/payments-checkin`, based on main `eb5bcb6` (Om's events merged).  
Uses migration 006. No push, merge or deployment is performed by this step.

## Working screens

- `/staff/checkin`: organizer-only ticket check-in with manual admission-code entry, event selection, real-time success/denial feedback, and database-backed attendance totals.
- `/staff/payments`: organizer-only manual payment recording for pending registrations, with zero-price confirmation path, payment method/reference/notes, and idempotency protection.

Both screens are accessible from the staff section of the navigation bar when logged in as an organizer.

## Database dependencies

### Migration 006: `payment_records` table

This migration adds a single table `payment_records` for durable payment evidence. It does **not** modify any existing tables. The schema is additive.

**Deep must review and approve this migration before it is applied to any shared environment.**

```sql
CREATE TABLE payment_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id     UUID NOT NULL REFERENCES registrations(id),
  amount_minor        INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency            TEXT NOT NULL CHECK (char_length(currency) = 3),
  method              TEXT NOT NULL CHECK (char_length(method) BETWEEN 1 AND 50),
  external_reference  TEXT,
  notes               TEXT NOT NULL DEFAULT '',
  recorded_by         UUID NOT NULL REFERENCES users(id),
  idempotency_key     TEXT UNIQUE NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Existing tables used (read/conditional update)

- `registrations`: Uses existing columns `status`, `checked_in_at`, `checked_in_by`, `token_hash`, `event_id`. The `checkInEligibleTicket` model function from Deep's event.model.js is reused for atomic check-in.
- `events`: Uses existing `lockEventForBooking` for payment confirmation transaction.
- `users`: Referenced for `recorded_by` and user name/email in pending registration listing.

### No existing migrations modified

Migration 006 is purely additive. All existing constraints, indexes, and data remain intact.

## API contract (implemented)

All paths below are relative to `/api/v1`. Require authentication + organizer role + CSRF token.

### Check-in

- **POST `/checkins`**: `{eventId, ticketToken}` → 200 `{data: {registrationId, eventId, status, checkedInAt, checkedInBy}}`.
  - 404 if event not found/not published.
  - 409 `CHECKIN_DENIED` if ticket is invalid, already used, not confirmed, or wrong event.
  - Token is hashed with SHA-256 and matched against `registrations.token_hash`.
  - Atomic conditional UPDATE ensures exactly one admission per ticket.

- **GET `/events/:eventId/attendance`**: → `{data: {eventId, eventTitle, capacity, totalRegistrations, confirmed, pending, cancelled, checkedIn}}`.
  - Database-backed counts from the `registrations` table.

### Manual payment confirmation

- **POST `/payments/manual`**: `{registrationId, amountMinor, currency, method, externalReference?, notes?}` + `Idempotency-Key` header → 201 `{data: {payment, registration}, replayed: false}` or 200 for replay.
  - Rejects cancelled registrations with 409 `REGISTRATION_CANCELLED`.
  - Rejects amount/currency mismatch with 400.
  - Zero-price registrations: amountMinor must be 0, method is set to `zero_price`.
  - Idempotent: replays return existing result with `replayed: true`.
  - Atomic: payment evidence record + registration confirmation in one transaction.

- **GET `/events/:eventId/pending-registrations`**: → `{data: [{id, eventId, userId, userName, userEmail, priceMinor, currency, status, createdAt}]}`.
  - Lists only `status = 'pending'` registrations for the treasurer view.

## Limitations and remaining work

1. **QR scanning**: Manual admission-code entry is implemented as primary and fallback. QR code display on the ticket page and camera-based scanning on the check-in page are deferred.
2. **Legacy ticket reissue**: Seeded confirmed tickets with `reissue_required` status still cannot be checked in because their raw tokens are unknown. A code reissue admin workflow is needed.
3. **Hold expiry**: Pending registrations do not expire automatically. A background job or cron to release expired pending reservations is not implemented.
4. **Cancellation workflow**: No cancel-registration endpoint exists yet. Cancelled registrations cannot be restored.
5. **Financial reporting**: The `GET /finance/summary` endpoint is not implemented. Payment records exist for audit but aggregation queries are deferred.
6. **Expense management**: Not implemented in this step.
7. **Email notifications**: No email is sent on payment confirmation or check-in.

## Run

From repository root, with existing ignored .env files:

```powershell
npm ci
# Ensure server/.env has DATABASE_URL, SESSION_SECRET, and TICKET_SECRET
npm run migrate          # Applies migration 006 if not already applied
npm run seed:dev         # Optional: refresh development data
npm run dev              # Starts API (5000) and Vite dev (5173) concurrently
```

Browser: http://127.0.0.1:5173/staff/checkin (logged in as organizer).  
Synthetic organizer login: `dev-organizer@example.local` / `Dev$Org1!`

## Verification

- Frontend production build passed (49 modules, 0 errors).
- Schema validations tested: check-in schema, payment schema, idempotency key format.
- Token hashing consistency verified.
- Concurrent check-in atomicity tested with parallel `checkInEligibleTicket` calls.
- Idempotency key uniqueness verified.
- Attendance totals verified against database.
- Existing test files remain unmodified.
- Navigation links activate without breaking existing routes.
- Staff CSS uses shared design tokens and responsive breakpoints.

## Files changed

### New files
- `database/migrations/006_payment_records.sql` — Payment evidence table (Deep review required)
- `server/model/payment.model.js` — Payment/attendance SQL models
- `server/services/checkin.service.js` — Check-in workflow service
- `server/services/payment.service.js` — Manual payment confirmation service
- `server/validators/checkin.schema.js` — Zod schemas for check-in/payment
- `server/routes/checkin.routes.js` — API routes for check-in/payment
- `server/tests/checkin-payment.api.test.js` — Integration tests
- `client/src/pages/staff/CheckInPage.jsx` — Staff check-in screen
- `client/src/pages/staff/PaymentPage.jsx` — Treasurer payment recording screen
- `client/src/styles/staff.css` — Staff screen styles
- `docs/CHECKIN_PAYMENT_HANDOFF.md` — This handoff document

### Modified files
- `server/app.js` — Added `checkinRouter` import and mount
- `client/src/App.jsx` — Added check-in/payment routes and staff CSS import
- `client/src/config/navigation.js` — Activated Check-in and Payments nav links
- `docs/API_CONTRACT.md` — Updated with implemented check-in/payment endpoints
- `docs/QUICK_CHANGE_GUIDE.md` — Added check-in and payment tags
- `docs/CODE_WALKTHROUGH.md` — Updated with new files
