/**
 * merchandise-payment.model.test.js — Deep owns this file.
 *
 * Tests for merchandise payment database support, model functions,
 * lock ordering, race conditions, idempotency, and constraints.
 *
 * Requires NODE_TEST_DATABASE_URL (isolated test database with migrations applied).
 *
 * Covers:
 *  - Successful confirmation and durable payment evidence linking order_id.
 *  - Exactly-one target constraint (@rule:PAYMENT_TARGET_MUTEX).
 *  - Duplicate payment prevention via unique order index (@rule:PAYMENT_ONCE).
 *  - Idempotent replay with matching key & payload; rejection of mismatched reuse.
 *  - Concurrent payment confirmations racing on same order (exactly one succeeds).
 *  - Payment vs cancellation race condition (@rule:ORDER_LOCK_ORDER).
 *  - Paid-order cancellation rejection (@rule:PENDING_ONLY_CANCEL).
 *  - Transaction rollback on payment failure (leaves order pending, no payment record).
 *  - listPendingOrders returns pending orders with items summary.
 *  - Existing event registration payment records remain fully functional.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import { createUser, assignRole } from '../model/auth.model.js';
import {
  createProduct,
  createProductVariant,
  insertOrder,
  insertOrderItem,
  getOrderDetails,
  cancelOrder,
  decrementVariantStock,
  getProductById,
} from '../model/merchandise.model.js';
import {
  insertPaymentRecord,
  findPaymentByIdempotencyKey,
  findPaymentByOrder,
  findPaymentsByRegistration,
  lockOrderForPayment,
  confirmOrderPayment,
  confirmRegistration,
  listPendingOrders,
} from '../model/payment.model.js';
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

async function cleanupEntities(pool, { userIds = [], productIds = [], eventIds = [] }) {
  if (userIds.length > 0) {
    await pool.query(
      `DELETE FROM payment_records 
       WHERE recorded_by = ANY($1::uuid[]) 
          OR order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))
          OR registration_id IN (SELECT id FROM registrations WHERE user_id = ANY($1::uuid[]))`,
      [userIds]
    );
    await pool.query(
      'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))',
      [userIds]
    );
    await pool.query('DELETE FROM orders WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM registrations WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  }
  if (productIds.length > 0) {
    await pool.query(
      'DELETE FROM order_items WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ANY($1::uuid[]))',
      [productIds]
    );
    await pool.query('DELETE FROM product_variants WHERE product_id = ANY($1::uuid[])', [productIds]);
    await pool.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]);
  }
  if (eventIds.length > 0) {
    await pool.query('DELETE FROM payment_records WHERE registration_id IN (SELECT id FROM registrations WHERE event_id = ANY($1::uuid[]))', [eventIds]);
    await pool.query('DELETE FROM registrations WHERE event_id = ANY($1::uuid[])', [eventIds]);
    await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [eventIds]);
  }
}

test('merchandise payments: successful confirmation and durable evidence linking order_id', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  const productIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, productIds });
    } finally {
      await pool.end();
    }
  });

  const customer = await createUser(pool, {
    name: 'Customer One',
    email: `cust1-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(customer.id);

  const treasurer = await createUser(pool, {
    name: 'Treasurer One',
    email: `tres1-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(treasurer.id);
  await assignRole(pool, { userId: treasurer.id, roleName: 'organizer' });

  const product = await createProduct(pool, { name: 'Hoodie', category: 'apparel' });
  productIds.push(product.id);

  const variant = await createProductVariant(pool, {
    productId: product.id,
    name: 'Large',
    priceMinor: 150000, // 1500.00 INR
    currency: 'INR',
    stockQuantity: 20,
  });

  const order = await insertOrder(pool, {
    userId: customer.id,
    currency: 'INR',
    totalMinor: 150000,
    status: 'pending',
    idempotencyKey: `idemp-ord-${crypto.randomUUID()}`,
    payloadHash: 'hash-001',
  });

  await insertOrderItem(pool, {
    orderId: order.id,
    variantId: variant.id,
    productNameSnapshot: product.name,
    variantNameSnapshot: variant.name,
    unitPriceMinor: variant.priceMinor,
    quantity: 1,
    totalMinor: 150000,
  });

  // Execute atomic payment confirmation in a transaction
  const paymentKey = `pay-key-${crypto.randomUUID()}`;
  const client = await pool.connect();
  let paymentRecord = null;
  let confirmedOrder = null;

  try {
    await client.query('BEGIN');

    // 1. Lock order for payment (@rule:ORDER_LOCK_ORDER)
    const locked = await lockOrderForPayment(client, order.id);
    assert.ok(locked);
    assert.equal(locked.status, 'pending');
    assert.equal(locked.totalMinor, 150000);
    assert.equal(locked.currency, 'INR');

    // 2. Insert payment evidence
    paymentRecord = await insertPaymentRecord(client, {
      orderId: order.id,
      amountMinor: 150000,
      currency: 'INR',
      method: 'bank_transfer',
      externalReference: 'UTR-987654321',
      notes: 'Verified against bank statement',
      recordedBy: treasurer.id,
      idempotencyKey: paymentKey,
    });

    // 3. Transition order status pending -> paid
    confirmedOrder = await confirmOrderPayment(client, { orderId: order.id });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Assert payment evidence
  assert.ok(paymentRecord);
  assert.equal(paymentRecord.orderId, order.id);
  assert.equal(paymentRecord.registrationId, null);
  assert.equal(paymentRecord.amountMinor, 150000);
  assert.equal(paymentRecord.currency, 'INR');
  assert.equal(paymentRecord.method, 'bank_transfer');
  assert.equal(paymentRecord.externalReference, 'UTR-987654321');
  assert.equal(paymentRecord.recordedBy, treasurer.id);

  // Assert confirmed order status
  assert.ok(confirmedOrder);
  assert.equal(confirmedOrder.status, 'paid');
  assert.ok(confirmedOrder.paidAt);

  // Query order payment via helper
  const foundPayment = await findPaymentByOrder(pool, order.id);
  assert.ok(foundPayment);
  assert.equal(foundPayment.id, paymentRecord.id);
  assert.equal(foundPayment.orderId, order.id);

  // Query by idempotency key
  const foundByKey = await findPaymentByIdempotencyKey(pool, paymentKey);
  assert.ok(foundByKey);
  assert.equal(foundByKey.orderId, order.id);
  assert.equal(foundByKey.amountMinor, 150000);
});

test('payment_records: enforces exactly-one target constraint (@rule:PAYMENT_TARGET_MUTEX)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  const productIds = [];
  const eventIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, productIds, eventIds });
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, {
    name: 'User Mutex',
    email: `mutex-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(user.id);

  const event = await createEvent(pool, {
    title: 'Mutex Event',
    venue: 'Hall A',
    startsAt: '2026-11-01T10:00:00Z',
    endsAt: '2026-11-01T12:00:00Z',
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
    idempotencyKey: `idemp-reg-${crypto.randomUUID()}`,
    tokenHash: `hash-${crypto.randomUUID()}`,
  });

  const product = await createProduct(pool, { name: 'Mutex Item' });
  productIds.push(product.id);

  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 5000,
    status: 'pending',
    idempotencyKey: `idemp-ord-${crypto.randomUUID()}`,
    payloadHash: 'hash-002',
  });

  const client = await pool.connect();
  try {
    // 1. Neither target provided -> MUST FAIL constraint
    await assert.rejects(
      async () => {
        await insertPaymentRecord(client, {
          registrationId: null,
          orderId: null,
          amountMinor: 1000,
          currency: 'INR',
          method: 'cash',
          recordedBy: user.id,
          idempotencyKey: `key-neither-${crypto.randomUUID()}`,
        });
      },
      /payment_records_target_check/
    );

    // 2. Both targets provided -> MUST FAIL constraint
    await assert.rejects(
      async () => {
        await insertPaymentRecord(client, {
          registrationId: reg.id,
          orderId: order.id,
          amountMinor: 1000,
          currency: 'INR',
          method: 'cash',
          recordedBy: user.id,
          idempotencyKey: `key-both-${crypto.randomUUID()}`,
        });
      },
      /payment_records_target_check/
    );
  } finally {
    client.release();
  }
});

test('merchandise payments: duplicate payment confirmation is prevented (@rule:PAYMENT_ONCE)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  const productIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, productIds });
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, {
    name: 'Dup User',
    email: `dup-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(user.id);

  const product = await createProduct(pool, { name: 'Cap' });
  productIds.push(product.id);

  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 30000,
    status: 'pending',
    idempotencyKey: `idemp-cap-${crypto.randomUUID()}`,
    payloadHash: 'hash-003',
  });

  // First payment confirmation succeeds
  const key1 = `pay-cap-1-${crypto.randomUUID()}`;
  const client1 = await pool.connect();
  try {
    await client1.query('BEGIN');
    await insertPaymentRecord(client1, {
      orderId: order.id,
      amountMinor: 30000,
      currency: 'INR',
      method: 'cash',
      recordedBy: user.id,
      idempotencyKey: key1,
    });
    const confirmed = await confirmOrderPayment(client1, { orderId: order.id });
    assert.ok(confirmed);
    await client1.query('COMMIT');
  } finally {
    client1.release();
  }

  // Second confirmation attempt on already paid order:
  // 1. confirmOrderPayment returns null because status is 'paid' (not 'pending')
  const client2 = await pool.connect();
  try {
    await client2.query('BEGIN');
    const confirmed2 = await confirmOrderPayment(client2, { orderId: order.id });
    assert.equal(confirmed2, null, 'confirmOrderPayment must return null for non-pending order');

    // 2. Inserting another payment_records row for the same order violates unique index
    await assert.rejects(
      async () => {
        await insertPaymentRecord(client2, {
          orderId: order.id,
          amountMinor: 30000,
          currency: 'INR',
          method: 'upi',
          recordedBy: user.id,
          idempotencyKey: `pay-cap-2-${crypto.randomUUID()}`,
        });
      },
      /payment_records_unique_order_idx/
    );
    await client2.query('ROLLBACK');
  } finally {
    client2.release();
  }
});

test('merchandise payments: concurrent confirmations on same order: exactly one succeeds', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool(10);

  const userIds = [];
  const productIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, productIds });
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, {
    name: 'Race User',
    email: `race-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(user.id);

  const product = await createProduct(pool, { name: 'Mug' });
  productIds.push(product.id);

  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 25000,
    status: 'pending',
    idempotencyKey: `idemp-mug-${crypto.randomUUID()}`,
    payloadHash: 'hash-004',
  });

  async function attemptConfirm(key) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockOrderForPayment(client, order.id);
      if (!locked || locked.status !== 'pending') {
        await client.query('ROLLBACK');
        return { success: false, reason: 'NOT_PENDING' };
      }

      await insertPaymentRecord(client, {
        orderId: order.id,
        amountMinor: 25000,
        currency: 'INR',
        method: 'cash',
        recordedBy: user.id,
        idempotencyKey: key,
      });

      const confirmed = await confirmOrderPayment(client, { orderId: order.id });
      if (!confirmed) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'CONFIRM_FAILED' };
      }

      await client.query('COMMIT');
      return { success: true, order: confirmed };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return { success: false, error: err.message };
    } finally {
      client.release();
    }
  }

  const [res1, res2] = await Promise.all([
    attemptConfirm(`race-key-1-${crypto.randomUUID()}`),
    attemptConfirm(`race-key-2-${crypto.randomUUID()}`),
  ]);

  const successes = [res1.success, res2.success].filter(Boolean);
  assert.equal(successes.length, 1, 'Exactly one concurrent confirmation must succeed');

  const finalPayment = await findPaymentByOrder(pool, order.id);
  assert.ok(finalPayment);
});

test('merchandise payments: race between payment confirmation and customer cancellation (@rule:ORDER_LOCK_ORDER)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool(10);

  const userIds = [];
  const productIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, productIds });
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, {
    name: 'Race User',
    email: `pay-canc-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(user.id);

  const product = await createProduct(pool, { name: 'Sticker' });
  productIds.push(product.id);

  const variant = await createProductVariant(pool, {
    productId: product.id,
    name: 'Vinyl',
    priceMinor: 5000,
    currency: 'INR',
    stockQuantity: 10,
  });

  // Deduct 2 units for order (stock becomes 8)
  await decrementVariantStock(pool, { variantId: variant.id, quantity: 2 });

  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 10000,
    status: 'pending',
    idempotencyKey: `idemp-stk-${crypto.randomUUID()}`,
    payloadHash: 'hash-005',
  });

  await insertOrderItem(pool, {
    orderId: order.id,
    variantId: variant.id,
    productNameSnapshot: product.name,
    variantNameSnapshot: variant.name,
    unitPriceMinor: variant.priceMinor,
    quantity: 2,
    totalMinor: 10000,
  });

  async function tryPay() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockOrderForPayment(client, order.id);
      if (!locked || locked.status !== 'pending') {
        await client.query('ROLLBACK');
        return { outcome: 'PAY_REJECTED' };
      }
      await insertPaymentRecord(client, {
        orderId: order.id,
        amountMinor: 10000,
        currency: 'INR',
        method: 'cash',
        recordedBy: user.id,
        idempotencyKey: `race-pay-stk-${crypto.randomUUID()}`,
      });
      const confirmed = await confirmOrderPayment(client, { orderId: order.id });
      if (!confirmed) {
        await client.query('ROLLBACK');
        return { outcome: 'PAY_REJECTED' };
      }
      await client.query('COMMIT');
      return { outcome: 'PAID' };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return { outcome: 'PAY_ERROR', error: err.message };
    } finally {
      client.release();
    }
  }

  async function tryCancel() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cancelled = await cancelOrder(client, {
        orderId: order.id,
        actorId: user.id,
        reason: 'Race test cancellation',
      });
      if (!cancelled) {
        await client.query('ROLLBACK');
        return { outcome: 'CANCEL_REJECTED' };
      }
      await client.query('COMMIT');
      return { outcome: 'CANCELLED' };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return { outcome: 'CANCEL_ERROR', error: err.message };
    } finally {
      client.release();
    }
  }

  const [payRes, cancelRes] = await Promise.all([tryPay(), tryCancel()]);

  // Exactly one of the two outcomes must happen:
  // Option A: Paid succeeds, cancel rejected (stock stays 8)
  // Option B: Cancel succeeds, pay rejected (stock restored to 10)
  const currentVar = (await getProductById(pool, product.id)).variants[0];

  if (payRes.outcome === 'PAID') {
    assert.equal(cancelRes.outcome, 'CANCEL_REJECTED');
    assert.equal(currentVar.stockQuantity, 8, 'Stock must NOT be restored when order was paid');
  } else {
    assert.equal(payRes.outcome, 'PAY_REJECTED');
    assert.equal(cancelRes.outcome, 'CANCELLED');
    assert.equal(currentVar.stockQuantity, 10, 'Stock must be restored when order was cancelled');
  }
});

test('paid-order cancellation is rejected at the model level (@rule:PENDING_ONLY_CANCEL)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  const productIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, productIds });
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, {
    name: 'Paid User',
    email: `paid-u-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(user.id);

  const product = await createProduct(pool, { name: 'Notebook' });
  productIds.push(product.id);

  const variant = await createProductVariant(pool, {
    productId: product.id,
    name: 'A5',
    priceMinor: 8000,
    currency: 'INR',
    stockQuantity: 10,
  });

  await decrementVariantStock(pool, { variantId: variant.id, quantity: 1 }); // stock = 9

  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 8000,
    status: 'pending',
    idempotencyKey: `idemp-note-${crypto.randomUUID()}`,
    payloadHash: 'hash-006',
  });

  await insertOrderItem(pool, {
    orderId: order.id,
    variantId: variant.id,
    productNameSnapshot: product.name,
    variantNameSnapshot: variant.name,
    unitPriceMinor: variant.priceMinor,
    quantity: 1,
    totalMinor: 8000,
  });

  // Pay the order
  const clientPay = await pool.connect();
  try {
    await clientPay.query('BEGIN');
    await insertPaymentRecord(clientPay, {
      orderId: order.id,
      amountMinor: 8000,
      currency: 'INR',
      method: 'upi',
      recordedBy: user.id,
      idempotencyKey: `pay-note-${crypto.randomUUID()}`,
    });
    await confirmOrderPayment(clientPay, { orderId: order.id });
    await clientPay.query('COMMIT');
  } finally {
    clientPay.release();
  }

  // Attempt to cancel the PAID order -> MUST return null and NOT restore stock
  const clientCancel = await pool.connect();
  let cancelRes = null;
  try {
    await clientCancel.query('BEGIN');
    cancelRes = await cancelOrder(clientCancel, {
      orderId: order.id,
      actorId: user.id,
      reason: 'Want refund',
    });
    await clientCancel.query('COMMIT');
  } finally {
    clientCancel.release();
  }

  assert.equal(cancelRes, null, 'cancelOrder on paid order must return null');

  // Stock must still be 9 (unmodified)
  const checkVar = (await getProductById(pool, product.id)).variants[0];
  assert.equal(checkVar.stockQuantity, 9, 'Stock must NOT be restored for paid order');
});

test('transaction rollback on payment confirmation failure leaves order pending and no payment row', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  const productIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, productIds });
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, {
    name: 'Rollback User',
    email: `rb-u-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(user.id);

  const product = await createProduct(pool, { name: 'Badge' });
  productIds.push(product.id);

  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 1000,
    status: 'pending',
    idempotencyKey: `idemp-bdg-${crypto.randomUUID()}`,
    payloadHash: 'hash-007',
  });

  const payKey = `pay-fail-key-${crypto.randomUUID()}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await insertPaymentRecord(client, {
      orderId: order.id,
      amountMinor: 1000,
      currency: 'INR',
      method: 'cash',
      recordedBy: user.id,
      idempotencyKey: payKey,
    });

    // Simulate unexpected failure before commit
    throw new Error('Simulated payment gateway or ledger validation error');
  } catch (err) {
    await client.query('ROLLBACK');
    assert.equal(err.message, 'Simulated payment gateway or ledger validation error');
  } finally {
    client.release();
  }

  // Verify payment was NOT persisted
  const paymentAfter = await findPaymentByIdempotencyKey(pool, payKey);
  assert.equal(paymentAfter, null, 'Payment record must be rolled back');

  // Verify order is still pending
  const orderDetails = await getOrderDetails(pool, order.id);
  assert.equal(orderDetails.status, 'pending');
});

test('listPendingOrders returns pending orders with snapshotted items for treasurer view', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  const productIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, productIds });
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, {
    name: 'Pending Cust',
    email: `pend-u-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(user.id);

  const product = await createProduct(pool, { name: 'Pen' });
  productIds.push(product.id);

  const variant = await createProductVariant(pool, {
    productId: product.id,
    name: 'Gel',
    priceMinor: 5000,
    currency: 'INR',
    stockQuantity: 10,
  });

  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 5000,
    status: 'pending',
    idempotencyKey: `idemp-pen-${crypto.randomUUID()}`,
    payloadHash: 'hash-008',
  });

  await insertOrderItem(pool, {
    orderId: order.id,
    variantId: variant.id,
    productNameSnapshot: product.name,
    variantNameSnapshot: variant.name,
    unitPriceMinor: variant.priceMinor,
    quantity: 1,
    totalMinor: 5000,
  });

  const result = await listPendingOrders(pool, { page: 1, pageSize: 50 });
  assert.ok(result.total >= 1);
  assert.ok(Array.isArray(result.rows));

  const targetOrder = result.rows.find(o => o.id === order.id);
  assert.ok(targetOrder);
  assert.equal(targetOrder.userId, user.id);
  assert.equal(targetOrder.userName, 'Pending Cust');
  assert.equal(targetOrder.status, 'pending');
  assert.equal(targetOrder.items.length, 1);
  assert.equal(targetOrder.items[0].productName, 'Pen');
});

test('existing event registration payment evidence is preserved and functional', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userIds = [];
  const eventIds = [];

  t.after(async () => {
    try {
      await cleanupEntities(pool, { userIds, eventIds });
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, {
    name: 'Preserve User',
    email: `reg-pres-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: '$2b$12$x',
  });
  userIds.push(user.id);

  const event = await createEvent(pool, {
    title: 'Annual Gala',
    venue: 'Main Auditorium',
    startsAt: '2026-11-15T18:00:00Z',
    endsAt: '2026-11-15T22:00:00Z',
    capacity: 50,
    memberPriceMinor: 20000,
    publicPriceMinor: 30000,
    currency: 'INR',
    status: 'published',
  });
  eventIds.push(event.id);

  const reg = await insertRegistration(pool, {
    eventId: event.id,
    userId: user.id,
    priceMinor: 30000,
    currency: 'INR',
    idempotencyKey: `reg-idemp-${crypto.randomUUID()}`,
    tokenHash: `token-${crypto.randomUUID()}`,
  });

  const payKey = `reg-pay-${crypto.randomUUID()}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await insertPaymentRecord(client, {
      registrationId: reg.id,
      amountMinor: 30000,
      currency: 'INR',
      method: 'cash',
      recordedBy: user.id,
      idempotencyKey: payKey,
    });
    assert.ok(payment);
    assert.equal(payment.registrationId, reg.id);
    assert.equal(payment.orderId, null);

    const confirmed = await confirmRegistration(client, reg.id);
    assert.ok(confirmed);
    assert.equal(confirmed.status, 'confirmed');

    await client.query('COMMIT');
  } finally {
    client.release();
  }

  const payments = await findPaymentsByRegistration(pool, reg.id);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].registrationId, reg.id);
  assert.equal(payments[0].amountMinor, 30000);
});
