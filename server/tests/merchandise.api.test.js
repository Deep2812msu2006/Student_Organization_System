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
  findOrderById,
  getProductById,
} from '../model/merchandise.model.js';

const databaseUrl = process.env.NODE_TEST_DATABASE_URL;

test('merchandise API: catalog, ordering, idempotency, stock allocation, tamper rejection and cancellation', { skip: !databaseUrl }, async t => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const config = {
    sessionSecret: randomBytes(32).toString('hex'),
    ticketSecret: randomBytes(32).toString('hex'),
  };
  const server = createApp({ configured: true, pool }, config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const prefix = `m-${randomUUID().slice(0, 8)}`;
  const userIds = [];
  const productIds = [];

  t.after(async () => {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
    try {
      if (productIds.length > 0) {
        await pool.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]);
      }
      if (userIds.length > 0) {
        await pool.query("DELETE FROM sessions WHERE sess->>'userId' = ANY($1::text[])", [userIds]);
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
      }
    } finally {
      await pool.end();
    }
  });

  function agent() {
    let cookie = '', csrf = '';
    const fn = async (path, method = 'GET', body, headers = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrf,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
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

  async function account(label, role = 'member') {
    const email = `${prefix}-${label}@example.test`;
    const password = 'Testing-merch-password1!';
    const user = await createUser(pool, { name: label, email, passwordHash: await bcrypt.hash(password, 4) });
    userIds.push(user.id);
    await assignRole(pool, { userId: user.id, roleName: role });
    const call = agent();
    await call('/auth/csrf');
    const loginRes = await call('/auth/login', 'POST', { email, password });
    assert.equal(loginRes.status, 200);
    return { call, id: user.id };
  }

  const customer1 = await account('customer1');
  const customer2 = await account('customer2');
  const anonymous = agent();

  // Create test products and variants directly via model
  const prod1 = await createProduct(pool, {
    name: `${prefix} T-Shirt`,
    description: 'High quality cotton tee',
    category: 'apparel',
    isPublished: true,
  });
  productIds.push(prod1.id);

  const var1Medium = await createProductVariant(pool, {
    productId: prod1.id,
    name: 'Medium',
    sku: `${prefix}-TSHIRT-M`,
    priceMinor: 50000, // 500.00 INR
    currency: 'INR',
    stockQuantity: 10,
    isActive: true,
  });

  const var1Large = await createProductVariant(pool, {
    productId: prod1.id,
    name: 'Large',
    sku: `${prefix}-TSHIRT-L`,
    priceMinor: 55000, // 550.00 INR
    currency: 'INR',
    stockQuantity: 1, // Only 1 in stock for concurrency test!
    isActive: true,
  });

  // 1. Catalog browsing
  const catalogRes = await anonymous('/products');
  assert.equal(catalogRes.status, 200);
  assert.ok(Array.isArray(catalogRes.data));

  const prodDetail = await anonymous(`/products/${prod1.id}`);
  assert.equal(prodDetail.status, 200);
  assert.equal(prodDetail.data.name, `${prefix} T-Shirt`);
  assert.equal(prodDetail.data.variants.length, 2);

  // 2. Authentication and CSRF requirement for ordering
  const validKey = randomUUID().replace(/-/g, '') + '123456';
  const orderPayload = {
    items: [{ variantId: var1Medium.id, quantity: 2 }],
  };

  // Unauthenticated order must fail (401)
  const unauthRes = await anonymous('/orders', 'POST', orderPayload, { 'Idempotency-Key': validKey });
  assert.equal(unauthRes.status, 401);

  // Missing CSRF must fail (403)
  const noCsrfAgent = agent();
  const unauthCsrfRes = await noCsrfAgent('/orders', 'POST', orderPayload, {
    'Idempotency-Key': validKey,
    Cookie: customer1.call.getCookie(), // authenticated cookie without X-CSRF-Token
  });
  assert.equal(unauthCsrfRes.status, 403);

  // Missing or invalid idempotency key must fail (400)
  const noKeyRes = await customer1.call('/orders', 'POST', orderPayload);
  assert.equal(noKeyRes.status, 400);

  const shortKeyRes = await customer1.call('/orders', 'POST', orderPayload, { 'Idempotency-Key': 'short' });
  assert.equal(shortKeyRes.status, 400);

  // 3. Client tampering: Reject client-supplied prices, statuses, or user IDs (400)
  const tamperedPrice = await customer1.call(
    '/orders',
    'POST',
    { items: [{ variantId: var1Medium.id, quantity: 1, priceMinor: 10 }] },
    { 'Idempotency-Key': validKey }
  );
  assert.equal(tamperedPrice.status, 400);

  const tamperedStatus = await customer1.call(
    '/orders',
    'POST',
    { items: [{ variantId: var1Medium.id, quantity: 1 }], status: 'paid' },
    { 'Idempotency-Key': validKey }
  );
  assert.equal(tamperedStatus.status, 400);

  // 4. Successful order placement (starts in pending status)
  const order1Res = await customer1.call('/orders', 'POST', orderPayload, { 'Idempotency-Key': validKey });
  assert.equal(order1Res.status, 201);
  assert.equal(order1Res.replayed, false);
  assert.equal(order1Res.data.status, 'pending');
  assert.equal(order1Res.data.totalMinor, 100000); // 2 * 50000
  assert.equal(order1Res.data.items.length, 1);
  assert.equal(order1Res.data.items[0].variantName, 'Medium');
  assert.equal(order1Res.data.items[0].unitPriceMinor, 50000);

  const order1Id = order1Res.data.id;

  // Verify stock was decremented from 10 to 8
  const refreshedProd = await getProductById(pool, prod1.id);
  const refreshedVarM = refreshedProd.variants.find(v => v.id === var1Medium.id);
  assert.equal(refreshedVarM.stockQuantity, 8);

  // 5. Idempotent replay: exact same payload and key returns 200 with replayed: true
  const replayRes = await customer1.call('/orders', 'POST', orderPayload, { 'Idempotency-Key': validKey });
  assert.equal(replayRes.status, 200);
  assert.equal(replayRes.replayed, true);
  assert.equal(replayRes.data.id, order1Id);

  // 6. Changed payload with reused key must conflict (409)
  const conflictPayload = {
    items: [{ variantId: var1Medium.id, quantity: 1 }],
  };
  const conflictRes = await customer1.call('/orders', 'POST', conflictPayload, { 'Idempotency-Key': validKey });
  assert.equal(conflictRes.status, 409);

  // 7. Concurrent checkout race for last remaining item (stock = 1)
  const keyCust1 = randomUUID().replace(/-/g, '') + 'c11111';
  const keyCust2 = randomUUID().replace(/-/g, '') + 'c22222';
  const lastItemPayload = { items: [{ variantId: var1Large.id, quantity: 1 }] };

  const [raceRes1, raceRes2] = await Promise.all([
    customer1.call('/orders', 'POST', lastItemPayload, { 'Idempotency-Key': keyCust1 }),
    customer2.call('/orders', 'POST', lastItemPayload, { 'Idempotency-Key': keyCust2 }),
  ]);

  const statuses = [raceRes1.status, raceRes2.status].sort();
  assert.deepEqual(statuses, [201, 409], 'Exactly one customer gets the item (201), the other receives 409');

  // Verify stock cannot go negative
  const refreshedVarL = (await getProductById(pool, prod1.id)).variants.find(v => v.id === var1Large.id);
  assert.equal(refreshedVarL.stockQuantity, 0);

  // Subsequent checkout for 0 stock must fail
  const keyAfter = randomUUID().replace(/-/g, '') + 'after0';
  const afterSoldOutRes = await customer1.call('/orders', 'POST', lastItemPayload, { 'Idempotency-Key': keyAfter });
  assert.equal(afterSoldOutRes.status, 409);

  // 8. Order ownership checks:
  // customer1 can view their own order
  const orderDetailRes = await customer1.call(`/orders/${order1Id}`);
  assert.equal(orderDetailRes.status, 200);
  assert.equal(orderDetailRes.data.id, order1Id);

  // customer2 CANNOT view customer1's order (404)
  const foreignOrderRes = await customer2.call(`/orders/${order1Id}`);
  assert.equal(foreignOrderRes.status, 404);

  // List customer orders: customer1 sees their orders
  const myOrdersRes = await customer1.call('/orders/me');
  assert.equal(myOrdersRes.status, 200);
  assert.ok(myOrdersRes.data.some(o => o.id === order1Id));

  // 9. Order cancellation restores variant stock (@rule:STOCK_RESTORE_ON_CANCEL)
  // customer2 cannot cancel customer1's order
  const unauthorizedCancel = await customer2.call(`/orders/${order1Id}/cancel`, 'POST', {});
  assert.equal(unauthorizedCancel.status, 403);

  // customer1 cancels order1
  const cancelRes = await customer1.call(`/orders/${order1Id}/cancel`, 'POST', { reason: 'Changed my mind' });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.data.status, 'cancelled');

  // Stock should be restored from 8 back to 10
  const restoredProd = await getProductById(pool, prod1.id);
  const restoredVarM = restoredProd.variants.find(v => v.id === var1Medium.id);
  assert.equal(restoredVarM.stockQuantity, 10);

  // Repeated cancellation must fail (409) and NOT double-restore stock
  const repeatCancel = await customer1.call(`/orders/${order1Id}/cancel`, 'POST', {});
  assert.equal(repeatCancel.status, 409);

  const afterRepeatProd = await getProductById(pool, prod1.id);
  assert.equal(afterRepeatProd.variants.find(v => v.id === var1Medium.id).stockQuantity, 10);
});
