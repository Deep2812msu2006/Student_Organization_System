# Integrated demo
Use synthetic development accounts only (see database/seeds/001_dev_users.js).
Use two separate browser profiles so staff and member sessions do not replace each other.

1. Register a new account, select a membership and observe pending dues.
2. Organizer/treasurer opens /staff/dues and records money received.
   Member refreshes /membership and sees active benefits.
3. Organizer creates a published future event. Member reserves a ticket, staff records
   its payment on /staff/payments, member refreshes /tickets to get the admission code.
4. Organizer opens /staff/checkin, selects the event and enters the code.
   Repeat entry is denied and attendance updates.
5. Member chooses merchandise size and quantity, checks out and opens the persisted
   order. Active membership discount is applied server-side to the final price.
6. Staff records merchandise payment; organizer marks collection on /staff/inventory.
   Pending orders can be cancelled and stock restored; paid orders cannot.
7. Member opts in on /mail. Organizer writes and publishes an announcement.
   Show the news history and /staff/mail local preview.
8. Organizer assigns a task on /tasks. Assigned member updates its progress.
9. Member uploads a private receipt on /expenses. Another authorized staff account
   approves and records reimbursement. The claimant cannot approve their own claim.
10. Open /finance: recorded receipts, reimbursements and net movement by currency.
11. On /staff/mail run renewal reminders twice; per-period/window duplicates are
    prevented. Only eligible expiry dates with subscribed users create reminders.

A pending claim with missing legacy receipt files must have its receipt re-uploaded
by its owner. Known synthetic fixture receipts are supplied by seed 006.
Do not label previewed emails as delivered, or net recorded movement as a bank balance.

## Presentation rehearsal: 4 October 2026

Latest main integrated through 612445c, including event/product photos and Razorpay.
Razorpay remains available. Checkout loads on demand so an unavailable external
script does not block the local homepage. Gateway verification now checks the
provider's order owner, purchase ID, amount, currency and captured payment status,
in addition to the signature. Unit tests use a synthetic provider; no real charge
was initiated during this rehearsal. Provider reference:
https://razorpay.com/docs/api/payments/fetch-with-id/

Announcement publication through the edit form now queues the mailing list in the
same transaction as the edit. Event attendance now includes recorded ticket revenue;
pending reservations do not count as income.

Presentation order: membership → event/ticket/check-in → shop/order → announcement
and volunteer task → expense receipt/reimbursement → financial summary.
Keep a member and organizer in separate browser profiles. Use Cash on checkout for
the offline walkthrough, or your configured Razorpay test account for the gateway.
Never enter real card or bank details for a rehearsal.

Local app: http://127.0.0.1:5173/ . API health: http://127.0.0.1:5000/api/health .
Start with npm run dev from the repository root. Keep that terminal running.
The existing local PostgreSQL instance must also stay running.

Mailing-list opt-in, outbox previews and renewal selection work locally. External
email delivery and automatic scheduling are not implemented: demonstrate them as
queued previews, not sent messages. Razorpay requires network access; the remaining
local workflows do not require an external provider. Git shares migrations, not
local database records or receipt files.
