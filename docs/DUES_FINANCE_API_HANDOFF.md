# Membership Dues, Volunteer Expenses & Financial Reporting API Handoff

**Author:** Dharmik (Backend Services, APIs & Operations)  
**Target Teammate:** Om (Frontend Screens, Modals & Integration)  
**Branch:** `dharmik/dues-finance-api`  
**Prerequisites:** Database schema migration `009_dues_and_expenses.sql` (merged in `e314d01`)  
**Date:** October 2026

---

## 1. Overview for Frontend (Om)

This handoff provides all backend endpoints, data shapes, permissions, error codes, and instructions for integrating:
1. **Membership Dues Confirmation & Waivers**: Staff treasurer interface to view unpaid obligations, record manual cash/wire/UPI payments, grant fee waivers, and observe live membership status activation (`pending` -> `active`).
2. **Volunteer Expenses**:
   - Members and volunteers can upload receipts and submit expense claims.
   - Members can track the status of their own claims (`submitted` -> `approved` / `rejected` -> `reimbursed`).
   - Staff treasurers can review, approve, reject (with required reason), and mark claims as reimbursed.
   - Dual-control security guard: users cannot review, approve, or reimburse their own expense claims (`@rule:EXPENSE_NO_SELF_APPROVAL`).
3. **Private Receipt Upload & Retrieval**: Secure private document storage outside public assets with MIME type and 5MB size validation.
4. **Financial Summary Dashboard**: Multi-currency revenue summaries, reimbursed disbursements, committed unpaid liabilities, and net recorded cash movement.

---

## 2. API Endpoints Specification

All endpoints are prefixed with `/api/v1`. All mutations (`POST`, `PATCH`, `PUT`, `DELETE`) require a valid session cookie and `X-CSRF-Token` header.

### 2.1 Membership Dues Management

#### `GET /api/v1/dues/pending` (or `/api/v1/staff/dues/pending`)
- **Permissions:** Authenticated user with `treasurer` or `organizer` role.
- **Query Parameters:** `page=1` (default 1), `pageSize=20` (default 20, max 50).
- **Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "11111111-2222-3333-4444-555555555555",
      "membershipPeriodId": "66666666-7777-8888-9999-000000000000",
      "userId": "99999999-aaaa-bbbb-cccc-dddddddddddd",
      "userName": "Rohan Sharma",
      "userEmail": "rohan@example.com",
      "amountMinor": 5000,
      "currency": "INR",
      "status": "pending",
      "createdAt": "2026-10-01T08:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

#### `POST /api/v1/payments/dues/manual`
- **Permissions:** Authenticated user with `treasurer` or `organizer` role.
- **Required Headers:** `Idempotency-Key: <16-100 characters>` (letters, digits, `_` or `-`).
- **Request Body:**
```json
{
  "duesObligationId": "11111111-2222-3333-4444-555555555555",
  "amountMinor": 5000,
  "currency": "INR",
  "method": "upi",
  "externalReference": "UPI-REF-99887766",
  "notes": "Verified against bank transaction statement"
}
```
- **Response `201 Created` (or `200 OK` on idempotent replay):**
```json
{
  "data": {
    "payment": {
      "id": "44444444-5555-6666-7777-888888888888",
      "duesObligationId": "11111111-2222-3333-4444-555555555555",
      "amountMinor": 5000,
      "currency": "INR",
      "method": "upi",
      "externalReference": "UPI-REF-99887766",
      "notes": "Verified against bank transaction statement",
      "recordedBy": "33333333-4444-5555-6666-777777777777",
      "createdAt": "2026-10-03T10:15:30.000Z"
    },
    "duesObligation": {
      "id": "11111111-2222-3333-4444-555555555555",
      "status": "paid",
      "paidAt": "2026-10-03T10:15:30.000Z",
      "paymentRef": "UPI-REF-99887766"
    },
    "memberProfile": {
      "id": "99999999-aaaa-bbbb-cccc-dddddddddddd",
      "name": "Rohan Sharma",
      "email": "rohan@example.com",
      "membershipStatus": "active",
      "duesStatus": "paid"
    }
  },
  "replayed": false
}
```

#### `POST /api/v1/dues/:id/waive`
- **Permissions:** Authenticated user with `treasurer` or `organizer` role.
- **Request Body:**
```json
{
  "notes": "Merit scholarship fee waiver approved by student executive committee"
}
```
- **Response `200 OK`:**
```json
{
  "data": {
    "duesObligation": {
      "id": "11111111-2222-3333-4444-555555555555",
      "status": "waived",
      "paymentRef": "waived: Merit scholarship fee waiver approved by student executive committee"
    },
    "memberProfile": {
      "id": "99999999-aaaa-bbbb-cccc-dddddddddddd",
      "membershipStatus": "active",
      "duesStatus": "waived"
    }
  }
}
```

---

### 2.2 Volunteer Expenses

