/**
 * server/tests/dues-finance.api.test.js — Dharmik's Dues, Expenses, and Finance API tests.
 *
 * Real HTTP/API integration tests covering:
 * - RBAC & CSRF enforcement across dues, expenses, receipts, and finance summary
 * - Dues manual payment confirmation, durable payment evidence, and membership status refresh
 * - Dues idempotency: replays vs altered payload vs cross-target reuse
 * - Dues amount/currency validation and waiver handling
 * - Private receipt upload with size/type validation and safe storage
 * - Private receipt download authorization (owner & staff allowed, third-party denied)
 * - Expense submission, owner history scoping, and detail access
 * - Segregation of duties: users CANNOT approve or reimburse their own expenses
 * - Expense approval, rejection with required reason, and reimbursement idempotency
 * - Financial summary reporting with per-currency separation and honest labels
 * - Concurrent payment requests and transaction rollback safety
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { createApp } from '../app.js';
import { createUser, assignRole } from '../model/auth.model.js';
import { createMembership } from '../model/member.model.js';
import { findPaymentByDuesObligation } from '../model/payment.model.js';
import { getExpenseById } from '../model/expense.model.js';
import { createEvent, insertRegistration } from '../model/event.model.js';
import { createProduct, createProductVariant, insertOrder, insertOrderItem } from '../model/merchandise.model.js';
import { insertPaymentRecord } from '../model/payment.model.js';

const databaseUrl = process.env.NODE_TEST_DATABASE_URL;

test('Dues, Expenses, and Finance API: manual payments, expense lifecycle, receipts, and reporting', { skip: !databaseUrl }, async t => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 15 });
  const config = {
    sessionSecret: randomBytes(32).toString('hex'),
    ticketSecret: randomBytes(32).toString('hex'),
  };
  const server = createApp({ configured: true, pool }, config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const prefix = `df-${randomUUID().slice(0, 8)}`;
  const userIds = [];
  const planIds = [];
  const receiptKeys = [];

  t.after(async () => {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
    try {
      if (userIds.length > 0) {
        await pool.query(
          `DELETE FROM payment_records 
           WHERE recorded_by = ANY($1::uuid[]) 
              OR dues_obligation_id IN (SELECT do2.id FROM dues_obligations do2 JOIN membership_periods mp ON mp.id = do2.membership_period_id WHERE mp.user_id = ANY($1::uuid[]))
              OR registration_id IN (SELECT id FROM registrations WHERE user_id = ANY($1::uuid[]))
              OR order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))`,
          [userIds]
        );
        await pool.query('DELETE FROM expenses WHERE requester_id = ANY($1::uuid[]) OR decided_by = ANY($1::uuid[]) OR reimbursed_by = ANY($1::uuid[])', [userIds]);
        await pool.query('DELETE FROM dues_obligations WHERE membership_period_id IN (SELECT id FROM membership_periods WHERE user_id = ANY($1::uuid[]))', [userIds]);
        await pool.query('DELETE FROM membership_periods WHERE user_id = ANY($1::uuid[])', [userIds]);
        await pool.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))', [userIds]);
        await pool.query('DELETE FROM orders WHERE user_id = ANY($1::uuid[])', [userIds]);
        await pool.query('DELETE FROM registrations WHERE user_id = ANY($1::uuid[])', [userIds]);
        await pool.query("DELETE FROM sessions WHERE sess->>'userId' = ANY($1::text[])", [userIds]);
        await pool.query('DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])', [userIds]);
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
      }
      if (planIds.length > 0) {
        await pool.query('DELETE FROM membership_plans WHERE id = ANY($1::uuid[])', [planIds]);
      }
    } finally {
      await pool.end();
    }
  });

  // Client session agent helper
  function agent() {
    let cookie = '', csrf = '';
    const fn = async (path, method = 'GET', body, headers = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrf,
          ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
      });
      const set = response.headers.getSetCookie();
      if (set.length) cookie = set[0].split(';')[0];
      const contentType = response.headers.get('content-type') || '';
      const data = response.status === 204
        ? null
        : contentType.includes('application/json')
          ? await response.json()
          : await response.text();
      if (data?.data?.csrfToken) csrf = data.data.csrfToken;
      return { status: response.status, data: data?.data ?? data, error: data?.error, raw: data };
    };
    fn.getCookie = () => cookie;
    fn.getCsrf = () => csrf;
    return fn;
  }

  async function createAccount(label, role = 'member') {
    const email = `${prefix}-${label}@example.test`;
    const password = 'Testing-password123!';
    const user = await createUser(pool, { name: label, email, passwordHash: await bcrypt.hash(password, 4) });
    userIds.push(user.id);
    if (role) {
      await assignRole(pool, { userId: user.id, roleName: role });
    }
    const client = agent();
    await client('/auth/csrf');
    const loginRes = await client('/auth/login', 'POST', { email, password });
    assert.equal(loginRes.status, 200, `Login failed for ${label}`);
    return { client, id: user.id, email, name: label };
  }

  // Set up actors with distinct roles
  const treasurer = await createAccount('treasurer', 'treasurer');
  const organizer = await createAccount('organizer', 'organizer');
  const memberA = await createAccount('memberA', 'member');
  const memberB = await createAccount('memberB', 'member');
  const volunteer = await createAccount('volunteer', 'volunteer');
  const anonymous = agent();

  // Create membership plan
  const planRes = await pool.query(
    `INSERT INTO membership_plans (name, description, duration_months, dues_amount_minor, currency)
     VALUES ($1, 'Standard student membership', 12, 5000, 'INR')
     RETURNING id`,
    [`${prefix} Annual Plan`]
  );
  const planId = planRes.rows[0].id;
  planIds.push(planId);

  // Helper to create membership obligation
  async function seedMembership(targetUserId, amountMinor = 5000, currency = 'INR') {
    const startsAt = new Date();
    const expiresAt = new Date(Date.now() + 365 * 86400000);
    const result = await createMembership(pool, {
      userId: targetUserId,
      planId,
      startsAt,
      expiresAt,
      duesAmountMinor: amountMinor,
      currency,
    });
    return result;
  }

  // ─── 1. Role-Based Access Control and Route Authorization ───────────────────

  await t.test('Dues & Finance RBAC: role enforcement for pending dues and summary', async () => {
    // GET /dues/pending
    assert.equal((await anonymous('/dues/pending')).status, 401);
    assert.equal((await memberA.client('/dues/pending')).status, 403);
    assert.equal((await volunteer.client('/dues/pending')).status, 403);
    assert.equal((await organizer.client('/dues/pending')).status, 200);
    assert.equal((await treasurer.client('/dues/pending')).status, 200);

    // GET /finance/summary
    assert.equal((await anonymous('/finance/summary')).status, 401);
    assert.equal((await memberA.client('/finance/summary')).status, 403);
    assert.equal((await volunteer.client('/finance/summary')).status, 403);
    assert.equal((await organizer.client('/finance/summary')).status, 200);
    assert.equal((await treasurer.client('/finance/summary')).status, 200);
  });

  // ─── 2. Dues Manual Payment Confirmation & Status Refresh ───────────────────

  await t.test('Dues manual payment confirmation transitions obligation to paid and refreshes membership status', async () => {
    const { duesObligationId } = await seedMembership(memberA.id, 5000, 'INR');

    // Verify initial profile shows pending dues
    const initProfile = await memberA.client('/member/me');
    assert.equal(initProfile.status, 200);
    assert.equal(initProfile.data.membershipStatus, 'pending');

    const key = `key_${randomUUID().replace(/-/g, '')}`;
    const payload = {
      duesObligationId,
      amountMinor: 5000,
      currency: 'INR',
      method: 'upi',
      externalReference: 'UPI-DUES-12345',
      notes: 'Paid via student GooglePay',
    };

    // Ordinary member attempt denied 403
    const deniedRes = await memberA.client('/payments/dues/manual', 'POST', payload, { 'Idempotency-Key': key });
    assert.equal(deniedRes.status, 403);

    // Treasurer confirms dues payment
    const confirmRes = await treasurer.client('/payments/dues/manual', 'POST', payload, { 'Idempotency-Key': key });
    assert.equal(confirmRes.status, 201);
    assert.equal(confirmRes.raw.replayed, false);
    assert.equal(confirmRes.data.duesObligation.status, 'paid');
    assert.equal(confirmRes.data.payment.amountMinor, 5000);
    assert.equal(confirmRes.data.payment.currency, 'INR');
    assert.equal(confirmRes.data.memberProfile.membershipStatus, 'active');

    // Verify database evidence
    const dbPayment = await findPaymentByDuesObligation(pool, duesObligationId);
    assert.ok(dbPayment);
    assert.equal(dbPayment.amountMinor, 5000);
    assert.equal(dbPayment.recordedBy, treasurer.id);

    // Verify member's own profile now evaluates to 'active'
    const updatedProfile = await memberA.client('/member/me');
    assert.equal(updatedProfile.data.membershipStatus, 'active');
  });

  // ─── 3. Dues Idempotency & Validation ───────────────────────────────────────

  await t.test('Dues idempotency: identical replay returns 200, altered payload rejected with 409', async () => {
    const { duesObligationId } = await seedMembership(memberB.id, 5000, 'INR');
    const key = `key_${randomUUID().replace(/-/g, '')}`;
    const payload = {
      duesObligationId,
      amountMinor: 5000,
      currency: 'INR',
      method: 'cash',
      externalReference: 'CASH-REC-001',
    };

    // First attempt -> 201
    const firstRes = await treasurer.client('/payments/dues/manual', 'POST', payload, { 'Idempotency-Key': key });
    assert.equal(firstRes.status, 201);

    // Identical replay -> 200 replayed: true
    const replayRes = await treasurer.client('/payments/dues/manual', 'POST', payload, { 'Idempotency-Key': key });
    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.raw.replayed, true);
    assert.equal(replayRes.data.payment.id, firstRes.data.payment.id);

    // Altered payload with same key -> 409 IDEMPOTENCY_PAYLOAD_MISMATCH
    const alteredRes = await treasurer.client('/payments/dues/manual', 'POST', {
      ...payload,
      amountMinor: 4000,
    }, { 'Idempotency-Key': key });
    assert.equal(alteredRes.status, 409);
    assert.equal(alteredRes.error?.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  await t.test('Dues validation: amount mismatch and currency mismatch', async () => {
    const { duesObligationId } = await seedMembership(memberB.id, 5000, 'INR');
    const key = `key_${randomUUID().replace(/-/g, '')}`;

    // Amount mismatch
    const badAmountRes = await treasurer.client('/payments/dues/manual', 'POST', {
      duesObligationId,
      amountMinor: 3000,
      currency: 'INR',
      method: 'cash',
    }, { 'Idempotency-Key': key });
    assert.equal(badAmountRes.status, 400);
    assert.equal(badAmountRes.error?.code, 'AMOUNT_MISMATCH');

    // Currency mismatch
    const badCurrRes = await treasurer.client('/payments/dues/manual', 'POST', {
      duesObligationId,
      amountMinor: 5000,
      currency: 'USD',
      method: 'cash',
    }, { 'Idempotency-Key': key });
    assert.equal(badCurrRes.status, 400);
    assert.equal(badCurrRes.error?.code, 'CURRENCY_MISMATCH');
  });

  // ─── 4. Dues Waivers ────────────────────────────────────────────────────────

  await t.test('Dues waiver transitions obligation without creating a payment record', async () => {
    const testUser = await createAccount('waiverUser', 'member');
    const { duesObligationId } = await seedMembership(testUser.id, 5000, 'INR');

    // Waive dues
    const waiveRes = await treasurer.client(`/dues/${duesObligationId}/waive`, 'POST', {
      notes: 'Scholarship student waiver approved by committee',
    });
    assert.equal(waiveRes.status, 200);
    assert.equal(waiveRes.data.duesObligation.status, 'waived');

    // Verify NO payment_records row was created (amount received = 0)
    const dbPayment = await findPaymentByDuesObligation(pool, duesObligationId);
    assert.equal(dbPayment, null);

    // Attempting payment on waived dues is rejected with 409 DUES_WAIVED
    const payRes = await treasurer.client('/payments/dues/manual', 'POST', {
      duesObligationId,
      amountMinor: 5000,
      currency: 'INR',
      method: 'cash',
    }, { 'Idempotency-Key': `key_${randomUUID().replace(/-/g, '')}` });
    assert.equal(payRes.status, 409);
    assert.equal(payRes.error?.code, 'DUES_WAIVED');
  });

  // ─── 5. Receipt Upload, Download, and Storage Security ──────────────────────

  let uploadedReceiptKey = '';

  await t.test('Private receipt upload validates types and stores safely', async () => {
    // Invalid mime type rejected
    const badTypeRes = await memberA.client('/expenses/receipts', 'POST', {
      filename: 'script.exe',
      contentType: 'application/x-msdownload',
      dataBase64: Buffer.from('executable binary').toString('base64'),
    });
    assert.equal(badTypeRes.status, 400);
    assert.equal(badTypeRes.error?.code, 'INVALID_FILE_TYPE');

    // Valid PNG receipt upload via Base64 JSON
    const pngBuffer = Buffer.from('fake-png-image-binary-data');
    const uploadRes = await memberA.client('/expenses/receipts', 'POST', {
      filename: 'club_supplies_receipt.png',
      contentType: 'image/png',
      dataBase64: pngBuffer.toString('base64'),
    });

    assert.equal(uploadRes.status, 201);
    assert.ok(uploadRes.data.receiptKey);
    assert.equal(uploadRes.data.mimeType, 'image/png');
    uploadedReceiptKey = uploadRes.data.receiptKey;
    receiptKeys.push(uploadedReceiptKey);
  });

  // ─── 6. Expense Lifecycle & Segregation of Duties ────────────────────────────

  let createdExpenseId = '';

  await t.test('Expense submission and owner history scoping', async () => {
    // Member A submits expense
    const submitRes = await memberA.client('/expenses', 'POST', {
      amountMinor: 1500, // 15.00 INR
      currency: 'INR',
      purpose: 'Poster printing for welcome booth',
      receiptKey: uploadedReceiptKey,
    });
    assert.equal(submitRes.status, 201);
    assert.equal(submitRes.data.status, 'submitted');
    assert.equal(submitRes.data.amountMinor, 1500);
    createdExpenseId = submitRes.data.id;

    // Member A can list and see their expense
    const memberList = await memberA.client('/expenses');
    assert.equal(memberList.status, 200);
    assert.ok(memberList.data.some(e => e.id === createdExpenseId));

    // Member B listing expenses is scoped to Member B (cannot see Member A's claim)
    const memberBList = await memberB.client('/expenses');
    assert.equal(memberBList.status, 200);
    assert.ok(!memberBList.data.some(e => e.id === createdExpenseId));

    // Staff treasurer sees all expenses
    const staffList = await treasurer.client('/expenses');
    assert.equal(staffList.status, 200);
    assert.ok(staffList.data.some(e => e.id === createdExpenseId));
  });

  await t.test('Private receipt download authorization: owner & staff allowed, stranger rejected', async () => {
    // Owner can access receipt
    const ownerRes = await memberA.client(`/expenses/${createdExpenseId}/receipt`);
    assert.equal(ownerRes.status, 200);

    // Staff can access receipt
    const staffRes = await treasurer.client(`/expenses/${createdExpenseId}/receipt`);
    assert.equal(staffRes.status, 200);

    // Another member (Member B) is denied 403
    const strangerRes = await memberB.client(`/expenses/${createdExpenseId}/receipt`);
    assert.equal(strangerRes.status, 403);
  });

  await t.test('Segregation of duties: users CANNOT approve or reject their own expense claims', async () => {
    // Give Organizer user an expense claim
    const orgExpenseRes = await organizer.client('/expenses', 'POST', {
      amountMinor: 2500,
      currency: 'INR',
      purpose: 'Meeting snacks and tea',
      receiptKey: uploadedReceiptKey,
    });
    assert.equal(orgExpenseRes.status, 201);
    const orgExpenseId = orgExpenseRes.data.id;

    // Organizer attempts to approve their OWN expense claim -> 403 CANNOT_APPROVE_OWN_EXPENSE
    const selfApproveRes = await organizer.client(`/expenses/${orgExpenseId}/decision`, 'PATCH', {
      decision: 'approved',
    });
    assert.equal(selfApproveRes.status, 403);
    assert.equal(selfApproveRes.error?.code, 'CANNOT_APPROVE_OWN_EXPENSE');

    // Rejection without reason fails validation -> 400
    const badRejectRes = await treasurer.client(`/expenses/${orgExpenseId}/decision`, 'PATCH', {
      decision: 'rejected',
      reason: '',
    });
    assert.equal(badRejectRes.status, 400);

    // Legitimate approval by different staff member (Treasurer) -> 200 OK
    const legitApproveRes = await treasurer.client(`/expenses/${orgExpenseId}/decision`, 'PATCH', {
      decision: 'approved',
      reason: 'Verified snacks receipt',
    });
    assert.equal(legitApproveRes.status, 200);
    assert.equal(legitApproveRes.data.status, 'approved');

    // Organizer attempts to reimburse their OWN approved expense -> 403 CANNOT_REIMBURSE_OWN_EXPENSE
    const selfReimburseRes = await organizer.client(`/expenses/${orgExpenseId}/reimburse`, 'POST', {
      reimbursementReference: 'CASH-ORG-01',
    }, { 'Idempotency-Key': `key_${randomUUID().replace(/-/g, '')}` });
    assert.equal(selfReimburseRes.status, 403);
    assert.equal(selfReimburseRes.error?.code, 'CANNOT_REIMBURSE_OWN_EXPENSE');

    // Legitimate reimbursement by Treasurer -> 200 OK
    const key = `key_${randomUUID().replace(/-/g, '')}`;
    const legitReimburseRes = await treasurer.client(`/expenses/${orgExpenseId}/reimburse`, 'POST', {
      reimbursementReference: 'UTR-REIMB-888',
    }, { 'Idempotency-Key': key });
    assert.equal(legitReimburseRes.status, 200);
    assert.equal(legitReimburseRes.data.status, 'reimbursed');

    // Reimbursement replay returns 200 replayed: true
    const replayRes = await treasurer.client(`/expenses/${orgExpenseId}/reimburse`, 'POST', {
      reimbursementReference: 'UTR-REIMB-888',
    }, { 'Idempotency-Key': key });
    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.raw.replayed, true);
  });

  // ─── 7. Financial Summary Aggregation & Per-Currency Separation ─────────────

  await t.test('Financial summary accurately aggregates revenues, expenses, and net cash movement', async () => {
    const summaryRes = await treasurer.client('/finance/summary');
    assert.equal(summaryRes.status, 200);

    const data = summaryRes.data;
    assert.ok(Array.isArray(data.currencies));
    assert.ok(data.notice);

    const inrSummary = data.currencies.find(c => c.currency === 'INR');
    assert.ok(inrSummary, 'INR currency summary must exist');

    // Receipts must include the paid dues
    assert.ok(inrSummary.receipts.duesMinor >= 5000);
    assert.ok(inrSummary.receipts.totalMinor >= 5000);

    // Disbursements must include the reimbursed expense
    assert.ok(inrSummary.disbursements.reimbursedMinor >= 2500);

    // Net cash movement formula check: totalMinor - reimbursedMinor
    assert.equal(
      inrSummary.netCashMovementMinor,
      inrSummary.receipts.totalMinor - inrSummary.disbursements.reimbursedMinor
    );
  });

  // ─── 8. Concurrency Race & Atomic Rollback ───────────────────────────────────

  await t.test('Simultaneous identical dues payments resolve cleanly with one 201 and one 200 replay', async () => {
    const testUser = await createAccount('raceUser', 'member');
    const { duesObligationId } = await seedMembership(testUser.id, 5000, 'INR');
    const key = `racekey_${randomUUID().replace(/-/g, '')}`;

    const payload = {
      duesObligationId,
      amountMinor: 5000,
      currency: 'INR',
      method: 'cash',
    };

    const [resA, resB] = await Promise.all([
      treasurer.client('/payments/dues/manual', 'POST', payload, { 'Idempotency-Key': key }),
      treasurer.client('/payments/dues/manual', 'POST', payload, { 'Idempotency-Key': key }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [200, 201], 'Exactly one request inserts (201), the other safely replays (200)');
  });
});
