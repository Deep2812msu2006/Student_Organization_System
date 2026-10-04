/**
 * database/seeds/010_comprehensive_demo_data.js
 *
 * Populates curated, realistic seed data across all modules for interview demonstrations:
 *
 * 1. User Privileges & Memberships:
 *    - Grants organizer & treasurer roles to Om ('khatriom12062007@gmail.com') and Deep ('deepjaiswal1971@gmail.com')
 *    - Ensures both have active, paid standard memberships
 *    - Adds sample student members (Aarav, Priya, Rohan, Ananya)
 *
 * 2. Orders & Order Items:
 *    - Populates orders in all 4 lifecycles (paid, fulfilled, pending, cancelled) for Om, Deep, and Dev Member
 *    - Links paid & fulfilled orders to payment_records
 *    - Populates fulfillment pickup desk on /staff/inventory
 *
 * 3. Events, Registrations & Tickets:
 *    - Confirmed tickets with ready admission codes for Om, Deep, and Dev Member
 *    - Check-in kiosk demo data on Annual Tech Symposium (some checked-in, some ready with known codes)
 *    - Pending reservation on /staff/payments for manual confirmation demo
 *
 * 4. Finance & Treasury:
 *    - Pending dues obligation on /staff/dues for treasurer collection demo
 *    - Cohesive payment records across dues, orders, and event tickets
 *    - Realistic expenses across submitted, approved, and reimbursed states with valid PDFs
 *
 * 5. Community & Mail:
 *    - Dispatched and queued email notifications in message_outbox for /mail
 *    - Actionable volunteer tasks across todo, in_progress, and done
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { readConfig } from '../../server/config/env.js';
import { ticketToken, hashToken } from '../../server/utils/ticketToken.js';

// Predefined UUIDs for repeatable and idempotent seeding
const PLAN_ID = '00000000-0000-0000-0000-000000000001';
const DEV_ORGANIZER_ID = '10000000-0000-0000-0000-000000000002';
const DEV_TREASURER_ID = '10000000-0000-0000-0000-000000000003';
const DEV_MEMBER_ID    = '10000000-0000-0000-0000-000000000001';

// Sample students
const STUDENT_AARAV_ID  = '10000000-0000-0000-0000-000000000011';
const STUDENT_PRIYA_ID  = '10000000-0000-0000-0000-000000000012';
const STUDENT_ROHAN_ID  = '10000000-0000-0000-0000-000000000013';
const STUDENT_ANANYA_ID = '10000000-0000-0000-0000-000000000014';

// Events
const EVENT_SYMPOSIUM_ID = '40000000-0000-0000-0000-000000000001';
const EVENT_WORKSHOP_ID  = '40000000-0000-0000-0000-000000000002';
const EVENT_ROBOTICS_ID  = '40000000-0000-0000-0000-000000000003';

// Products & Variants
const VAR_HOODIE_M     = '70000000-0000-0000-0000-000000000002';
const VAR_BOTTLE_750   = '70000000-0000-0000-0000-000000000006';
const VAR_PIN_SET      = '70000000-0000-0000-0000-000000000007';

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function receiptPdf(title, ref) {
  const stream = `BT /F1 18 Tf 40 750 Td (${title}) Tj 0 -30 Td /F1 12 Tf (Reference: ${ref}) Tj 0 -24 Td (Skyline Student Association - Verified Receipt) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let result = '%PDF-1.4\n', offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(result));
    result += (i + 1) + ' 0 obj\n' + o + '\nendobj\n';
  });
  const xref = Buffer.byteLength(result);
  result += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return result;
}

export async function seed(pool) {
  const config = readConfig();
  const ticketSecret = config.ticketSecret || 'skyline-demo-ticket-secret-fallback-token';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ──────────────────────────────────────────────────────────────────────────
    // 1. Ensure Demo Users, Passwords & Privileges
    // ──────────────────────────────────────────────────────────────────────────
    const demoPasswordHash = await bcrypt.hash('Demo$Student1!', 10);

    const students = [
      [STUDENT_AARAV_ID,  'Aarav Sharma',  'aarav.sharma@example.local'],
      [STUDENT_PRIYA_ID,  'Priya Patel',   'priya.patel@example.local'],
      [STUDENT_ROHAN_ID,  'Rohan Mehta',   'rohan.mehta@example.local'],
      [STUDENT_ANANYA_ID, 'Ananya Iyer',   'ananya.iyer@example.local'],
    ];

    for (const [id, name, email] of students) {
      await client.query(
        `INSERT INTO users (id, name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email`,
        [id, name, email, demoPasswordHash]
      );
      await client.query(
        `INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'member') ON CONFLICT DO NOTHING`,
        [id]
      );
    }

    // Lookup user accounts for Khatri Om and Deep Jaiswal
    const omRes = await client.query("SELECT id FROM users WHERE email = 'khatriom12062007@gmail.com'");
    const deepRes = await client.query("SELECT id FROM users WHERE email = 'deepjaiswal1971@gmail.com'");

    const targetStaffUsers = [];
    if (omRes.rows[0]?.id) targetStaffUsers.push(omRes.rows[0].id);
    if (deepRes.rows[0]?.id) targetStaffUsers.push(deepRes.rows[0].id);
    targetStaffUsers.push(DEV_MEMBER_ID); // Also give full demo capability to Dev Member

    // Elevate staff users to have all roles for smooth presentation
    for (const userId of targetStaffUsers) {
      for (const role of ['member', 'organizer', 'treasurer']) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, role]
        );
      }

      // Ensure active membership with paid dues
      const periodRes = await client.query(
        `SELECT id FROM membership_periods WHERE user_id = $1 AND starts_at <= now() AND expires_at > now()`,
        [userId]
      );
      let periodId = periodRes.rows[0]?.id;
      if (!periodId) {
        const ins = await client.query(
          `INSERT INTO membership_periods (user_id, plan_id, starts_at, expires_at, dues_amount_minor, currency)
           VALUES ($1, $2, now() - interval '14 days', now() + interval '351 days', 50000, 'INR')
           RETURNING id`,
          [userId, PLAN_ID]
        );
        periodId = ins.rows[0].id;
      }

      const duesRes = await client.query(
        `SELECT id, status FROM dues_obligations WHERE membership_period_id = $1`,
        [periodId]
      );
      let duesId = duesRes.rows[0]?.id;
      if (!duesId) {
        const dIns = await client.query(
          `INSERT INTO dues_obligations (membership_period_id, amount_minor, currency, status, paid_at)
           VALUES ($1, 50000, 'INR', 'paid', now() - interval '14 days')
           RETURNING id`,
          [periodId]
        );
        duesId = dIns.rows[0].id;
      } else {
        await client.query(
          `UPDATE dues_obligations SET status = 'paid', paid_at = COALESCE(paid_at, now() - interval '14 days') WHERE id = $1`,
          [duesId]
        );
      }

      // Record durable payment for this dues obligation (if not already recorded)
      const existingDuesPay = await client.query(
        `SELECT id FROM payment_records WHERE dues_obligation_id = $1`, [duesId]
      );
      if (!existingDuesPay.rows[0]) {
        const duesPayId = crypto.randomUUID();
        const duesIdemp = `seed-dues-pay-${userId.slice(0, 8)}`;
        await client.query(
          `INSERT INTO payment_records (id, dues_obligation_id, amount_minor, currency, method, external_reference, notes, recorded_by, idempotency_key, created_at)
           VALUES ($1, $2, 50000, 'INR', 'razorpay_upi', 'UPI-MEM-${userId.slice(0, 8)}', 'Annual Membership Dues 2026-2027', $3, $4, now() - interval '14 days')
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [duesPayId, duesId, DEV_TREASURER_ID, duesIdemp]
        );
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Pending Dues Obligation for Staff Dues Page (/staff/dues)
    // ──────────────────────────────────────────────────────────────────────────
    // Give Ananya Iyer a pending dues obligation to demonstrate manual dues confirmation
    const ananyaPeriodRes = await client.query(
      `SELECT id FROM membership_periods WHERE user_id = $1`, [STUDENT_ANANYA_ID]
    );
    let ananyaPeriodId = ananyaPeriodRes.rows[0]?.id;
    if (!ananyaPeriodId) {
      const insP = await client.query(
        `INSERT INTO membership_periods (user_id, plan_id, starts_at, expires_at, dues_amount_minor, currency)
         VALUES ($1, $2, now(), now() + interval '365 days', 50000, 'INR')
         RETURNING id`,
        [STUDENT_ANANYA_ID, PLAN_ID]
      );
      ananyaPeriodId = insP.rows[0].id;
    }
    await client.query(
      `INSERT INTO dues_obligations (id, membership_period_id, amount_minor, currency, status)
       VALUES ('30000000-0000-0000-0000-000000000099', $1, 50000, 'INR', 'pending')
       ON CONFLICT (id) DO UPDATE SET status = 'pending'`,
      [ananyaPeriodId]
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 3. Realistic Demo Orders across all states (Paid, Fulfilled, Pending, Cancelled)
    // ──────────────────────────────────────────────────────────────────────────
    const { rows: hoodieRows } = await client.query(
      `SELECT v.id, v.price_minor, p.name as product_name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.name ILIKE '%Hoodie%' LIMIT 1`
    );
    const { rows: bottleRows } = await client.query(
      `SELECT v.id, v.price_minor, p.name as product_name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.name ILIKE '%Bottle%' LIMIT 1`
    );
    const { rows: teeRows } = await client.query(
      `SELECT v.id, v.price_minor, p.name as product_name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.name ILIKE '%Tee%' LIMIT 1`
    );
    const { rows: capRows } = await client.query(
      `SELECT v.id, v.price_minor, p.name as product_name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.name ILIKE '%Cap%' LIMIT 1`
    );

    const hoodieVar = hoodieRows[0] || { id: VAR_HOODIE_M, price_minor: 120000, product_name: 'Official Skyline Club Hoodie' };
    const bottleVar = bottleRows[0] || { id: VAR_BOTTLE_750, price_minor: 60000, product_name: 'Campus Stainless Steel Water Bottle' };
    const teeVar    = teeRows[0]    || { id: VAR_HOODIE_M, price_minor: 85000, product_name: 'Skyline Heavyweight Oversized Tee' };
    const capVar    = capRows[0]    || { id: VAR_PIN_SET,   price_minor: 45000, product_name: 'Vintage Washed Skyline Dad Cap' };

    // Function to seed order bundle for a user
    async function seedUserOrders(userId, userPrefix) {
      // 1. Order Paid (Awaiting Campus Pickup at Desk B)
      const orderPaidId = `${userPrefix}000000-0000-0000-0000-000000000001`;
      const paidHash = hashPayload({ userId, items: [{ variantId: hoodieVar.id, quantity: 1 }] });
      await client.query(
        `INSERT INTO orders (id, user_id, status, total_minor, currency, idempotency_key, idempotency_payload_hash, paid_at, created_at)
         VALUES ($1, $2, 'paid', 120000, 'INR', $3, $4, now() - interval '2 days', now() - interval '2 days')
         ON CONFLICT (id) DO UPDATE SET status = 'paid', paid_at = now() - interval '2 days'`,
        [orderPaidId, userId, `idemp-ord-paid-${userId.slice(0, 8)}`, paidHash]
      );
      await client.query(
        `INSERT INTO order_items (id, order_id, variant_id, product_name_snapshot, variant_name_snapshot, unit_price_minor_snapshot, quantity, total_minor)
         VALUES ($1, $2, $3, $4, 'Medium', 120000, 1, 120000)
         ON CONFLICT (id) DO NOTHING`,
        [`${userPrefix}100000-0000-0000-0000-000000000001`, orderPaidId, hoodieVar.id, hoodieVar.product_name]
      );

      const existingOrdPay = await client.query(
        `SELECT id FROM payment_records WHERE order_id = $1`, [orderPaidId]
      );
      if (!existingOrdPay.rows[0]) {
        await client.query(
          `INSERT INTO payment_records (id, order_id, amount_minor, currency, method, external_reference, notes, recorded_by, idempotency_key, created_at)
           VALUES ($1, $2, 120000, 'INR', 'razorpay_upi', 'UPI-ORD-HOODIE-${userId.slice(0, 6)}', 'Hoodie Campus Pre-order', $3, $4, now() - interval '2 days')
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [`${userPrefix}200000-0000-0000-0000-000000000001`, orderPaidId, DEV_TREASURER_ID, `pay-idemp-ord-paid-${userId.slice(0, 8)}`]
        );
      }

      // 2. Order Fulfilled (Already Collected)
      const orderFulfilledId = `${userPrefix}000000-0000-0000-0000-000000000002`;
      const fulfilledHash = hashPayload({ userId, items: [{ variantId: bottleVar.id, quantity: 1 }] });
      await client.query(
        `INSERT INTO orders (id, user_id, status, total_minor, currency, idempotency_key, idempotency_payload_hash, paid_at, fulfilled_at, created_at)
         VALUES ($1, $2, 'fulfilled', 60000, 'INR', $3, $4, now() - interval '5 days', now() - interval '2 days', now() - interval '5 days')
         ON CONFLICT (id) DO UPDATE SET status = 'fulfilled', paid_at = now() - interval '5 days', fulfilled_at = now() - interval '2 days'`,
        [orderFulfilledId, userId, `idemp-ord-fulf-${userId.slice(0, 8)}`, fulfilledHash]
      );
      await client.query(
        `INSERT INTO order_items (id, order_id, variant_id, product_name_snapshot, variant_name_snapshot, unit_price_minor_snapshot, quantity, total_minor)
         VALUES ($1, $2, $3, $4, '750ml Vacuum', 60000, 1, 60000)
         ON CONFLICT (id) DO NOTHING`,
        [`${userPrefix}100000-0000-0000-0000-000000000002`, orderFulfilledId, bottleVar.id, bottleVar.product_name]
      );

      const existingFulfPay = await client.query(
        `SELECT id FROM payment_records WHERE order_id = $1`, [orderFulfilledId]
      );
      if (!existingFulfPay.rows[0]) {
        await client.query(
          `INSERT INTO payment_records (id, order_id, amount_minor, currency, method, external_reference, notes, recorded_by, idempotency_key, created_at)
           VALUES ($1, $2, 60000, 'INR', 'razorpay_upi', 'UPI-ORD-BOTTLE-${userId.slice(0, 6)}', 'Bottle purchase collected at Student Desk', $3, $4, now() - interval '5 days')
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [`${userPrefix}200000-0000-0000-0000-000000000002`, orderFulfilledId, DEV_TREASURER_ID, `pay-idemp-ord-fulf-${userId.slice(0, 8)}`]
        );
      }

      // 3. Order Pending (Awaiting Payment — can show Pay Now button or Treasurer confirmation)
      const orderPendingId = `${userPrefix}000000-0000-0000-0000-000000000003`;
      const pendingHash = hashPayload({ userId, items: [{ variantId: teeVar.id, quantity: 1 }] });
      await client.query(
        `INSERT INTO orders (id, user_id, status, total_minor, currency, idempotency_key, idempotency_payload_hash, created_at)
         VALUES ($1, $2, 'pending', 85000, 'INR', $3, $4, now() - interval '2 hours')
         ON CONFLICT (id) DO UPDATE SET status = 'pending'`,
        [orderPendingId, userId, `idemp-ord-pend-${userId.slice(0, 8)}`, pendingHash]
      );
      await client.query(
        `INSERT INTO order_items (id, order_id, variant_id, product_name_snapshot, variant_name_snapshot, unit_price_minor_snapshot, quantity, total_minor)
         VALUES ($1, $2, $3, $4, 'Large / Vintage Black', 85000, 1, 85000)
         ON CONFLICT (id) DO NOTHING`,
        [`${userPrefix}100000-0000-0000-0000-000000000003`, orderPendingId, teeVar.id, teeVar.product_name]
      );

      // 4. Order Cancelled (Demonstrates cancellation badge and reason)
      const orderCancelledId = `${userPrefix}000000-0000-0000-0000-000000000004`;
      const cancelledHash = hashPayload({ userId, items: [{ variantId: capVar.id, quantity: 1 }] });
      await client.query(
        `INSERT INTO orders (id, user_id, status, total_minor, currency, idempotency_key, idempotency_payload_hash, cancelled_at, cancellation_reason, created_at)
         VALUES ($1, $2, 'cancelled', 45000, 'INR', $3, $4, now() - interval '1 day', 'Student requested color exchange to Forest Green', now() - interval '3 days')
         ON CONFLICT (id) DO UPDATE SET status = 'cancelled', cancellation_reason = 'Student requested color exchange to Forest Green'`,
        [orderCancelledId, userId, `idemp-ord-canc-${userId.slice(0, 8)}`, cancelledHash]
      );
      await client.query(
        `INSERT INTO order_items (id, order_id, variant_id, product_name_snapshot, variant_name_snapshot, unit_price_minor_snapshot, quantity, total_minor)
         VALUES ($1, $2, $3, $4, 'Standard Size', 45000, 1, 45000)
         ON CONFLICT (id) DO NOTHING`,
        [`${userPrefix}100000-0000-0000-0000-000000000004`, orderCancelledId, capVar.id, capVar.product_name]
      );
    }

    // Seed orders for all target staff users (Om, Deep, Dev Member)
    let prefixCounter = 81;
    for (const userId of targetStaffUsers) {
      await seedUserOrders(userId, String(prefixCounter++));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. Event Tickets & Live Check-In Demo Data
    // ──────────────────────────────────────────────────────────────────────────
    // Function to create verified ticket with valid code for /browse/tickets and /staff/checkin
    async function seedTicket({ regId, eventId, userId, priceMinor, status, checkedIn, key, customToken }) {
      const internalKey = key || `idemp-reg-${regId.slice(0, 8)}`;
      const rawCode = customToken || ticketToken(ticketSecret, internalKey);
      const tokenHashVal = hashToken(rawCode);

      // Check if registration already exists for this event and user
      const existing = await client.query(
        `SELECT id FROM registrations WHERE (event_id = $1 AND user_id = $2 AND status IN ('pending', 'confirmed')) OR id = $3`,
        [eventId, userId, regId]
      );
      const actualRegId = existing.rows[0]?.id || regId;

      if (existing.rows[0]) {
        await client.query(
          `UPDATE registrations
           SET status = $1,
               token_hash = $2,
               checked_in_at = $3,
               checked_in_by = $4
           WHERE id = $5`,
          [
            status,
            tokenHashVal,
            checkedIn ? (new Date(Date.now() - 3600000).toISOString()) : null,
            checkedIn ? DEV_ORGANIZER_ID : null,
            actualRegId
          ]
        );
      } else {
        await client.query(
          `INSERT INTO registrations (id, event_id, user_id, price_minor, currency, status, token_hash, idempotency_key, checked_in_at, checked_in_by, created_at)
           VALUES ($1, $2, $3, $4, 'INR', $5, $6, $7, $8, $9, now() - interval '3 days')
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status,
             token_hash = EXCLUDED.token_hash,
             checked_in_at = EXCLUDED.checked_in_at,
             checked_in_by = EXCLUDED.checked_in_by`,
          [
            actualRegId,
            eventId,
            userId,
            priceMinor,
            status,
            tokenHashVal,
            internalKey,
            checkedIn ? (new Date(Date.now() - 3600000).toISOString()) : null,
            checkedIn ? DEV_ORGANIZER_ID : null
          ]
        );
      }

      // If confirmed, record payment
      if (status === 'confirmed') {
        const existingPay = await client.query(
          `SELECT id FROM payment_records WHERE registration_id = $1`, [actualRegId]
        );
        if (!existingPay.rows[0]) {
          const payId = crypto.randomUUID();
          await client.query(
            `INSERT INTO payment_records (id, registration_id, amount_minor, currency, method, external_reference, notes, recorded_by, idempotency_key, created_at)
             VALUES ($1, $2, $3, 'INR', 'razorpay_upi', 'UPI-TICKET-${actualRegId.slice(0, 8)}', 'Event Registration Ticket', $4, $5, now() - interval '3 days')
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [payId, actualRegId, priceMinor, DEV_TREASURER_ID, `pay-idemp-reg-${actualRegId.slice(0, 8)}`]
          );
        }
      }

      return { rawCode, tokenHashVal };
    }

    // For each staff user (Om, Deep, Dev Member):
    // - Confirmed ticket for Annual Tech Symposium 2026 (ready to display in /tickets)
    // - Confirmed & Checked-in ticket for Web Development Intensive Workshop (shows "Used" badge)
    let tCount = 1;
    for (const userId of targetStaffUsers) {
      const reg1Id = `51000000-0000-0000-0000-${String(tCount++).padStart(12, '0')}`;
      const reg2Id = `51000000-0000-0000-0000-${String(tCount++).padStart(12, '0')}`;

      // Ticket 1: Symposium (Confirmed, Ready)
      await seedTicket({
        regId: reg1Id,
        eventId: EVENT_SYMPOSIUM_ID,
        userId,
        priceMinor: 25000,
        status: 'confirmed',
        checkedIn: false,
        key: `symposium-key-${userId.slice(0, 8)}`
      });

      // Ticket 2: Workshop (Confirmed, Checked-in / Used)
      await seedTicket({
        regId: reg2Id,
        eventId: EVENT_WORKSHOP_ID,
        userId,
        priceMinor: 10000,
        status: 'confirmed',
        checkedIn: true,
        key: `workshop-key-${userId.slice(0, 8)}`
      });
    }

    // Additional attendee tickets on Annual Tech Symposium for /staff/checkin dashboard:
    // - Aarav Sharma: Confirmed & Checked-in
    await seedTicket({
      regId: '52000000-0000-0000-0000-000000000001',
      eventId: EVENT_SYMPOSIUM_ID,
      userId: STUDENT_AARAV_ID,
      priceMinor: 25000,
      status: 'confirmed',
      checkedIn: true,
      key: 'key-symp-aarav-sharma'
    });

    // - Priya Patel: Confirmed, Awaiting Check-In with an easy-to-demo admission code
    const priyaDemo = await seedTicket({
      regId: '52000000-0000-0000-0000-000000000002',
      eventId: EVENT_SYMPOSIUM_ID,
      userId: STUDENT_PRIYA_ID,
      priceMinor: 25000,
      status: 'confirmed',
      checkedIn: false,
      key: 'key-symp-priya-patel',
      customToken: 'sky1_symposium_priya_patel_2026'
    });

    // - Rohan Mehta: Pending reservation on Symposium (Appears on /staff/payments for manual confirmation demo)
    await seedTicket({
      regId: '52000000-0000-0000-0000-000000000003',
      eventId: EVENT_SYMPOSIUM_ID,
      userId: STUDENT_ROHAN_ID,
      priceMinor: 50000,
      status: 'pending',
      checkedIn: false,
      key: 'key-symp-rohan-mehta-pending'
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 5. Realistic Volunteer Expenses & PDF Receipts (/expenses)
    // ──────────────────────────────────────────────────────────────────────────
    const receiptsDir = fileURLToPath(new URL('../../server/storage/receipts/', import.meta.url));
    await fs.mkdir(receiptsDir, { recursive: true });

    for (const userId of targetStaffUsers) {
      const exp1Key = `receipt_${userId.slice(0, 8)}_lighting.pdf`;
      const exp2Key = `receipt_${userId.slice(0, 8)}_printing.pdf`;
      const exp3Key = `receipt_${userId.slice(0, 8)}_catering.pdf`;

      await fs.writeFile(receiptsDir + exp1Key, receiptPdf('AV Equipment & Stage Lighting Rental', 'INV-2026-AV-01'));
      await fs.writeFile(receiptsDir + exp2Key, receiptPdf('A3 Poster Printing & Badges', 'INV-2026-PRN-09'));
      await fs.writeFile(receiptsDir + exp3Key, receiptPdf('Workshop Mentor Refreshments & Snacks', 'INV-2026-CAT-22'));

      await client.query(
        `INSERT INTO receipt_uploads (receipt_key, owner_id) VALUES ($1, $2), ($3, $2), ($4, $2) ON CONFLICT DO NOTHING`,
        [exp1Key, userId, exp2Key, exp3Key]
      );

      // Claim 1: Approved Liability
      await client.query(
        `INSERT INTO expenses (id, requester_id, amount_minor, currency, purpose, receipt_key, status, decided_at, decided_by, decision_reason, submitted_at)
         VALUES ($1, $2, 35000, 'INR', 'Stage lighting & microphone cables rental for Tech Symposium', $3, 'approved', now() - interval '2 days', $4, 'Approved per AV Technical Budget', now() - interval '3 days')
         ON CONFLICT (id) DO NOTHING`,
        [crypto.randomUUID(), userId, exp1Key, DEV_TREASURER_ID]
      );

      // Claim 2: Reimbursed
      await client.query(
        `INSERT INTO expenses (id, requester_id, amount_minor, currency, purpose, receipt_key, status, decided_at, decided_by, decision_reason, reimbursed_at, reimbursed_by, reimbursement_reference, reimbursement_idempotency_key, submitted_at)
         VALUES ($1, $2, 12000, 'INR', 'A3 Poster & signage printing for campus noticeboards', $3, 'reimbursed', now() - interval '5 days', $4, 'Approved campus outreach printing', now() - interval '4 days', $4, 'UPI-REF-99281726', $5, now() - interval '6 days')
         ON CONFLICT (id) DO NOTHING`,
        [crypto.randomUUID(), userId, exp2Key, DEV_TREASURER_ID, `reimb-key-${userId.slice(0, 8)}-02`]
      );

      // Claim 3: Submitted (Pending Treasurer Review)
      await client.query(
        `INSERT INTO expenses (id, requester_id, amount_minor, currency, purpose, receipt_key, status, submitted_at)
         VALUES ($1, $2, 24000, 'INR', 'Refreshment snacks & hot tea for workshop attendees', $3, 'submitted', now() - interval '2 hours')
         ON CONFLICT (id) DO NOTHING`,
        [crypto.randomUUID(), userId, exp3Key]
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 6. Community Volunteer Tasks (/tasks)
    // ──────────────────────────────────────────────────────────────────────────
    for (const userId of targetStaffUsers) {
      const userTasks = [
        {
          id: crypto.randomUUID(),
          title: 'Prepare attendee check-in badge scanner kiosk',
          description: 'Set up camera scanners and printed lanyards at the Main Auditorium Entrance.',
          status: 'todo',
          eventId: EVENT_SYMPOSIUM_ID,
        },
        {
          id: crypto.randomUUID(),
          title: 'Review keynote speaker slide decks and display aspect ratio',
          description: 'Verify 16:9 projection compatibility on the main auditorium stage screen.',
          status: 'in_progress',
          eventId: EVENT_SYMPOSIUM_ID,
        },
        {
          id: crypto.randomUUID(),
          title: 'Distribute volunteer team merchandise and shirts',
          description: 'Hand out official volunteer t-shirts and staff badges to assigned team leads.',
          status: 'done',
          eventId: EVENT_SYMPOSIUM_ID,
        },
        {
          id: crypto.randomUUID(),
          title: 'Set up engineering lab workstations for hands-on workshop',
          description: 'Verify Node.js and Docker environment images are pre-pulled on student terminals.',
          status: 'in_progress',
          eventId: EVENT_WORKSHOP_ID,
        },
      ];

      for (const t of userTasks) {
        await client.query(
          `INSERT INTO volunteer_tasks (id, title, description, assignee_id, created_by, event_id, status, due_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '3 days')
           ON CONFLICT (id) DO NOTHING`,
          [t.id, t.title, t.description, userId, DEV_ORGANIZER_ID, t.eventId, t.status]
        );
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 7. Community Mail Outbox Logs (/mail, /staff/mail)
    // ──────────────────────────────────────────────────────────────────────────
    for (const userId of targetStaffUsers) {
      const messages = [
        {
          sourceKey: `mail_welcome_${userId.slice(0, 8)}`,
          subject: 'Welcome to Skyline Student Association (2026–2027) 🎓',
          body: 'Hello and welcome! Your membership is active. You can now access discounted workshop tickets, voting privileges, and exclusive merchandise discounts.',
          status: 'previewed',
        },
        {
          sourceKey: `mail_ticket_${userId.slice(0, 8)}`,
          subject: 'Ticket Confirmation: Annual Tech Symposium 2026 (Ref: #SKY-SYM-2026) 🎟️',
          body: 'Your ticket reservation for the Annual Tech Symposium is confirmed. Please present your digital admission QR code at the Main Auditorium desk on Nov 15th.',
          status: 'previewed',
        },
        {
          sourceKey: `mail_order_${userId.slice(0, 8)}`,
          subject: 'Order Confirmed: Official Skyline Club Hoodie 📦',
          body: 'Your club merchandise order has been processed. Pickup is available at Student Union Desk B between 10am and 4pm on weekdays.',
          status: 'previewed',
        },
        {
          sourceKey: `mail_briefing_${userId.slice(0, 8)}`,
          subject: 'Volunteer Briefing & Schedule: Winter Hackathon 2026 📋',
          body: 'Thank you for volunteering! The all-hands briefing will take place this Friday at 4pm in Central Wing Room 204.',
          status: 'queued',
        },
      ];

      for (const m of messages) {
        await client.query(
          `INSERT INTO message_outbox (user_id, source_key, subject, body, status, created_at, processed_at)
           VALUES ($1, $2, $3, $4, $5, now() - interval '2 days', now() - interval '2 days')
           ON CONFLICT (user_id, source_key) DO NOTHING`,
          [userId, m.sourceKey, m.subject, m.body, m.status]
        );
      }
    }

    await client.query('COMMIT');
    console.log('✅ Comprehensive demo seed data populated successfully.');
    console.log(`💡 Demo Check-in Code for Priya Patel: ${priyaDemo.rawCode}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed execution error:', err);
    throw err;
  } finally {
    client.release();
  }
}