#### `POST /api/v1/expenses/receipts`
- **Permissions:** Authenticated user.
- **Format Options:**
  - **Option A (JSON with Base64):**
    ```json
    {
      "filename": "club_banner_receipt.png",
      "contentType": "image/png",
      "dataBase64": "iVBORw0KGgoAAAANSUhEUgAAAA..."
    }
    ```
  - **Option B (Raw Binary):**
    Send raw image/pdf bytes with `Content-Type: image/png` (or `image/jpeg`, `image/webp`, `application/pdf`) and optional `X-Filename: banner.png` header.
- **Response `201 Created`:**
```json
{
  "data": {
    "receiptKey": "receipt_1762180000000_abc123def456.png",
    "size": 24580,
    "mimeType": "image/png",
    "originalFilename": "club_banner_receipt.png"
  }
}
```

#### `POST /api/v1/expenses`
- **Permissions:** Authenticated member or volunteer.
- **Request Body:**
```json
{
  "amountMinor": 1250,
  "currency": "INR",
  "purpose": "Printing event posters and handouts for freshmen orientation",
  "receiptKey": "receipt_1762180000000_abc123def456.png"
}
```
- **Response `201 Created`:**
```json
{
  "data": {
    "id": "88888888-9999-aaaa-bbbb-cccccccccccc",
    "requesterId": "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
    "amountMinor": 1250,
    "currency": "INR",
    "purpose": "Printing event posters and handouts for freshmen orientation",
    "receiptKey": "receipt_1762180000000_abc123def456.png",
    "status": "submitted",
    "submittedAt": "2026-10-03T11:00:00.000Z"
  }
}
```

#### `GET /api/v1/expenses`
- **Permissions:** Authenticated user.
  - If regular member: automatically scoped to the logged-in user's claims (`requesterId = req.user.id`).
  - If staff (`treasurer` or `organizer`): returns all expenses across the club, filterable via query params.
- **Query Parameters:**
  - `page=1`
  - `pageSize=20`
  - `status=submitted` (or `approved`, `rejected`, `reimbursed`)
  - `requesterId=<uuid>` (staff only)
