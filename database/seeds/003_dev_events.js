/**
 * Seed 003 — synthetic development events and registrations.
 *
 * @rule:EVENT_CAPACITY
 * @rule:CHECKIN_ONCE
 *
 * Creates representative synthetic event and registration states for testing:
 *   - Published event with capacity 100 (one confirmed ticket, one pending ticket).
 *   - Published workshop with capacity 20 (one ticket already checked-in).
 *   - Draft hackathon event (not yet published).
 *
 * This is a local dev seed; none of these records represent real students or events.
 */

import crypto from 'node:crypto';

const ORGANIZER_USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBER_USER_ID    = '10000000-0000-0000-0000-000000000001';
const TREASURER_USER_ID = '10000000-0000-0000-0000-000000000003';

const EVENT_1_ID = '40000000-0000-0000-0000-000000000001';
const EVENT_2_ID = '40000000-0000-0000-0000-000000000002';
const EVENT_3_DRAFT_ID = '40000000-0000-0000-0000-000000000003';

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function seed(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Published Tech Symposium
    await client.query(`
      INSERT INTO events
        (id, title, description, venue, starts_at, ends_at, capacity,
         member_price_minor, public_price_minor, currency, status, created_by)
      VALUES
        (
          $1,
          'Annual Tech Symposium 2026',
          'Flagship annual technology symposium featuring keynotes, panel discussions, and project showcases.',
          'Main Auditorium, Campus Center',
          '2026-11-15 09:00:00+00',
          '2026-11-15 17:00:00+00',
          100,
          25000, -- 250.00 INR (member price)
          50000, -- 500.00 INR (public price)
          'INR',
          'published',
          $2
        )
      ON CONFLICT (id) DO NOTHING
    `, [EVENT_1_ID, ORGANIZER_USER_ID]);

    // 2. Published Web Dev Workshop
    await client.query(`
      INSERT INTO events
        (id, title, description, venue, starts_at, ends_at, capacity,
         member_price_minor, public_price_minor, currency, status, created_by)
      VALUES
        (
          $1,
          'Web Development Intensive Workshop',
          'Hands-on full-stack web development workshop covering modern backend and frontend workflows.',
          'Engineering Lab 3B',
          '2026-12-01 14:00:00+00',
          '2026-12-01 18:00:00+00',
          20,
          10000, -- 100.00 INR
          20000, -- 200.00 INR
          'INR',
          'published',
          $2
        )
      ON CONFLICT (id) DO NOTHING
    `, [EVENT_2_ID, ORGANIZER_USER_ID]);

    // 3. Draft Hackathon (not published)
    await client.query(`
      INSERT INTO events
        (id, title, description, venue, starts_at, ends_at, capacity,
         member_price_minor, public_price_minor, currency, status, created_by)
      VALUES
        (
          $1,
          'Spring Hackathon 2027',
          '24-hour collaborative hackathon for building innovative campus solutions.',
          'Student Union Hall',
          '2027-02-20 10:00:00+00',
          '2027-02-21 18:00:00+00',
          50,
          0,     -- Free for members
          15000, -- 150.00 INR for non-members
          'INR',
          'draft',
          $2
        )
      ON CONFLICT (id) DO NOTHING
    `, [EVENT_3_DRAFT_ID, ORGANIZER_USER_ID]);

    // ─── Synthetic Registrations ───────────────────────────────────────────────

    // Confirmed ticket for dev-member on Event 1 (ready for check-in)
    await client.query(`
      INSERT INTO registrations
        (id, event_id, user_id, price_minor, currency, status, token_hash, idempotency_key)
      VALUES
        (
          '50000000-0000-0000-0000-000000000001',
          $1,
          $2,
          25000,
          'INR',
          'confirmed',
          $3,
          'idemp_seed_reg_001'
        )
      ON CONFLICT (id) DO NOTHING
    `, [EVENT_1_ID, MEMBER_USER_ID, hashToken('dev_ticket_member_event1')]);

    // Confirmed and ALREADY CHECKED-IN ticket for dev-member on Event 2
    // @rule:CHECKIN_ONCE: checkInEligibleTicket will reject subsequent check-in attempts.
    await client.query(`
      INSERT INTO registrations
        (id, event_id, user_id, price_minor, currency, status, token_hash, idempotency_key, checked_in_at, checked_in_by)
      VALUES
        (
          '50000000-0000-0000-0000-000000000002',
          $1,
          $2,
          10000,
          'INR',
          'confirmed',
          $3,
          'idemp_seed_reg_002',
          '2026-12-01 14:15:00+00',
          $4
        )
      ON CONFLICT (id) DO NOTHING
    `, [EVENT_2_ID, MEMBER_USER_ID, hashToken('dev_ticket_member_event2_checked_in'), ORGANIZER_USER_ID]);

    // Pending ticket for dev-treasurer on Event 1
    // @rule:EVENT_CAPACITY: pending status consumes 1 seat of capacity.
    await client.query(`
      INSERT INTO registrations
        (id, event_id, user_id, price_minor, currency, status, token_hash, idempotency_key)
      VALUES
        (
          '50000000-0000-0000-0000-000000000003',
          $1,
          $2,
          50000,
          'INR',
          'pending',
          $3,
          'idemp_seed_reg_003'
        )
      ON CONFLICT (id) DO NOTHING
    `, [EVENT_1_ID, TREASURER_USER_ID, hashToken('dev_ticket_treasurer_event1_pending')]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
