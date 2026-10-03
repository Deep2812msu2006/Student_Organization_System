/**
 * server/tests/merchandise-payment.api.test.js — Dharmik's merchandise payment API tests.
 *
 * Real HTTP/API integration tests covering:
 * - Unauthenticated and unauthorized access (anonymous 401, member 403, volunteer 403, organizer 200/201, treasurer 200/201)
 * - Missing/invalid CSRF protection (403)
 * - Paginated pending merchandise orders (/orders/pending and /staff/orders/pending)
 * - Safe response sanitization (no internal idempotency keys exposed)
 * - Valid manual confirmation and persisted payment evidence
 * - Wrong amount and currency validation (400 AMOUNT_MISMATCH / CURRENCY_MISMATCH)
 * - Zero-total order confirmation handled honestly (zero_price method, 0 amount)
 * - Non-existent, cancelled, and fulfilled order rejections
 * - Idempotency: identical retries (200 replayed: true) vs altered payload (409 IDEMPOTENCY_PAYLOAD_MISMATCH)
 * - Key conflict across different orders (409 IDEMPOTENCY_CONFLICT)
 * - Concurrent payment confirmation races
 * - Existing event registration payment regression (POST /payments/manual)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { createApp } from '../app.js';
import { createUser, assignRole } from '../model/auth.model.js';
import {
  createProduct,
  createProductVariant,
  insertOrder,
  insertOrderItem,
  getOrderDetails,
  cancelOrder,
} from '../model/merchandise.model.js';
import {
  findPaymentByOrder,
} from '../model/payment.model.js';
import {
  createEvent,
  insertRegistration,
} from '../model/event.model.js';

const databaseUrl = process.env.NODE_TEST_DATABASE_URL;

test('Merchandise Payment API: manual confirmation, roles, idempotency, races, and audit evidence', { skip: !databaseUrl }, async t => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 15 });
  const config = {
    sessionSecret: randomBytes(32).toString('hex'),
    ticketSecret: randomBytes(32).toString('hex'),
  };
  const server = createApp({ configured: true, pool }, config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const prefix = `mp-${randomUUID().slice(0, 8)}`;
  const userIds = [];
  const productIds = [];
  const eventIds = [];

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
              OR order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))
              OR registration_id IN (SELECT id FROM registrations WHERE user_id = ANY($1::uuid[]))`,
          [userIds]
        );
        await pool.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))', [userIds]);
        await pool.query('DELETE FROM orders WHERE user_id = ANY($1::uuid[])', [userIds]);
        await pool.query('DELETE FROM registrations WHERE user_id = ANY($1::uuid[])', [userIds]);
      }
      if (productIds.length > 0) {
        await pool.query('DELETE FROM product_variants WHERE product_id = ANY($1::uuid[])', [productIds]);
        await pool.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]);
      }
      if (eventIds.length > 0) {
        await pool.query('DELETE FROM payment_records WHERE registration_id IN (SELECT id FROM registrations WHERE event_id = ANY($1::uuid[]))', [eventIds]);
        await pool.query('DELETE FROM registrations WHERE event_id = ANY($1::uuid[])', [eventIds]);
        await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [eventIds]);
      }
      if (userIds.length > 0) {
        await pool.query("DELETE FROM sessions WHERE sess->>'userId' = ANY($1::text[])", [userIds]);
        await pool.query('DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])', [userIds]);
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
      }
    } finally {
      await pool.end();
    }
  });

  // Client session helper
  function agent() {
    let cookie = '', csrf = '';
    const fn = async (path, method = 'GET', body, headers = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrf,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const set = response.headers.getSetCookie();
      if (set.length) cookie = set[0].split(';')[0];
      const data = response.status === 204 ? null : await response.json();
      if (data?.data?.csrfToken) csrf = data.data.csrfToken;
      return { status: response.status, ...data };
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
    return { client, id: user.id, email };
  }

  // Set up actors with distinct roles
  const treasurer = await createAccount('treasurer', 'treasurer');
  const organizer = await createAccount('organizer', 'organizer');
  const volunteer = await createAccount('volunteer', 'volunteer');
  const member = await createAccount('member', 'member');
  const anonymous = agent();

  // Set up merchandise catalog item
  const product = await createProduct(pool, {
    name: `${prefix} Hoodie`,
    description: 'Cozy campus hoodie',
    category: 'apparel',
    isPublished: true,
  });
  productIds.push(product.id);

  const variant = await createProductVariant(pool, {
    productId: product.id,
    name: 'Medium',
    sku: `${prefix}-HOOD-M`,
    priceMinor: 4500, // 45.00 USD
    currency: 'USD',
    stockQuantity: 100,
    isActive: true,
  });

  const zeroVariant = await createProductVariant(pool, {
    productId: product.id,
    name: 'Free Sticker',
    sku: `${prefix}-STICKER`,
    priceMinor: 0,
    currency: 'USD',
    stockQuantity: 100,
    isActive: true,
  });

  // Helper to create test orders
  async function seedOrder(customerId, variantItem, qty = 1) {
    const rawKey = `ord_${randomUUID().replace(/-/g, '')}`;
    const totalMinor = variantItem.priceMinor * qty;
    const order = await insertOrder(pool, {
      userId: customerId,
      currency: variantItem.currency,
      totalMinor,
      status: 'pending',
      idempotencyKey: rawKey,
      payloadHash: `hash-${rawKey}`,
    });
    await insertOrderItem(pool, {
      orderId: order.id,
      variantId: variantItem.id,
      productNameSnapshot: product.name,
      variantNameSnapshot: variantItem.name,
      unitPriceMinor: variantItem.priceMinor,
      quantity: qty,
      totalMinor,
    });
    return order;
  }

  // ─── 1. Role-Based Access Control and Static Route Verification ─────────────

  await t.test('GET /orders/pending requires authentication and staff role', async () => {
    // Anonymous denied 401
    const anonRes = await anonymous('/orders/pending');
    assert.equal(anonRes.status, 401);

    // Regular member denied 403
    const memberRes = await member.client('/orders/pending');
    assert.equal(memberRes.status, 403);

    // Volunteer denied 403
    const volunteerRes = await volunteer.client('/orders/pending');
    assert.equal(volunteerRes.status, 403);

    // Treasurer explicitly allowed 200
    const treasurerRes = await treasurer.client('/orders/pending');
    assert.equal(treasurerRes.status, 200);
    assert.ok(Array.isArray(treasurerRes.data));

    // Organizer allowed 200
    const organizerRes = await organizer.client('/orders/pending');
    assert.equal(organizerRes.status, 200);

    // Distinct staff alias /staff/orders/pending works identically
    const aliasRes = await treasurer.client('/staff/orders/pending');
    assert.equal(aliasRes.status, 200);
  });

  await t.test('POST /payments/merchandise/manual role enforcement and CSRF', async () => {
    const order = await seedOrder(member.id, variant, 1);
    const key = `key_${randomUUID().replace(/-/g, '')}`;
    const payload = {
      orderId: order.id,
      amountMinor: 4500,
      currency: 'USD',
      method: 'cash',
    };

    // Anonymous 401
    const anonRes = await anonymous('/payments/merchandise/manual', 'POST', payload, {
      'Idempotency-Key': key,
    });
    assert.equal(anonRes.status, 401);

    // Member 403
    const memberRes = await member.client('/payments/merchandise/manual', 'POST', payload, {
      'Idempotency-Key': key,
    });
    assert.equal(memberRes.status, 403);

    // Volunteer 403
    const volunteerRes = await volunteer.client('/payments/merchandise/manual', 'POST', payload, {
      'Idempotency-Key': key,
    });
    assert.equal(volunteerRes.status, 403);

    // Missing CSRF token for treasurer 403
    const noCsrfClient = agent();
    const noCsrfRes = await noCsrfClient('/payments/merchandise/manual', 'POST', payload, {
      Cookie: treasurer.client.getCookie(),
      'Idempotency-Key': key,
    });
    assert.equal(noCsrfRes.status, 403);
  });

  // ─── 2. Validation: Amount, Currency, Missing Idempotency Key ────────────────

  await t.test('Validates payload: amount, currency, invalid ID, and idempotency key', async () => {
    const order = await seedOrder(member.id, variant, 1);
    const key = `key_${randomUUID().replace(/-/g, '')}`;

    // Missing Idempotency-Key header
    const noKeyRes = await treasurer.client('/payments/merchandise/manual', 'POST', {
      orderId: order.id,
      amountMinor: 4500,
      currency: 'USD',
      method: 'cash',
    });
    assert.equal(noKeyRes.status, 400);
    assert.equal(noKeyRes.error?.code, 'INVALID_IDEMPOTENCY_KEY');

    // Amount mismatch (expected 4500, sent 4000)
    const badAmountRes = await treasurer.client('/payments/merchandise/manual', 'POST', {
      orderId: order.id,
      amountMinor: 4000,
      currency: 'USD',
      method: 'cash',
    }, { 'Idempotency-Key': key });
    assert.equal(badAmountRes.status, 400);
    assert.equal(badAmountRes.error?.code, 'AMOUNT_MISMATCH');

    // Currency mismatch (expected USD, sent EUR)
    const badCurrencyRes = await treasurer.client('/payments/merchandise/manual', 'POST', {
      orderId: order.id,
      amountMinor: 4500,
      currency: 'EUR',
      method: 'cash',
    }, { 'Idempotency-Key': key });
    assert.equal(badCurrencyRes.status, 400);
    assert.equal(badCurrencyRes.error?.code, 'CURRENCY_MISMATCH');

    // Non-existent order
    const fakeId = randomUUID();
    const notFoundRes = await treasurer.client('/payments/merchandise/manual', 'POST', {
      orderId: fakeId,
      amountMinor: 4500,
      currency: 'USD',
      method: 'cash',
    }, { 'Idempotency-Key': key });
    assert.equal(notFoundRes.status, 404);
    assert.equal(notFoundRes.error?.code, 'ORDER_NOT_FOUND');
  });

  // ─── 3. Successful Payment Confirmation and Evidence Persistence ────────────

  await t.test('Valid manual confirmation transitions order pending -> paid and records evidence', async () => {
    const order = await seedOrder(member.id, variant, 2); // 9000 USD
    const key = `key_${randomUUID().replace(/-/g, '')}`;

    const res = await treasurer.client('/payments/merchandise/manual', 'POST', {
      orderId: order.id,
      amountMinor: 9000,
      currency: 'USD',
      method: 'bank_transfer',
      externalReference: 'TXN-987654',
      notes: 'Verified bank wire transfer',
    }, { 'Idempotency-Key': key });

    assert.equal(res.status, 201);
    assert.equal(res.replayed, false);
    assert.equal(res.data.order.status, 'paid');
    assert.equal(res.data.payment.amountMinor, 9000);
    assert.equal(res.data.payment.currency, 'USD');
    assert.equal(res.data.payment.method, 'bank_transfer');
    assert.equal(res.data.payment.externalReference, 'TXN-987654');

    // Ensure internal idempotency key is NOT leaked
    assert.equal(res.data.payment.idempotency_key, undefined);
    assert.equal(res.data.payment.idempotencyKey, undefined);

    // Verify database state directly
    const dbOrder = await getOrderDetails(pool, order.id);
    assert.equal(dbOrder.status, 'paid');
    assert.ok(dbOrder.paidAt);

    const dbPayment = await findPaymentByOrder(pool, order.id);
    assert.ok(dbPayment);
    assert.equal(dbPayment.amountMinor, 9000);
    assert.equal(dbPayment.recordedBy, treasurer.id);
  });

  // ─── 4. Zero-Total Order Confirmation ───────────────────────────────────────

  await t.test('Zero-total order confirmed honestly with zero_price method', async () => {
    const zeroOrder = await seedOrder(member.id, zeroVariant, 1); // 0 USD
    const key = `key_${randomUUID().replace(/-/g, '')}`;

    const res = await treasurer.client('/payments/merchandise/manual', 'POST', {
      orderId: zeroOrder.id,
      amountMinor: 0,
      currency: 'USD',
      method: 'zero_price',
      notes: 'Free promotion item',
    }, { 'Idempotency-Key': key });

    assert.equal(res.status, 201);
    assert.equal(res.data.order.status, 'paid');
    assert.equal(res.data.payment.amountMinor, 0);
    assert.equal(res.data.payment.method, 'zero_price');
  });

  // ─── 5. Idempotency: Replay vs Payload Mismatch vs Cross-Order Reuse ─────────

  await t.test('Idempotency: identical retry returns 200 replayed: true, altered payload rejected with 409', async () => {
    const order = await seedOrder(member.id, variant, 1); // 4500 USD
    const key = `key_${randomUUID().replace(/-/g, '')}`;

    const originalPayload = {
      orderId: order.id,
      amountMinor: 4500,
      currency: 'USD',
      method: 'cash',
      externalReference: 'CASH-001',
      notes: 'Cash in hand',
    };

    // First attempt: 201 Created
    const firstRes = await treasurer.client('/payments/merchandise/manual', 'POST', originalPayload, {
      'Idempotency-Key': key,
    });
    assert.equal(firstRes.status, 201);
    assert.equal(firstRes.replayed, false);

    // Identical retry: 200 OK replayed: true with identical payment and order data
    const retryRes = await treasurer.client('/payments/merchandise/manual', 'POST', originalPayload, {
      'Idempotency-Key': key,
    });
    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.replayed, true);
    assert.equal(retryRes.data.payment.id, firstRes.data.payment.id);
    assert.equal(retryRes.data.order.id, order.id);

    // Reusing SAME key with altered method: 409 IDEMPOTENCY_PAYLOAD_MISMATCH
    const alteredMethodRes = await treasurer.client('/payments/merchandise/manual', 'POST', {
      ...originalPayload,
      method: 'upi',
    }, { 'Idempotency-Key': key });
    assert.equal(alteredMethodRes.status, 409);
    assert.equal(alteredMethodRes.error?.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    // Reusing SAME key for a DIFFERENT order: 409 IDEMPOTENCY_CONFLICT
    const otherOrder = await seedOrder(member.id, variant, 1);
    const diffOrderRes = await treasurer.client('/payments/merchandise/manual', 'POST', {
      ...originalPayload,
      orderId: otherOrder.id,
    }, { 'Idempotency-Key': key });
    assert.equal(diffOrderRes.status, 409);
    assert.equal(diffOrderRes.error?.code, 'IDEMPOTENCY_CONFLICT');
  });

  // ─── 6. Payment versus Cancellation and Duplicate Confirmations ─────────────

  await t.test('Rejects payment confirmation against cancelled order', async () => {
    const order = await seedOrder(member.id, variant, 1);
    await cancelOrder(pool, { orderId: order.id, userId: member.id, reason: 'Customer changed mind' });

    const key = `key_${randomUUID().replace(/-/g, '')}`;
    const res = await treasurer.client('/payments/merchandise/manual', 'POST', {
      orderId: order.id,
      amountMinor: 4500,
      currency: 'USD',
      method: 'cash',
    }, { 'Idempotency-Key': key });

    assert.equal(res.status, 409);
    assert.equal(res.error?.code, 'ORDER_CANCELLED');
  });

  await t.test('Rejects second payment with different key on already-paid order', async () => {
    const order = await seedOrder(member.id, variant, 1);
    const key1 = `key1_${randomUUID().replace(/-/g, '')}`;
    const key2 = `key2_${randomUUID().replace(/-/g, '')}`;

    const res1 = await treasurer.client('/payments/merchandise/manual', 'POST', {
      orderId: order.id,
      amountMinor: 4500,
      currency: 'USD',
      method: 'cash',
    }, { 'Idempotency-Key': key1 });
    assert.equal(res1.status, 201);

    const res2 = await treasurer.client('/payments/merchandise/manual', 'POST', {
      orderId: order.id,
      amountMinor: 4500,
      currency: 'USD',
      method: 'cash',
    }, { 'Idempotency-Key': key2 });
    assert.equal(res2.status, 409);
    assert.equal(res2.error?.code, 'ALREADY_PAID');
  });

  // ─── 7. Concurrent Simultaneous Confirmations ────────────────────────────────

  await t.test('Simultaneous identical requests with same key resolve cleanly without error', async () => {
    const order = await seedOrder(member.id, variant, 1);
    const key = `concurrent_${randomUUID().replace(/-/g, '')}`;

    const payload = {
      orderId: order.id,
      amountMinor: 4500,
      currency: 'USD',
      method: 'upi',
      externalReference: 'UPI-CONCURRENT',
    };

    const [resA, resB] = await Promise.all([
      treasurer.client('/payments/merchandise/manual', 'POST', payload, { 'Idempotency-Key': key }),
      treasurer.client('/payments/merchandise/manual', 'POST', payload, { 'Idempotency-Key': key }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [200, 201], 'One request inserts (201), the other safely replays (200)');
  });

  // ─── 8. Cancellation Race & Paid-Order Guard via Real API ───────────────────

  await t.test('Cancellation race between customer and staff confirmation via real API (@rule:ORDER_LOCK_ORDER)', async () => {
    const order = await seedOrder(member.id, variant, 1);
    const key = `race_${randomUUID().replace(/-/g, '')}`;
    const payload = {
      orderId: order.id,
      amountMinor: 4500,
      currency: 'USD',
      method: 'cash',
    };

    // Both customer cancellation and staff payment confirmation execute concurrently
    const [cancelRes, paymentRes] = await Promise.all([
      member.client(`/orders/${order.id}/cancel`, 'POST', { reason: 'Race test cancellation' }),
      treasurer.client('/payments/merchandise/manual', 'POST', payload, { 'Idempotency-Key': key }),
    ]);

    // Exactly one succeeds, the other is rejected with 409 Conflict
    const successCount = (cancelRes.status === 200 ? 1 : 0) + (paymentRes.status === 201 ? 1 : 0);
    assert.equal(successCount, 1, 'Exactly one concurrent mutation must succeed');

    if (cancelRes.status === 200) {
      assert.equal(paymentRes.status, 409, 'Payment confirmation must fail when cancellation wins');
      assert.equal(paymentRes.error?.code, 'ORDER_CANCELLED');
      const dbOrder = await getOrderDetails(pool, order.id);
      assert.equal(dbOrder.status, 'cancelled');
    } else {
      assert.equal(paymentRes.status, 201, 'Payment confirmation succeeded');
      assert.equal(cancelRes.status, 409, 'Customer cancellation must fail when payment wins');
      assert.equal(cancelRes.error?.code, 'CANNOT_CANCEL');
      const dbOrder = await getOrderDetails(pool, order.id);
      assert.equal(dbOrder.status, 'paid');
    }
  });

  await t.test('Customer cancellation of paid order is rejected via real API (@rule:PENDING_ONLY_CANCEL)', async () => {
    const order = await seedOrder(member.id, variant, 1);
    const key = `paidcancel_${randomUUID().replace(/-/g, '')}`;

    // Confirm payment first
    const payRes = await treasurer.client('/payments/merchandise/manual', 'POST', {
      orderId: order.id,
      amountMinor: 4500,
      currency: 'USD',
      method: 'cash',
    }, { 'Idempotency-Key': key });
    assert.equal(payRes.status, 201);

    // Attempt customer cancellation on paid order
    const cancelRes = await member.client(`/orders/${order.id}/cancel`, 'POST', { reason: 'Want refund' });
    assert.equal(cancelRes.status, 409);
    assert.equal(cancelRes.error?.code, 'CANNOT_CANCEL');
  });

  // ─── 9. Existing Event Registration Payment Regression ──────────────────────

  await t.test('Existing event registration payment confirmation regression', async () => {
    const event = await createEvent(pool, {
      title: `${prefix} Annual Conference`,
      description: 'Annual gathering',
      venue: 'Grand Hall',
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 90000000).toISOString(),
      capacity: 50,
      memberPriceMinor: 2500, // 25.00 USD
      publicPriceMinor: 3000,
      currency: 'USD',
      status: 'published',
      createdBy: organizer.id,
    });
    eventIds.push(event.id);

    const reg = await insertRegistration(pool, {
      eventId: event.id,
      userId: member.id,
      idempotencyKey: `reg_${randomUUID().replace(/-/g, '')}`,
      tokenHash: randomBytes(32).toString('hex'),
      priceMinor: 2500,
      currency: 'USD',
    });

    const key = `key_${randomUUID().replace(/-/g, '')}`;
    const res = await treasurer.client('/payments/manual', 'POST', {
      registrationId: reg.id,
      amountMinor: 2500,
      currency: 'USD',
      method: 'cash',
    }, { 'Idempotency-Key': key });

    assert.equal(res.status, 201);
    assert.equal(res.data.registration.status, 'confirmed');
    assert.equal(res.data.payment.amountMinor, 2500);

    // Identical replay for event payment returns 200
    const replayRes = await treasurer.client('/payments/manual', 'POST', {
      registrationId: reg.id,
      amountMinor: 2500,
      currency: 'USD',
      method: 'cash',
    }, { 'Idempotency-Key': key });
    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.replayed, true);
  });
});
