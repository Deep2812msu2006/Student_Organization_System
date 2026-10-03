/**
 * Seed 005 — synthetic development finance and expense records.
 *
 * @rule:ACTUAL_PAYMENTS_ONLY
 * @rule:EXPENSE_TRANSITIONS
 *
 * Creates realistic financial test states:
 *   1. Dues payment evidence for active member's dues obligation.
 *   2. Sample volunteer expenses across all lifecycle states:
 *      - submitted (pending treasurer review)
 *      - approved (approved liability awaiting payout)
 *      - rejected (declined with audit reason)
 *      - reimbursed (fully disbursed with idempotency key and reference)
 *
 * This is local development seed data; none of these represent real transactions.
 */

const MEMBER_USER_ID    = '10000000-0000-0000-0000-000000000001';
const ORGANIZER_USER_ID = '10000000-0000-0000-0000-000000000002';
const TREASURER_USER_ID = '10000000-0000-0000-0000-000000000003';

const DUES_OBLIGATION_ACTIVE_ID = '30000000-0000-0000-0000-000000000001';
const DUES_PAYMENT_ACTIVE_ID    = '50000000-0000-0000-0000-000000000001';

export async function seed(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert durable payment evidence for active member's dues obligation
    await client.query(`
      INSERT INTO payment_records
        (id, dues_obligation_id, amount_minor, currency, method, external_reference, notes, recorded_by, idempotency_key, created_at)
      VALUES
        (
          $1, $2, 50000, 'INR', 'bank_transfer', 'DEV-DUES-UTR-001',
          'Annual membership dues 2026-2027', $3, 'seed-dues-pay-001', '2026-04-02 10:00:00+00'
        )
      ON CONFLICT (id) DO NOTHING
    `, [DUES_PAYMENT_ACTIVE_ID, DUES_OBLIGATION_ACTIVE_ID, TREASURER_USER_ID]);

    // Update dues obligation payment_ref to match payment record
    await client.query(`
      UPDATE dues_obligations
      SET payment_ref = $1
      WHERE id = $2 AND payment_ref IS NULL
    `, [DUES_PAYMENT_ACTIVE_ID, DUES_OBLIGATION_ACTIVE_ID]);

    // 2. Synthetic volunteer expenses across states
    // Expense A: Submitted (pending review)
    await client.query(`
      INSERT INTO expenses
        (id, requester_id, amount_minor, currency, purpose, receipt_key, status, submitted_at)
      VALUES
        (
          '60000000-0000-0000-0000-000000000001',
          $1, 45000, 'INR', 'Workshop craft supplies and chart papers',
          'receipts/2026/dev-workshop-supplies.pdf', 'submitted', '2026-09-10 14:30:00+00'
        )
      ON CONFLICT (id) DO NOTHING
    `, [MEMBER_USER_ID]);

    // Expense B: Approved but unpaid (committed liability)
    await client.query(`
      INSERT INTO expenses
        (id, requester_id, amount_minor, currency, purpose, receipt_key, status, submitted_at, decided_at, decided_by, decision_reason)
      VALUES
        (
          '60000000-0000-0000-0000-000000000002',
          $1, 120000, 'INR', 'Event sound system audio adapter cables',
          'receipts/2026/dev-audio-cables.pdf', 'approved',
          '2026-09-12 09:00:00+00', '2026-09-13 11:00:00+00', $2, 'Approved per AV budget line item'
        )
      ON CONFLICT (id) DO NOTHING
    `, [MEMBER_USER_ID, TREASURER_USER_ID]);

    // Expense C: Reimbursed (paid out)
    await client.query(`
      INSERT INTO expenses
        (id, requester_id, amount_minor, currency, purpose, receipt_key, status, submitted_at, decided_at, decided_by, decision_reason, reimbursed_at, reimbursed_by, reimbursement_reference, reimbursement_idempotency_key)
      VALUES
        (
          '60000000-0000-0000-0000-000000000003',
          $1, 85000, 'INR', 'Refreshments for orientation meeting',
          'receipts/2026/dev-meeting-snacks.pdf', 'reimbursed',
          '2026-08-20 16:00:00+00', '2026-08-21 10:00:00+00', $2, 'Approved orientation expense',
          '2026-08-22 15:00:00+00', $2, 'UPI-REF-88492019', 'seed-reimb-key-001'
        )
      ON CONFLICT (id) DO NOTHING
    `, [ORGANIZER_USER_ID, TREASURER_USER_ID]);

    // Expense D: Rejected
    await client.query(`
      INSERT INTO expenses
        (id, requester_id, amount_minor, currency, purpose, receipt_key, status, submitted_at, decided_at, decided_by, decision_reason)
      VALUES
        (
          '60000000-0000-0000-0000-000000000004',
          $1, 500000, 'INR', 'Personal transport luxury taxi upgrade',
          'receipts/2026/dev-taxi.pdf', 'rejected',
          '2026-09-01 12:00:00+00', '2026-09-02 14:00:00+00', $2, 'Policy only covers standard public transit fares'
        )
      ON CONFLICT (id) DO NOTHING
    `, [MEMBER_USER_ID, TREASURER_USER_ID]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