- **Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "88888888-9999-aaaa-bbbb-cccccccccccc",
      "requesterId": "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
      "requesterName": "Aarav Patel",
      "requesterEmail": "aarav@example.com",
      "amountMinor": 1250,
      "currency": "INR",
      "purpose": "Printing event posters",
      "receiptKey": "receipt_1762180000000_abc123def456.png",
      "status": "submitted",
      "submittedAt": "2026-10-03T11:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1 }
}
```

#### `GET /api/v1/expenses/:id`
- **Permissions:** Submitter of the expense or staff (`treasurer`, `organizer`).
- **Response `200 OK`:** full expense details with decision and reimbursement records.

#### `GET /api/v1/expenses/:id/receipt`
- **Permissions:** Submitter of the expense or staff (`treasurer`, `organizer`). Third-party members are rejected with 403 `FORBIDDEN`.
- **Response:** Binary image/PDF file stream with appropriate `Content-Type` and `Content-Disposition: inline`.

#### `PATCH /api/v1/expenses/:id/decision` (or `POST /api/v1/expenses/:id/decision`)
- **Permissions:** Authenticated user with `treasurer` or `organizer` role.
- **Segregation of Duties (`@rule:EXPENSE_NO_SELF_APPROVAL`):** The submitter cannot approve or reject their own claim. Attempting to do so returns 403 `CANNOT_APPROVE_OWN_EXPENSE`.
- **Request Body:**
```json
{
  "decision": "approved",
  "reason": "Verified invoice and items purchased for orientation"
}
```
*(Note: `reason` is required when `decision` is `"rejected"`).*
- **Response `200 OK`:**
```json
{
  "data": {
    "id": "88888888-9999-aaaa-bbbb-cccccccccccc",
    "status": "approved",
    "decidedBy": "55555555-6666-7777-8888-999999999999",
    "decidedAt": "2026-10-03T12:00:00.000Z",
    "decisionReason": "Verified invoice and items purchased for orientation"
  }
}
```

#### `POST /api/v1/expenses/:id/reimburse`
- **Permissions:** Authenticated user with `treasurer` or `organizer` role.
- **Required Headers:** `Idempotency-Key: <16-100 characters>`.
- **Segregation of Duties (`@rule:EXPENSE_NO_SELF_APPROVAL`):** The submitter cannot record reimbursement for their own claim. Attempting to do so returns 403 `CANNOT_REIMBURSE_OWN_EXPENSE`.
- **Request Body:**
```json
{
  "reimbursementReference": "IMPS-UTR-20261003-9999"
}
```
- **Response `200 OK`:**
```json
{
  "data": {
    "id": "88888888-9999-aaaa-bbbb-cccccccccccc",
    "status": "reimbursed",
    "reimbursedBy": "55555555-6666-7777-8888-999999999999",
    "reimbursedAt": "2026-10-03T13:00:00.000Z",
    "reimbursementReference": "IMPS-UTR-20261003-9999"
  },
  "replayed": false
}
```

---

### 2.3 Financial Summary Reporting

#### `GET /api/v1/finance/summary`
- **Permissions:** Authenticated user with `treasurer` or `organizer` role.
- **Query Parameters:**
  - `from=2026-01-01T00:00:00Z` (optional ISO timestamp)
  - `to=2026-12-31T23:59:59Z` (optional ISO timestamp)
- **Response `200 OK`:**
```json
{
  "data": {
    "period": { "from": null, "to": null },
    "currencies": [
      {
        "currency": "INR",
        "receipts": {
          "duesMinor": 150000,
          "duesCount": 30,
          "eventsMinor": 45000,
          "eventsCount": 18,
          "merchandiseMinor": 120000,
          "merchandiseCount": 24,
          "totalMinor": 315000,
          "totalCount": 72
        },
        "disbursements": {
          "reimbursedMinor": 35000,
          "reimbursedCount": 5
        },
        "netCashMovementMinor": 280000,
        "committedLiabilities": {
          "approvedUnpaidMinor": 12000,
          "approvedUnpaidCount": 2
        },
        "uncollected": {
          "pendingDuesMinor": 50000,
          "pendingDuesCount": 10,
          "waivedDuesMinor": 25000,
          "waivedDuesCount": 5
        }
      }
    ],
    "notice": "Net cash movement represents recorded payment receipts minus reimbursed expenses in this database. It is not an audited bank balance and excludes external fees, cash floats, or unrecorded adjustments."
  }
}
```

---

## 3. Error Code Taxonomy

| HTTP Status | Error Code | Meaning / Remediation |
|---|---|---|
| `400` | `INVALID_IDEMPOTENCY_KEY` | Header missing or format not 16–100 characters. |
| `400` | `AMOUNT_MISMATCH` | Payment amount does not match recorded obligation amount. |
| `400` | `CURRENCY_MISMATCH` | Currency does not match obligation currency. |
| `400` | `INVALID_FILE_TYPE` | Receipt uploaded is not an allowed MIME type (JPEG/PNG/WebP/PDF). |
| `400` | `EMPTY_FILE` | Uploaded receipt buffer is empty. |
| `403` | `FORBIDDEN` | Missing required role (e.g., ordinary member attempting staff actions). |
| `403` | `CANNOT_APPROVE_OWN_EXPENSE` | Segregation of duties: Submitter cannot approve or reject their own claim. |
| `403` | `CANNOT_REIMBURSE_OWN_EXPENSE` | Segregation of duties: Submitter cannot record reimbursement for own claim. |
| `404` | `DUES_OBLIGATION_NOT_FOUND` | Dues obligation UUID not found in database. |
| `404` | `EXPENSE_NOT_FOUND` | Expense claim UUID not found. |
| `404` | `RECEIPT_NOT_FOUND` | Stored receipt file does not exist on disk. |
| `409` | `ALREADY_PAID` | Dues obligation is already marked paid. |
| `409` | `DUES_WAIVED` | Dues obligation was waived and cannot receive cash payment. |
| `409` | `INVALID_STATUS` | Entity state changed concurrently and is no longer eligible. |
| `409` | `INVALID_EXPENSE_STATUS` | Expense is not in `submitted` status for approval/rejection. |
| `409` | `EXPENSE_NOT_APPROVED` | Expense must be `approved` before it can be reimbursed. |
| `409` | `ALREADY_REIMBURSED` | Expense is already marked `reimbursed`. |
| `409` | `IDEMPOTENCY_CONFLICT` | Idempotency key reused for a different entity or payment target. |
| `409` | `IDEMPOTENCY_PAYLOAD_MISMATCH`| Idempotency key reused with altered parameters (amount/method). |
| `413` | `FILE_TOO_LARGE` | Receipt exceeds the 5MB upload limit. |

---

## 4. UI Recommendations for Om

1. **Staff Dues Screen (`/staff/dues` or tab in `/staff/payments`):**
   - Reuse the existing modal pattern from `PaymentPage.jsx`.
   - Display pending member details, period dates, amount, and currency.
   - Provide an explicit "Waive Dues" button with a required notes input for scholarships.
2. **Volunteer Expenses Portal (`/expenses`):**
   - Members see "My Submitted Expenses" table with current status badge (`submitted` [yellow], `approved` [blue], `rejected` [red], `reimbursed` [green]).
   - File input accepting `.jpg, .png, .webp, .pdf` with immediate client-side preview for images.
   - Staff see "Review Pending Claims" tab with "Approve" and "Reject" buttons.
   - Disable approval/reimbursement buttons with tooltip *"You cannot approve your own claim"* if `expense.requesterId === currentUser.id`.
3. **Treasury Reports Dashboard (`/staff/finance`):**
   - Render cards for **Recorded Receipts**, **Reimbursed Expenses**, **Net Cash Movement**, and **Committed Liabilities**.
   - Always display the currency tag prominently (e.g. `₹ 2,80,000 INR`).
   - Include the honest disclaimer note under the totals.
