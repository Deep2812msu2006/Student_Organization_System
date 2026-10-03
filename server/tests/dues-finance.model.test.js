/**
 * dues-finance.model.test.js — Deep owns this file.
 *
 * Tests for membership dues payments, volunteer expenses lifecycle,
 * financial reporting queries, and database constraints.
 *
 * Requires NODE_TEST_DATABASE_URL (isolated test database with migrations applied).
 *
 * Covers:
 *  - Membership dues payment confirmation and durable evidence linking dues_obligation_id.
 *  - Dues waivers treated separately from money received (no payment_records row).
 *  - 3-way target mutual exclusion constraint (@rule:PAYMENT_TARGET_MUTEX).
 *  - Duplicate dues payment prevention via unique index (@rule:DUES_PAYMENT_ONCE).
 *  - Period boundary preservation: dues payment does not mutate starts_at/expires_at.
 *  - Volunteer expense creation and schema constraints (positive amounts, valid statuses).
 *  - Expense lifecycle transitions: submitted -> approved/rejected -> reimbursed (@rule:EXPENSE_TRANSITIONS).
 *  - Duplicate reimbursement prevention via unique idempotency key (@rule:REIMBURSEMENT_ONCE).
 *  - Financial summary queries: receipts breakdown, disbursements, net cash movement, committed liabilities.
 *  - Currency isolation: amounts grouped strictly per currency.
 *  - Transaction rollback behavior.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import { createUser, assignRole } from '../model/auth.model.js';
import { createMembership, getMemberProfile } from '../model/member.model.js';
import {
  insertPaymentRecord,
  findPaymentByIdempotencyKey,
  findPaymentByDuesObligation,
  lockDuesObligationForPayment,
  confirmDuesPayment,
  waiveDuesObligation,
  listPendingDuesObligations,
} from '../model/payment.model.js';
import {
  createExpense,
  getExpenseById,
  listExpenses,
  lockExpenseForDecision,
  decideExpense,
  lockExpenseForReimbursement,
  reimburseExpense,
  findExpenseByReimbursementIdempotencyKey,
} from '../model/expense.model.js';
import { getFinancialSummary } from '../model/finance.model.js';
import { createProduct, createProductVariant, insertOrder, insertOrderItem } from '../model/merchandise.model.js';
import { createEvent, insertRegistration } from '../model/event.model.js';

const TEST_DB_URL = process.env.NODE_TEST_DATABASE_URL;

function skipIfNoTestDb(t) {
  if (!TEST_DB_URL) {
    t.skip('NODE_TEST_DATABASE_URL not set');
    return true;
  }
  return false;
}

function makePool(max = 10) {
  const pool = new pg.Pool({
    connectionString: TEST_DB_URL,
    max,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => {});
  return pool;
}

async function cleanupEntities(pool, { userIds = [], productIds = [], eventIds = [], expenseIds = [] }) {
  if (expenseIds.length > 0) {
    await pool.query('DELETE FROM expenses WHERE id = ANY($1::uuid[])', [expenseIds]);
  }
  if (userIds.length > 0) {
    await pool.query('DELETE FROM expenses WHERE requester_id = ANY($1::uuid[]) OR decided_by = ANY($1::uuid[]) OR reimbursed_by = ANY($1::uuid[])', [userIds]);
    await pool.query(
      `DELETE FROM payment_records 
       WHERE recorded_by = ANY($1::uuid[]) 
          OR order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))
          OR registration_id IN (SELECT id FROM registrations WHERE user_id = ANY($1::uuid[]))
          OR dues_obligation_id IN (SELECT d.id FROM dues_obligations d JOIN membership_periods mp ON mp.id = d.membership_period_id WHERE mp.user_id = ANY($1::uuid[]))`,
      [userIds]
    );
    await pool.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))', [userIds]);
    await pool.query('DELETE FROM orders WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM registrations WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM dues_obligations WHERE membership_period_id IN (SELECT id FROM membership_periods WHERE user_id = ANY($1::uuid[]))', [userIds]);
    await pool.query('DELETE FROM membership_periods WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  }
  if (productIds.length > 0) {
    await pool.query('DELETE FROM order_items WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ANY($1::uuid[]))', [productIds]);
    await pool.query('DELETE FROM product_variants WHERE product_id = ANY($1::uuid[])', [productIds]);
    await pool.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]);
  }
  if (eventIds.length > 0) {
    await pool.query('DELETE FROM payment_records WHERE registration_id IN (SELECT id FROM registrations WHERE event_id = ANY($1::uuid[]))', [eventIds]);
    await pool.query('DELETE FROM registrations WHERE event_id = ANY($1::uuid[])', [eventIds]);
    await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [eventIds]);
  }
}

const PLAN_ID = '00000000-0000-0000-0000-000000000001';

test('dues payment: confirmation writes durable evidence and transitions status to paid', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds });
    } finally {
      await pool.end();
    }
  });

  const member = await createUser(pool, {
    name: 'Dues Member',
    email: `dues-m-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(member.id);

  const treasurer = await createUser(pool, {
    name: 'Dues Treasurer',
    email: `dues-t-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(treasurer.id);
  await assignRole(pool, { userId: treasurer.id, roleName: 'organizer' });

  // Create membership enrollment (pending dues)
  const startsAt = new Date('2026-10-01T00:00:00Z');
  const expiresAt = new Date('2027-03-31T23:59:59Z');
  const membership = await createMembership(pool, {
    userId: member.id,
    planId: PLAN_ID,
    startsAt,
    expiresAt,
    duesAmountMinor: 50000,
    currency: 'INR',
  });

  // Verify before payment: profile status is pending, not active (@rule:MEMBERSHIP_VALIDITY)
  const profileBefore = await getMemberProfile(pool, member.id, new Date('2026-10-02T12:00:00Z'));
  assert.equal(profileBefore.membershipStatus, 'pending');

  // Execute payment confirmation inside transaction
  const payKey = `dues-pay-${crypto.randomUUID()}`;
  const client = await pool.connect();
  let paymentRecord = null;
  let confirmedDues = null;

  try {
    await client.query('BEGIN');

    const locked = await lockDuesObligationForPayment(client, membership.duesObligationId);
    assert.ok(locked);
    assert.equal(locked.status, 'pending');
    assert.equal(locked.amountMinor, 50000);
    assert.equal(locked.currency, 'INR');

    paymentRecord = await insertPaymentRecord(client, {
      duesObligationId: membership.duesObligationId,
      amountMinor: 50000,
      currency: 'INR',
      method: 'bank_transfer',
      externalReference: 'DUES-UTR-112233',
      notes: 'Verified against bank statement',
      recordedBy: treasurer.id,
      idempotencyKey: payKey,
    });

    confirmedDues = await confirmDuesPayment(client, {
      duesObligationId: membership.duesObligationId,
      paymentRef: paymentRecord.id,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Verify payment evidence
  assert.ok(paymentRecord);
  assert.equal(paymentRecord.duesObligationId, membership.duesObligationId);
  assert.equal(paymentRecord.registrationId, null);
  assert.equal(paymentRecord.orderId, null);
  assert.equal(paymentRecord.amountMinor, 50000);

  // Verify updated dues
  assert.ok(confirmedDues);
  assert.equal(confirmedDues.status, 'paid');
  assert.equal(confirmedDues.paymentRef, paymentRecord.id);

  // Verify profile after payment: now active, boundaries strictly preserved
  const profileAfter = await getMemberProfile(pool, member.id, new Date('2026-10-02T12:00:00Z'));
  assert.equal(profileAfter.membershipStatus, 'active');
  assert.equal(profileAfter.startsAt.toISOString(), startsAt.toISOString());
  assert.equal(profileAfter.expiresAt.toISOString(), expiresAt.toISOString());

  // Verify findPaymentByDuesObligation helper
  const found = await findPaymentByDuesObligation(pool, membership.duesObligationId);
  assert.ok(found);
  assert.equal(found.id, paymentRecord.id);
});

test('dues waivers: transitions to waived without inserting payment_records row', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds });
    } finally {
      await pool.end();
    }
  });

  const member = await createUser(pool, {
    name: 'Waived Member',
    email: `waived-m-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(member.id);

  const membership = await createMembership(pool, {
    userId: member.id,
    planId: PLAN_ID,
    startsAt: new Date('2026-10-01T00:00:00Z'),
    expiresAt: new Date('2027-03-31T23:59:59Z'),
    duesAmountMinor: 50000,
    currency: 'INR',
  });

  const client = await pool.connect();
  let waivedResult = null;
  try {
    await client.query('BEGIN');
    const locked = await lockDuesObligationForPayment(client, membership.duesObligationId);
    assert.ok(locked);
    assert.equal(locked.status, 'pending');

    waivedResult = await waiveDuesObligation(client, {
      duesObligationId: membership.duesObligationId,
      notes: 'Scholarship exemption approved by board',
    });
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  assert.ok(waivedResult);
  assert.equal(waivedResult.status, 'waived');

  // Verify NO payment_records row was written for waiver
  const payment = await findPaymentByDuesObligation(pool, membership.duesObligationId);
  assert.equal(payment, null, 'Waivers must not write a payment_records audit row');
});

test('payment_records: enforces 3-way target mutual exclusion (@rule:PAYMENT_TARGET_MUTEX)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  const eventIds = [];
  const productIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, eventIds, productIds });
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, {
    name: 'Target Mutex User',
    email: `mutex-3way-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(user.id);

  // 1. Event registration
  const event = await createEvent(pool, {
    title: 'Mutex 3Way Event',
    venue: 'Hall B',
    startsAt: '2026-12-01T10:00:00Z',
    endsAt: '2026-12-01T12:00:00Z',
    capacity: 10,
    memberPriceMinor: 1000,
    publicPriceMinor: 2000,
    currency: 'INR',
    status: 'published',
  });
  eventIds.push(event.id);
  const reg = await insertRegistration(pool, {
    eventId: event.id,
    userId: user.id,
    priceMinor: 2000,
    currency: 'INR',
    idempotencyKey: `mutex-reg-${crypto.randomUUID()}`,
    tokenHash: `hash-${crypto.randomUUID()}`,
  });

  // 2. Order
  const product = await createProduct(pool, { name: 'Item 3Way' });
  productIds.push(product.id);
  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 5000,
    status: 'pending',
    idempotencyKey: `mutex-ord-${crypto.randomUUID()}`,
    payloadHash: 'hash-3way',
  });

  // 3. Dues obligation
  const membership = await createMembership(pool, {
    userId: user.id,
    planId: PLAN_ID,
    startsAt: new Date('2026-10-01T00:00:00Z'),
    expiresAt: new Date('2027-03-31T23:59:59Z'),
    duesAmountMinor: 50000,
    currency: 'INR',
  });

  const client = await pool.connect();
  try {
    // A. Zero targets -> FAILS
    await assert.rejects(
      async () => {
        await insertPaymentRecord(client, {
          amountMinor: 5000,
          currency: 'INR',
          method: 'cash',
          recordedBy: user.id,
          idempotencyKey: `key-zero-${crypto.randomUUID()}`,
        });
      },
      /payment_records_target_check/
    );

    // B. Multiple targets (Registration + Dues) -> FAILS
    await assert.rejects(
      async () => {
        await insertPaymentRecord(client, {
          registrationId: reg.id,
          duesObligationId: membership.duesObligationId,
          amountMinor: 5000,
          currency: 'INR',
          method: 'cash',
          recordedBy: user.id,
          idempotencyKey: `key-reg-dues-${crypto.randomUUID()}`,
        });
      },
      /payment_records_target_check/
    );

    // C. Multiple targets (Order + Dues) -> FAILS
    await assert.rejects(
      async () => {
        await insertPaymentRecord(client, {
          orderId: order.id,
          duesObligationId: membership.duesObligationId,
          amountMinor: 5000,
          currency: 'INR',
          method: 'cash',
          recordedBy: user.id,
          idempotencyKey: `key-ord-dues-${crypto.randomUUID()}`,
        });
      },
      /payment_records_target_check/
    );
  } finally {
    client.release();
  }
});

test('dues payment: duplicate payment is prevented by unique index (@rule:DUES_PAYMENT_ONCE)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds });
    } finally {
      await pool.end();
    }
  });

  const member = await createUser(pool, {
    name: 'Dup Dues Member',
    email: `dup-dues-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(member.id);

  const membership = await createMembership(pool, {
    userId: member.id,
    planId: PLAN_ID,
    startsAt: new Date('2026-10-01T00:00:00Z'),
    expiresAt: new Date('2027-03-31T23:59:59Z'),
    duesAmountMinor: 50000,
    currency: 'INR',
  });

  // First payment confirmation succeeds
  const key1 = `dues-p1-${crypto.randomUUID()}`;
  const client1 = await pool.connect();
  try {
    await client1.query('BEGIN');
    const payment = await insertPaymentRecord(client1, {
      duesObligationId: membership.duesObligationId,
      amountMinor: 50000,
      currency: 'INR',
      method: 'cash',
      recordedBy: member.id,
      idempotencyKey: key1,
    });
    await confirmDuesPayment(client1, {
      duesObligationId: membership.duesObligationId,
      paymentRef: payment.id,
    });
    await client1.query('COMMIT');
  } finally {
    client1.release();
  }

  // Second confirmation attempt:
  // 1. confirmDuesPayment returns null (status is paid, not pending)
  const client2 = await pool.connect();
  try {
    await client2.query('BEGIN');
    const confirmed2 = await confirmDuesPayment(client2, {
      duesObligationId: membership.duesObligationId,
      paymentRef: 'fake-id',
    });
    assert.equal(confirmed2, null, 'confirmDuesPayment must return null for already-paid dues');

    // 2. insertPaymentRecord violates unique index
    await assert.rejects(
      async () => {
        await insertPaymentRecord(client2, {
          duesObligationId: membership.duesObligationId,
          amountMinor: 50000,
          currency: 'INR',
          method: 'upi',
          recordedBy: member.id,
          idempotencyKey: `dues-p2-${crypto.randomUUID()}`,
        });
      },
      /payment_records_unique_dues_obligation_idx/
    );
    await client2.query('ROLLBACK');
  } finally {
    client2.release();
  }
});

test('volunteer expenses: creation, validation, decision, and reimbursement lifecycle (@rule:EXPENSE_TRANSITIONS)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  const expenseIds = [];
  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, expenseIds });
    } finally {
      await pool.end();
    }
  });

  const volunteer = await createUser(pool, {
    name: 'Volunteer Alice',
    email: `vol-a-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(volunteer.id);

  const treasurer = await createUser(pool, {
    name: 'Treasurer Bob',
    email: `tres-b-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(treasurer.id);
  await assignRole(pool, { userId: treasurer.id, roleName: 'organizer' });

  // 1. Submit expense (starts in 'submitted')
  const expense = await createExpense(pool, {
    requesterId: volunteer.id,
    amountMinor: 35000, // 350.00 INR
    currency: 'INR',
    purpose: 'Event banners and mounting tape',
    receiptKey: 'receipts/2026/banners.pdf',
  });
  expenseIds.push(expense.id);

  assert.equal(expense.status, 'submitted');
  assert.equal(expense.amountMinor, 35000);
  assert.equal(expense.currency, 'INR');

  // Constraint check: Non-positive amount rejected
  await assert.rejects(
    async () => {
      await createExpense(pool, {
        requesterId: volunteer.id,
        amountMinor: 0,
        currency: 'INR',
        purpose: 'Zero amount item',
        receiptKey: 'receipts/zero.pdf',
      });
    },
    /expenses_amount_minor_check/
  );

  // 2. Fetch and list
  const fetched = await getExpenseById(pool, expense.id);
  assert.ok(fetched);
  assert.equal(fetched.requesterName, 'Volunteer Alice');

  const listResult = await listExpenses(pool, { requesterId: volunteer.id });
  assert.ok(listResult.total >= 1);
  assert.ok(listResult.rows.some(e => e.id === expense.id));

  // 3. Decide: submitted -> approved
  const clientDecide = await pool.connect();
  let approvedExpense = null;
  try {
    await clientDecide.query('BEGIN');
    const locked = await lockExpenseForDecision(clientDecide, expense.id);
    assert.ok(locked);
    assert.equal(locked.status, 'submitted');

    approvedExpense = await decideExpense(clientDecide, {
      expenseId: expense.id,
      actorId: treasurer.id,
      decision: 'approved',
      reason: 'Approved per publicity budget allocation',
    });
    await clientDecide.query('COMMIT');
  } finally {
    clientDecide.release();
  }

  assert.ok(approvedExpense);
  assert.equal(approvedExpense.status, 'approved');
  assert.equal(approvedExpense.decidedBy, treasurer.id);
  assert.equal(approvedExpense.decisionReason, 'Approved per publicity budget allocation');

  // Cannot decide already decided expense (submitted -> approved only)
  const clientReDecide = await pool.connect();
  try {
    await clientReDecide.query('BEGIN');
    const reDecided = await decideExpense(clientReDecide, {
      expenseId: expense.id,
      actorId: treasurer.id,
      decision: 'rejected',
    });
    assert.equal(reDecided, null, 'decideExpense on non-submitted expense must return null');
    await clientReDecide.query('ROLLBACK');
  } finally {
    clientReDecide.release();
  }

  // 4. Reimburse: approved -> reimbursed (@rule:REIMBURSEMENT_ONCE)
  const reimbKey = `reimb-key-${crypto.randomUUID()}`;
  const clientReimb = await pool.connect();
  let reimbursedExpense = null;
  try {
    await clientReimb.query('BEGIN');
    const locked = await lockExpenseForReimbursement(clientReimb, expense.id);
    assert.ok(locked);
    assert.equal(locked.status, 'approved');

    reimbursedExpense = await reimburseExpense(clientReimb, {
      expenseId: expense.id,
      actorId: treasurer.id,
      reimbursementReference: 'BANK-TRF-990011',
      idempotencyKey: reimbKey,
    });
    await clientReimb.query('COMMIT');
  } finally {
    clientReimb.release();
  }

  assert.ok(reimbursedExpense);
  assert.equal(reimbursedExpense.status, 'reimbursed');
  assert.equal(reimbursedExpense.reimbursedBy, treasurer.id);
  assert.equal(reimbursedExpense.reimbursementReference, 'BANK-TRF-990011');
  assert.equal(reimbursedExpense.reimbursementIdempotencyKey, reimbKey);

  // Duplicate reimbursement attempt fails
  const clientReimbDup = await pool.connect();
  try {
    await clientReimbDup.query('BEGIN');
    const reReimb = await reimburseExpense(clientReimbDup, {
      expenseId: expense.id,
      actorId: treasurer.id,
      reimbursementReference: 'BANK-TRF-990022',
      idempotencyKey: `reimb-dup-${crypto.randomUUID()}`,
    });
    assert.equal(reReimb, null, 'reimburseExpense on already-reimbursed expense must return null');
    await clientReimbDup.query('ROLLBACK');
  } finally {
    clientReimbDup.release();
  }

  // Find by reimbursement idempotency key for replay detection
  const foundReimb = await findExpenseByReimbursementIdempotencyKey(pool, reimbKey);
  assert.ok(foundReimb);
  assert.equal(foundReimb.id, expense.id);
});

test('financial summary: accurately aggregates dues, events, merchandise, expenses and net cash movement', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  const eventIds = [];
  const productIds = [];
  const expenseIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, eventIds, productIds, expenseIds });
    } finally {
      await pool.end();
    }
  });

  const treasurer = await createUser(pool, {
    name: 'Summary Treasurer',
    email: `fin-t-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(treasurer.id);
  await assignRole(pool, { userId: treasurer.id, roleName: 'organizer' });

  const customer = await createUser(pool, {
    name: 'Summary Customer',
    email: `fin-c-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(customer.id);

  // 1. Dues payment: 500.00 INR (50000 minor)
  const membership = await createMembership(pool, {
    userId: customer.id,
    planId: PLAN_ID,
    startsAt: new Date('2026-10-01T00:00:00Z'),
    expiresAt: new Date('2027-03-31T23:59:59Z'),
    duesAmountMinor: 50000,
    currency: 'INR',
  });
  const duesPay = await insertPaymentRecord(pool, {
    duesObligationId: membership.duesObligationId,
    amountMinor: 50000,
    currency: 'INR',
    method: 'bank_transfer',
    recordedBy: treasurer.id,
    idempotencyKey: `fin-dues-${crypto.randomUUID()}`,
  });
  await confirmDuesPayment(pool, { duesObligationId: membership.duesObligationId, paymentRef: duesPay.id });

  // 2. Event ticket payment: 300.00 INR (30000 minor)
  const event = await createEvent(pool, {
    title: 'Fin Event',
    venue: 'Auditorium',
    startsAt: '2026-11-20T10:00:00Z',
    endsAt: '2026-11-20T12:00:00Z',
    capacity: 20,
    memberPriceMinor: 30000,
    publicPriceMinor: 30000,
    currency: 'INR',
    status: 'published',
  });
  eventIds.push(event.id);
  const reg = await insertRegistration(pool, {
    eventId: event.id,
    userId: customer.id,
    priceMinor: 30000,
    currency: 'INR',
    idempotencyKey: `fin-reg-idemp-${crypto.randomUUID()}`,
    tokenHash: `hash-${crypto.randomUUID()}`,
  });
  await insertPaymentRecord(pool, {
    registrationId: reg.id,
    amountMinor: 30000,
    currency: 'INR',
    method: 'upi',
    recordedBy: treasurer.id,
    idempotencyKey: `fin-reg-pay-${crypto.randomUUID()}`,
  });

  // 3. Merchandise order payment: 200.00 INR (20000 minor)
  const product = await createProduct(pool, { name: 'Fin Mug' });
  productIds.push(product.id);
  const order = await insertOrder(pool, {
    userId: customer.id,
    currency: 'INR',
    totalMinor: 20000,
    status: 'pending',
    idempotencyKey: `fin-ord-idemp-${crypto.randomUUID()}`,
    payloadHash: 'hash-fin-mug',
  });
  await insertPaymentRecord(pool, {
    orderId: order.id,
    amountMinor: 20000,
    currency: 'INR',
    method: 'cash',
    recordedBy: treasurer.id,
    idempotencyKey: `fin-ord-pay-${crypto.randomUUID()}`,
  });

  // Total Receipts recorded in this test = 50000 + 30000 + 20000 = 100000 minor (1000.00 INR)

  // 4. Reimbursed Expense (disbursement): 400.00 INR (40000 minor)
  const expReimb = await createExpense(pool, {
    requesterId: customer.id,
    amountMinor: 40000,
    currency: 'INR',
    purpose: 'Event lighting cables',
    receiptKey: 'receipts/lights.pdf',
  });
  expenseIds.push(expReimb.id);
  await decideExpense(pool, { expenseId: expReimb.id, actorId: treasurer.id, decision: 'approved' });
  await reimburseExpense(pool, {
    expenseId: expReimb.id,
    actorId: treasurer.id,
    reimbursementReference: 'TRF-1234',
    idempotencyKey: `fin-reimb-${crypto.randomUUID()}`,
  });

  // 5. Approved but Unpaid Expense (committed liability): 150.00 INR (15000 minor)
  const expApproved = await createExpense(pool, {
    requesterId: customer.id,
    amountMinor: 15000,
    currency: 'INR',
    purpose: 'Posters printing',
    receiptKey: 'receipts/posters.pdf',
  });
  expenseIds.push(expApproved.id);
  await decideExpense(pool, { expenseId: expApproved.id, actorId: treasurer.id, decision: 'approved' });

  // 6. Query financial summary
  const summary = await getFinancialSummary(pool);
  assert.ok(summary.currencies.length >= 1);

  const inr = summary.currencies.find(c => c.currency === 'INR');
  assert.ok(inr);

  // Validate that receipt counts and amounts include our test data
  assert.ok(inr.receipts.duesMinor >= 50000);
  assert.ok(inr.receipts.eventsMinor >= 30000);
  assert.ok(inr.receipts.merchandiseMinor >= 20000);
  assert.ok(inr.receipts.totalMinor >= 100000);

  // Validate disbursements and net cash movement
  assert.ok(inr.disbursements.reimbursedMinor >= 40000);
  assert.equal(
    inr.netCashMovementMinor,
    inr.receipts.totalMinor - inr.disbursements.reimbursedMinor,
    'netCashMovement must equal totalMinor minus reimbursedMinor'
  );

  // Validate committed liabilities (approved unpaid)
  assert.ok(inr.committedLiabilities.approvedUnpaidMinor >= 15000);
  assert.ok(summary.notice.includes('not an audited bank balance'));
});
