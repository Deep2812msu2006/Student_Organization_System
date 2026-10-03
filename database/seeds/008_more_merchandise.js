/**
 * Seed 008 — Product images & catalog expansion
 *
 * Updates existing products with high-resolution studio photos and
 * adds new curated merchandise items across apparel, accessories, and collectibles.
 */

const ORGANIZER_USER_ID = '10000000-0000-0000-0000-000000000002';

export async function seed(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Update existing products with image URLs
    await client.query(`
      UPDATE products SET image_url = '/images/products/hoodie.jpg' WHERE id = '60000000-0000-0000-0000-000000000001';
      UPDATE products SET image_url = '/images/products/water-bottle.jpg' WHERE id = '60000000-0000-0000-0000-000000000002';
      UPDATE products SET image_url = '/images/products/pin-set.jpg' WHERE id = '60000000-0000-0000-0000-000000000003';
    `);

    // 2. Insert new products
    await client.query(`
      INSERT INTO products (id, name, description, category, image_url, is_published, created_by)
      VALUES
        (
          '60000000-0000-0000-0000-000000000004',
          'Vintage Washed Skyline Dad Cap',
          'Classic unstructured low-profile cotton twill baseball cap with embroidered heritage crest and adjustable brass buckle.',
          'apparel',
          '/images/products/dad-cap.jpg',
          true,
          $1
        ),
        (
          '60000000-0000-0000-0000-000000000005',
          'Skyline Heavyweight Oversized Tee',
          '240 GSM luxury heavyweight combed cotton tee with relaxed boxy drop-shoulder fit and subtle chest graphic.',
          'apparel',
          '/images/products/oversized-tee.jpg',
          true,
          $1
        ),
        (
          '60000000-0000-0000-0000-000000000006',
          'Skyline Canvas Campus Backpack',
          'Rugged 18oz water-resistant canvas backpack with padded 15" laptop sleeve, genuine leather straps, and brass hardware.',
          'accessories',
          '/images/products/backpack.jpg',
          true,
          $1
        ),
        (
          '60000000-0000-0000-0000-000000000007',
          'Skyline Insulated Coffee Tumbler',
          '350ml double-wall vacuum insulated travel tumbler with ceramic lining, leakproof flip lid, and laser-etched club emblem.',
          'accessories',
          '/images/products/coffee-tumbler.jpg',
          true,
          $1
        ),
        (
          '60000000-0000-0000-0000-000000000008',
          'Skyline Heritage Hardcover Journal',
          'A5 debossed vegan leather notebook with 192 numbered 100gsm acid-free cream dotted pages, dual ribbon bookmarks, and inner pocket.',
          'collectibles',
          '/images/products/journal.jpg',
          true,
          $1
        )
      ON CONFLICT (id) DO UPDATE SET
        image_url = EXCLUDED.image_url,
        description = EXCLUDED.description,
        is_published = EXCLUDED.is_published;
    `, [ORGANIZER_USER_ID]);

    // 3. Insert product variants
    await client.query(`
      INSERT INTO product_variants (id, product_id, name, sku, price_minor, currency, stock_quantity, is_active)
      VALUES
        -- Dad Cap
        ('70000000-0000-0000-0000-000000000010', '60000000-0000-0000-0000-000000000004', 'Forest Green', 'CAP-GRN', 35000, 'INR', 25, true),
        ('70000000-0000-0000-0000-000000000011', '60000000-0000-0000-0000-000000000004', 'Washed Khaki', 'CAP-KHK', 35000, 'INR', 20, true),

        -- Oversized Tee
        ('70000000-0000-0000-0000-000000000012', '60000000-0000-0000-0000-000000000005', 'Small', 'TEE-S', 65000, 'INR', 20, true),
        ('70000000-0000-0000-0000-000000000013', '60000000-0000-0000-0000-000000000005', 'Medium', 'TEE-M', 65000, 'INR', 35, true),
        ('70000000-0000-0000-0000-000000000014', '60000000-0000-0000-0000-000000000005', 'Large', 'TEE-L', 65000, 'INR', 30, true),
        ('70000000-0000-0000-0000-000000000015', '60000000-0000-0000-0000-000000000005', 'XL', 'TEE-XL', 65000, 'INR', 15, true),

        -- Backpack
        ('70000000-0000-0000-0000-000000000016', '60000000-0000-0000-0000-000000000006', 'Olive Green', 'BP-OLV', 180000, 'INR', 20, true),
        ('70000000-0000-0000-0000-000000000017', '60000000-0000-0000-0000-000000000006', 'Tan Canvas', 'BP-TAN', 180000, 'INR', 15, true),

        -- Coffee Tumbler
        ('70000000-0000-0000-0000-000000000018', '60000000-0000-0000-0000-000000000007', 'Sage Green', 'TMB-SGE', 55000, 'INR', 30, true),
        ('70000000-0000-0000-0000-000000000019', '60000000-0000-0000-0000-000000000007', 'Matte Black', 'TMB-BLK', 55000, 'INR', 25, true),

        -- Hardcover Journal
        ('70000000-0000-0000-0000-000000000020', '60000000-0000-0000-0000-000000000008', 'Emerald Green', 'JRN-EMR', 38000, 'INR', 40, true),
        ('70000000-0000-0000-0000-000000000021', '60000000-0000-0000-0000-000000000008', 'Midnight Navy', 'JRN-NVY', 38000, 'INR', 25, true)
      ON CONFLICT (id) DO UPDATE SET
        price_minor = EXCLUDED.price_minor,
        stock_quantity = EXCLUDED.stock_quantity,
        is_active = EXCLUDED.is_active;
    `);

    await client.query('COMMIT');
    console.log('Seed 008: Merchandise images and new catalog items seeded successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
