/**
 * merchandise.model.test.js — Deep owns this file.
 *
 * Tests for server/model/merchandise.model.js.
 *
 * Requires NODE_TEST_DATABASE_URL (isolated test database with migrations applied).
 *
 * Covers:
 *  - listPublishedProducts pagination, variants aggregation, category filter.
 *  - getProductById with variants.
 *  - @rule:VARIANT_LOCK_ORDER: deterministic variant row locking.
 *  - @rule:STOCK_DEDUCT_ON_ORDER:
 *      - Concurrent race condition: 2 simultaneous checkouts for last remaining stock (stock = 1);
 *        exactly one succeeds and one fails without overselling or negative stock.
 *      - Multi-item atomic rollback: If one item is out of stock, all items roll back.
 *  - @rule:ORDER_IDEMPOTENCY:
 *      - Idempotent replay with matching payload hash returns existing order.
 *      - Changed payload with reused idempotency key is rejected.
 *  - Price snapshotting: Order item snapshots remain unchanged if variant price changes later.
 *  - @rule:STOCK_RESTORE_ON_CANCEL:
 *      - Cancelling order restores stock.
 *      - Second cancellation attempt returns null and does NOT double-restore stock.
 *  - listUserOrders returns user orders with items snapshot.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import { createUser } from '../model/auth.model.js';
import {
  listPublishedProducts,
  getProductById,
  createProduct,
  createProductVariant,
  lockVariantsForOrder,
  decrementVariantStock,
  insertOrder,
  insertOrderItem,
  findOrderById,
  findOrderByIdempotencyKey,
  getOrderDetails,
  cancelOrder,
  updateOrderStatus,
  listUserOrders,
} from '../model/merchandise.model.js';

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
    connectionTimeoutMillis: 3000,
  });
  pool.on('error', () => {});
  return pool;
}

function hashPayload(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

async function cleanupUser(pool, email) {
  await pool.query(`DELETE FROM users WHERE lower(email) = $1`, [email.toLowerCase()]);
}

async function cleanupProduct(pool, productId) {
  await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);
}

test('listPublishedProducts returns published products with aggregated variants', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'merch-list-test@example.test';
  let p1Id = null;
  let p2Id = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (p1Id) await cleanupProduct(pool, p1Id);
      if (p2Id) await cleanupProduct(pool, p2Id);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, { name: 'Merch Organizer', email: userEmail, passwordHash: '$2b$12$x' });

  // 1 published product with 2 variants
  const p1 = await createProduct(pool, {
    name: 'Test Hoodie',
    description: 'Warm fleece hoodie',
    category: 'apparel',
    isPublished: true,
    createdBy: user.id,
  });
  p1Id = p1.id;

  await createProductVariant(pool, {
    productId: p1.id,
    name: 'Small',
    sku: 'TH-S',
    priceMinor: 100000,
    currency: 'INR',
    stockQuantity: 10,
  });

  await createProductVariant(pool, {
    productId: p1.id,
    name: 'Large',
    sku: 'TH-L',
    priceMinor: 110000,
    currency: 'INR',
    stockQuantity: 0, // out of stock
  });

  // 1 unpublished product
  const p2 = await createProduct(pool, {
    name: 'Secret Item',
    category: 'collectibles',
    isPublished: false,
    createdBy: user.id,
  });
  p2Id = p2.id;

  const result = await listPublishedProducts(pool, { page: 1, pageSize: 50 });
  assert.ok(result.total >= 1);

  const foundP1 = result.rows.find(p => p.id === p1.id);
  assert.ok(foundP1, 'published product must be in list');
  assert.equal(foundP1.variants.length, 2);
  assert.equal(foundP1.variants[0].name, 'Small');
  assert.equal(foundP1.variants[0].inStock, true);
  assert.equal(foundP1.variants[1].name, 'Large');
  assert.equal(foundP1.variants[1].inStock, false);

  const foundP2 = result.rows.find(p => p.id === p2.id);
  assert.equal(foundP2, undefined, 'unpublished product must not be returned');

  // Test category filter
  const apparelResult = await listPublishedProducts(pool, { category: 'apparel' });
  assert.ok(apparelResult.rows.some(p => p.id === p1.id));
});

test('Concurrent checkout race for final stock item: exactly one succeeds (@rule:STOCK_DEDUCT_ON_ORDER)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool(10);

  const u1Email = 'merch-race-1@example.test';
  const u2Email = 'merch-race-2@example.test';
  let productId = null;

  await cleanupUser(pool, u1Email);
  await cleanupUser(pool, u2Email);

  t.after(async () => {
    try {
      if (productId) await cleanupProduct(pool, productId);
      await cleanupUser(pool, u1Email);
      await cleanupUser(pool, u2Email);
    } finally {
      await pool.end();
    }
  });

  const u1 = await createUser(pool, { name: 'Buyer 1', email: u1Email, passwordHash: '$2b$12$x' });
  const u2 = await createUser(pool, { name: 'Buyer 2', email: u2Email, passwordHash: '$2b$12$x' });

  // Product with variant having stock = 1
  const product = await createProduct(pool, {
    name: 'Rare Pin',
    category: 'collectibles',
    isPublished: true,
  });
  productId = product.id;

  const variant = await createProductVariant(pool, {
    productId: product.id,
    name: 'One Size',
    priceMinor: 50000,
    currency: 'INR',
    stockQuantity: 1, // Only 1 in stock!
  });

  // Function representing the order creation service flow:
  async function attemptOrder(buyer, idempKey) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock variants deterministically (@rule:VARIANT_LOCK_ORDER)
      const lockedVariants = await lockVariantsForOrder(client, [variant.id]);
      if (lockedVariants.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'VARIANT_NOT_FOUND' };
      }

      const lockedVar = lockedVariants[0];
      if (lockedVar.stockQuantity < 1) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'INSUFFICIENT_STOCK' };
      }

      // 2. Decrement stock (@rule:STOCK_DEDUCT_ON_ORDER)
      const decremented = await decrementVariantStock(client, { variantId: variant.id, quantity: 1 });
      if (!decremented) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'INSUFFICIENT_STOCK' };
      }

      // 3. Create order + item
      const payload = { userId: buyer.id, items: [{ variantId: variant.id, quantity: 1 }] };
      const order = await insertOrder(client, {
        userId: buyer.id,
        currency: 'INR',
        totalMinor: 50000,
        status: 'pending',
        idempotencyKey: idempKey,
        payloadHash: hashPayload(payload),
      });

      await insertOrderItem(client, {
        orderId: order.id,
        variantId: variant.id,
        productNameSnapshot: product.name,
        variantNameSnapshot: variant.name,
        unitPriceMinor: variant.priceMinor,
        quantity: 1,
        totalMinor: 50000,
      });

      await client.query('COMMIT');
      return { success: true, orderId: order.id };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return { success: false, reason: err.message };
    } finally {
      client.release();
    }
  }

  // Two buyers race concurrently for the last pin
  const [res1, res2] = await Promise.all([
    attemptOrder(u1, 'idemp_race_order_1'),
    attemptOrder(u2, 'idemp_race_order_2'),
  ]);

  const successes = [res1, res2].filter(r => r.success);
  const failures = [res1, res2].filter(r => !r.success);

  assert.equal(successes.length, 1, 'exactly one buyer must secure the final item');
  assert.equal(failures.length, 1, 'second buyer must be rejected due to insufficient stock');
  assert.equal(failures[0].reason, 'INSUFFICIENT_STOCK');

  // Verify stock is exactly 0
  const finalProduct = await getProductById(pool, product.id);
  const finalVariant = finalProduct.variants.find(v => v.id === variant.id);
  assert.equal(finalVariant.stockQuantity, 0, 'stock must be exactly 0, never negative');
});

test('Multi-item order rolls back completely if any single item is out of stock', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'multi-rollback@example.test';
  let productId = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (productId) await cleanupProduct(pool, productId);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, { name: 'Multi Buyer', email: userEmail, passwordHash: '$2b$12$x' });

  const product = await createProduct(pool, { name: 'Multi Item Test', category: 'apparel' });
  productId = product.id;

  const varInStock = await createProductVariant(pool, {
    productId: product.id,
    name: 'Available Size',
    priceMinor: 30000,
    currency: 'INR',
    stockQuantity: 10,
  });

  const varOutOfStock = await createProductVariant(pool, {
    productId: product.id,
    name: 'Out of Stock Size',
    priceMinor: 30000,
    currency: 'INR',
    stockQuantity: 0,
  });

  const client = await pool.connect();
  let orderCreated = false;
  try {
    await client.query('BEGIN');

    // Lock variants deterministically (sorted IDs)
    const sortedIds = [varInStock.id, varOutOfStock.id].sort();
    const locked = await lockVariantsForOrder(client, sortedIds);

    // Verify both items
    const v1 = locked.find(v => v.id === varInStock.id);
    const v2 = locked.find(v => v.id === varOutOfStock.id);

    if (v1.stockQuantity < 1 || v2.stockQuantity < 1) {
      throw new Error('INSUFFICIENT_STOCK_ABORT');
    }

    // Should never reach here
    await decrementVariantStock(client, { variantId: varInStock.id, quantity: 1 });
    await decrementVariantStock(client, { variantId: varOutOfStock.id, quantity: 1 });
    await client.query('COMMIT');
    orderCreated = true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    assert.equal(err.message, 'INSUFFICIENT_STOCK_ABORT');
  } finally {
    client.release();
  }

  assert.equal(orderCreated, false, 'order must not be created');

  // Verify that varInStock still has full stock (10)
  const productAfter = await getProductById(pool, product.id);
  const v1After = productAfter.variants.find(v => v.id === varInStock.id);
  assert.equal(v1After.stockQuantity, 10, 'stock for available variant must remain 10 without partial deduction');
});

test('Order idempotency: matching payload returns order, altered payload rejected (@rule:ORDER_IDEMPOTENCY)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'idemp-order-user@example.test';
  let productId = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (productId) await cleanupProduct(pool, productId);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, { name: 'Idemp Tester', email: userEmail, passwordHash: '$2b$12$x' });
  const product = await createProduct(pool, { name: 'Idemp Product', category: 'apparel' });
  productId = product.id;

  const variant = await createProductVariant(pool, {
    productId: product.id,
    name: 'Standard',
    priceMinor: 40000,
    currency: 'INR',
    stockQuantity: 20,
  });

  const idempKey = 'idemp_order_replay_test_key_001';
  const originalPayload = { userId: user.id, items: [{ variantId: variant.id, quantity: 2 }] };
  const originalHash = hashPayload(originalPayload);

  // 1. Initial Order Creation
  const initialOrder = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 80000,
    status: 'pending',
    idempotencyKey: idempKey,
    payloadHash: originalHash,
  });

  await insertOrderItem(pool, {
    orderId: initialOrder.id,
    variantId: variant.id,
    productNameSnapshot: product.name,
    variantNameSnapshot: variant.name,
    unitPriceMinor: variant.priceMinor,
    quantity: 2,
    totalMinor: 80000,
  });

  // 2. Replay with SAME idempotency key and SAME payload hash -> returns existing order
  const existingOrder = await findOrderByIdempotencyKey(pool, idempKey);
  assert.ok(existingOrder, 'existing order found');
  assert.equal(existingOrder.id, initialOrder.id);
  assert.equal(existingOrder.idempotencyPayloadHash, originalHash, 'payload hashes match');

  // 3. Replay with SAME idempotency key but DIFFERENT payload -> unique violation on insert or detected mismatch
  const alteredPayload = { userId: user.id, items: [{ variantId: variant.id, quantity: 5 }] };
  const alteredHash = hashPayload(alteredPayload);

  assert.notEqual(existingOrder.idempotencyPayloadHash, alteredHash, 'altered payload hash must differ');

  await assert.rejects(
    async () => {
      await insertOrder(pool, {
        userId: user.id,
        currency: 'INR',
        totalMinor: 200000,
        status: 'pending',
        idempotencyKey: idempKey, // reused key
        payloadHash: alteredHash,
      });
    },
    err => err.code === '23505',
    'reusing idempotency key must violate unique constraint (23505)'
  );
});

test('Order items preserve price snapshots even if variant catalog price changes', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'snapshot-test@example.test';
  let productId = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (productId) await cleanupProduct(pool, productId);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, { name: 'Snapshot User', email: userEmail, passwordHash: '$2b$12$x' });
  const product = await createProduct(pool, { name: 'Snapshot Tee', category: 'apparel' });
  productId = product.id;

  const variant = await createProductVariant(pool, {
    productId: product.id,
    name: 'Medium',
    priceMinor: 50000, // 500.00 INR at purchase time
    currency: 'INR',
    stockQuantity: 10,
  });

  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 50000,
    status: 'paid',
    idempotencyKey: 'idemp_snapshot_order_1',
    payloadHash: 'hash_test_1',
  });

  await insertOrderItem(pool, {
    orderId: order.id,
    variantId: variant.id,
    productNameSnapshot: product.name,
    variantNameSnapshot: variant.name,
    unitPriceMinor: variant.priceMinor, // 50000
    quantity: 1,
    totalMinor: 50000,
  });

  // Now change live catalog price to 75000
  await pool.query('UPDATE product_variants SET price_minor = 75000 WHERE id = $1', [variant.id]);

  // Fetch order details
  const orderDetails = await getOrderDetails(pool, order.id, user.id);
  assert.equal(orderDetails.items.length, 1);
  assert.equal(orderDetails.items[0].unitPriceMinor, 50000, 'item price snapshot must remain 50000');
  assert.equal(orderDetails.items[0].productName, 'Snapshot Tee');
});

test('cancelOrder restores variant stock exactly once (@rule:STOCK_RESTORE_ON_CANCEL)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'cancel-stock-user@example.test';
  let productId = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (productId) await cleanupProduct(pool, productId);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, { name: 'Cancel User', email: userEmail, passwordHash: '$2b$12$x' });
  const product = await createProduct(pool, { name: 'Cancelable Item', category: 'accessories' });
  productId = product.id;

  const variant = await createProductVariant(pool, {
    productId: product.id,
    name: 'Standard',
    priceMinor: 20000,
    currency: 'INR',
    stockQuantity: 10, // starts at 10
  });

  // Deduct 3 units for order (stock becomes 7)
  await decrementVariantStock(pool, { variantId: variant.id, quantity: 3 });

  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 60000,
    status: 'pending',
    idempotencyKey: 'idemp_cancel_test_001',
    payloadHash: 'hash_cancel_001',
  });

  await insertOrderItem(pool, {
    orderId: order.id,
    variantId: variant.id,
    productNameSnapshot: product.name,
    variantNameSnapshot: variant.name,
    unitPriceMinor: variant.priceMinor,
    quantity: 3,
    totalMinor: 60000,
  });

  // Verify stock is currently 7
  let checkVar = (await getProductById(pool, product.id)).variants[0];
  assert.equal(checkVar.stockQuantity, 7);

  // 1. First Cancellation: MUST succeed and restore 3 units back to 10
  const client1 = await pool.connect();
  let cancelResult1 = null;
  try {
    await client1.query('BEGIN');
    cancelResult1 = await cancelOrder(client1, {
      orderId: order.id,
      actorId: user.id,
      reason: 'Customer requested cancellation',
    });
    await client1.query('COMMIT');
  } catch (err) {
    await client1.query('ROLLBACK');
    throw err;
  } finally {
    client1.release();
  }

  assert.ok(cancelResult1, 'first cancellation must succeed');
  assert.equal(cancelResult1.status, 'cancelled');

  checkVar = (await getProductById(pool, product.id)).variants[0];
  assert.equal(checkVar.stockQuantity, 10, 'stock must be restored from 7 to 10');

  // 2. Second Cancellation on ALREADY CANCELLED order: MUST return null and NOT double-restore!
  const client2 = await pool.connect();
  let cancelResult2 = null;
  try {
    await client2.query('BEGIN');
    cancelResult2 = await cancelOrder(client2, {
      orderId: order.id,
      actorId: user.id,
      reason: 'Duplicate cancellation attempt',
    });
    await client2.query('COMMIT');
  } catch (err) {
    await client2.query('ROLLBACK');
    throw err;
  } finally {
    client2.release();
  }

  assert.equal(cancelResult2, null, 'second cancellation must return null');

  // Stock must still be 10 (never 13!)
  checkVar = (await getProductById(pool, product.id)).variants[0];
  assert.equal(checkVar.stockQuantity, 10, 'stock must remain 10 without double restoration');
});

test('listUserOrders returns user orders with items summary', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'user-orders-list@example.test';
  let productId = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (productId) await cleanupProduct(pool, productId);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, { name: 'Order Collector', email: userEmail, passwordHash: '$2b$12$x' });
  const product = await createProduct(pool, { name: 'User Orders Product', category: 'apparel' });
  productId = product.id;

  const variant = await createProductVariant(pool, {
    productId: product.id,
    name: 'L',
    priceMinor: 60000,
    currency: 'INR',
    stockQuantity: 5,
  });

  const order = await insertOrder(pool, {
    userId: user.id,
    currency: 'INR',
    totalMinor: 60000,
    status: 'paid',
    idempotencyKey: 'idemp_user_orders_001',
    payloadHash: 'hash_user_orders_001',
  });

  await insertOrderItem(pool, {
    orderId: order.id,
    variantId: variant.id,
    productNameSnapshot: product.name,
    variantNameSnapshot: variant.name,
    unitPriceMinor: 60000,
    quantity: 1,
    totalMinor: 60000,
  });

  const ordersResult = await listUserOrders(pool, user.id);
  assert.equal(ordersResult.total, 1);
  assert.equal(ordersResult.rows.length, 1);
  assert.equal(ordersResult.rows[0].id, order.id);
  assert.equal(ordersResult.rows[0].status, 'paid');
  assert.equal(ordersResult.rows[0].items.length, 1);
  assert.equal(ordersResult.rows[0].items[0].productName, 'User Orders Product');
});
