/**
 * Seed 004 — synthetic development merchandise products, variants and orders.
 *
 * @rule:VARIANT_LOCK_ORDER
 * @rule:STOCK_DEDUCT_ON_ORDER
 * @rule:ORDER_IDEMPOTENCY
 * @rule:STOCK_RESTORE_ON_CANCEL
 *
 * Representative merchandise items:
 *   - Official Hoodie (variants: S, M, L, XL)
 *   - Insulated Water Bottle (variants: 500ml, 750ml)
 *   - Limited Pin Set (stock = 1, for concurrency tests)
 */

import crypto from 'node:crypto';

const ORGANIZER_USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBER_USER_ID    = '10000000-0000-0000-0000-000000000001';

const PRODUCT_1_ID = '60000000-0000-0000-0000-000000000001';
const PRODUCT_2_ID = '60000000-0000-0000-0000-000000000002';
const PRODUCT_3_ID = '60000000-0000-0000-0000-000000000003';

const VAR_HOODIE_S  = '70000000-0000-0000-0000-000000000001';
const VAR_HOODIE_M  = '70000000-0000-0000-0000-000000000002';
const VAR_HOODIE_L  = '70000000-0000-0000-0000-000000000003';
const VAR_HOODIE_XL = '70000000-0000-0000-0000-000000000004';

const VAR_BOTTLE_500 = '70000000-0000-0000-0000-000000000005';
const VAR_BOTTLE_750 = '70000000-0000-0000-0000-000000000006';

const VAR_PIN_SET = '70000000-0000-0000-0000-000000000007';

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function seed(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Products
    await client.query(`
      INSERT INTO products (id, name, description, category, is_published, created_by)
      VALUES
        ($1, 'Official Skyline Club Hoodie', 'Premium heavyweight cotton fleece hoodie with embroidered club crest.', 'apparel', true, $4),
        ($2, 'Campus Stainless Steel Water Bottle', 'Double-wall vacuum insulated water bottle keeps beverages cold for 24h.', 'accessories', true, $4),
        ($3, 'Limited Edition Enamel Pin Set', 'Collector edition 3-piece enamel pin set featuring campus landmarks.', 'collectibles', true, $4)
      ON CONFLICT (id) DO NOTHING
    `, [PRODUCT_1_ID, PRODUCT_2_ID, PRODUCT_3_ID, ORGANIZER_USER_ID]);

    // 2. Variants
    await client.query(`
      INSERT INTO product_variants (id, product_id, name, sku, price_minor, currency, stock_quantity, is_active)
      VALUES
        ($1, $5, 'Small', 'HD-SKY-S', 120000, 'INR', 15, true),
        ($2, $5, 'Medium', 'HD-SKY-M', 120000, 'INR', 25, true),
        ($3, $5, 'Large', 'HD-SKY-L', 120000, 'INR', 20, true),
        ($4, $5, 'XL', 'HD-SKY-XL', 130000, 'INR', 10, true),
        ($6, $7, '500ml', 'WB-500', 45000, 'INR', 50, true),
        ($8, $7, '750ml', 'WB-750', 60000, 'INR', 30, true),
        ($9, $10, 'Standard Set', 'PIN-SET-01', 25000, 'INR', 10, true)
      ON CONFLICT (id) DO NOTHING
    `, [
      VAR_HOODIE_S, VAR_HOODIE_M, VAR_HOODIE_L, VAR_HOODIE_XL, PRODUCT_1_ID,
      VAR_BOTTLE_500, PRODUCT_2_ID, VAR_BOTTLE_750,
      VAR_PIN_SET, PRODUCT_3_ID
    ]);

    // 3. Sample Orders
    const order1Payload = { userId: MEMBER_USER_ID, items: [{ variantId: VAR_HOODIE_M, quantity: 1 }] };
    const order1Hash = hashPayload(order1Payload);

    await client.query(`
      INSERT INTO orders
        (id, user_id, status, total_minor, currency, idempotency_key, idempotency_payload_hash, paid_at)
      VALUES
        (
          '80000000-0000-0000-0000-000000000001',
          $1, 'paid', 120000, 'INR', 'seed_order_idemp_001', $2, '2026-10-02 10:00:00+00'
        )
      ON CONFLICT (id) DO NOTHING
    `, [MEMBER_USER_ID, order1Hash]);

    await client.query(`
      INSERT INTO order_items
        (id, order_id, variant_id, product_name_snapshot, variant_name_snapshot, unit_price_minor_snapshot, quantity, total_minor)
      VALUES
        (
          '90000000-0000-0000-0000-000000000001',
          '80000000-0000-0000-0000-000000000001',
          $1,
          'Official Skyline Club Hoodie',
          'Medium',
          120000,
          1,
          120000
        )
      ON CONFLICT (id) DO NOTHING
    `, [VAR_HOODIE_M]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
