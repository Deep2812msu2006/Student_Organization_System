/**
 * event.model.test.js — Deep owns this file.
 *
 * Tests for server/model/event.model.js.
 *
 * Requires NODE_TEST_DATABASE_URL (isolated test database with migrations applied).
 *
 * Covers:
 *  - listPublishedEvents pagination, published-only filtering, seatsAvailable calculation.
 *  - getEventById with seatsAvailable and null on missing ID.
 *  - createEvent inserting valid event record.
 *  - lockEventForBooking returning locked row or null.
 *  - @rule:EVENT_CAPACITY:
 *      - pending and confirmed registrations consume capacity; cancelled releases capacity.
 *      - CONCURRENCY TEST: Two simultaneous clients racing for the final seat (capacity = 1);
 *        exactly one must succeed and the other must be rejected (no overselling).
 *  - @rule:CHECKIN_ONCE:
 *      - confirmed ticket check-in succeeds once and sets checked_in_at.
 *      - second check-in attempt returns null.
 *      - check-in on pending or cancelled ticket returns null.
 *      - check-in with mismatched eventId or tokenHash returns null.
 *  - Idempotency key uniqueness rejection.
 *  - Duplicate active registration for same user & event rejection.
 *  - listUserTickets returns user's tickets with event metadata.
 *  - Transaction rollback leaves no persisted registration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import { createUser } from '../model/auth.model.js';
import {
  listPublishedEvents,
  getEventById,
  createEvent,
  lockEventForBooking,
  countAllocatedSeats,
  insertRegistration,
  checkInEligibleTicket,
  listUserTickets,
} from '../model/event.model.js';

const TEST_DB_URL = process.env.NODE_TEST_DATABASE_URL;

function skipIfNoTestDb(t) {
  if (!TEST_DB_URL) {
    t.skip('NODE_TEST_DATABASE_URL not set');
    return true;
  }
  return false;
}

function makePool(max = 5) {
  const pool = new pg.Pool({
    connectionString: TEST_DB_URL,
    max,
    connectionTimeoutMillis: 3000,
  });
  pool.on('error', () => {});
  return pool;
}

function hashToken(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function cleanupUser(pool, email) {
  await pool.query(`DELETE FROM users WHERE lower(email) = $1`, [email.toLowerCase()]);
}

async function cleanupEvent(pool, eventId) {
  await pool.query(`DELETE FROM events WHERE id = $1`, [eventId]);
}

test('listPublishedEvents returns only published events and correct seatsAvailable', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'events-list-test@example.test';
  let pubEventId = null;
  let draftEventId = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (pubEventId) await cleanupEvent(pool, pubEventId);
      if (draftEventId) await cleanupEvent(pool, draftEventId);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const organizer = await createUser(pool, {
    name: 'Event Organizer',
    email: userEmail,
    passwordHash: '$2b$12$test',
  });

  // Create 1 published event with capacity 10
  const pubEvent = await createEvent(pool, {
    title: 'Public Symposium',
    venue: 'Hall A',
    startsAt: '2026-11-01T10:00:00Z',
    endsAt: '2026-11-01T18:00:00Z',
    capacity: 10,
    memberPriceMinor: 1000,
    publicPriceMinor: 2000,
    currency: 'INR',
    createdBy: organizer.id,
    status: 'published',
  });
  pubEventId = pubEvent.id;

  // Create 1 draft event
  const draftEvent = await createEvent(pool, {
    title: 'Draft Workshop',
    venue: 'Hall B',
    startsAt: '2026-12-01T10:00:00Z',
    endsAt: '2026-12-01T18:00:00Z',
    capacity: 5,
    memberPriceMinor: 500,
    publicPriceMinor: 1000,
    currency: 'INR',
    createdBy: organizer.id,
    status: 'draft',
  });
  draftEventId = draftEvent.id;

  // Insert 1 confirmed registration on the published event
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertRegistration(client, {
      eventId: pubEvent.id,
      userId: organizer.id,
      priceMinor: 1000,
      currency: 'INR',
      status: 'confirmed',
      tokenHash: hashToken('token_test_1'),
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await listPublishedEvents(pool, { page: 1, pageSize: 50 });
  assert.ok(result.total >= 1, 'at least 1 published event total');
  const foundPub = result.rows.find(e => e.id === pubEvent.id);
  assert.ok(foundPub, 'published event must be returned');
  assert.equal(foundPub.seatsAvailable, 9, 'seatsAvailable must be capacity (10) - 1 = 9');

  const foundDraft = result.rows.find(e => e.id === draftEvent.id);
  assert.equal(foundDraft, undefined, 'draft event must not be returned');
});

test('getEventById returns event with seatsAvailable or null for non-existent', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'events-get-test@example.test';
  let eventId = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (eventId) await cleanupEvent(pool, eventId);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, {
    name: 'Get User',
    email: userEmail,
    passwordHash: '$2b$12$test',
  });

  const event = await createEvent(pool, {
    title: 'Single Event Get',
    venue: 'Room 101',
    startsAt: '2026-11-10T10:00:00Z',
    endsAt: '2026-11-10T12:00:00Z',
    capacity: 25,
    memberPriceMinor: 1500,
    publicPriceMinor: 3000,
    currency: 'INR',
    createdBy: user.id,
    status: 'published',
  });
  eventId = event.id;

  const fetched = await getEventById(pool, event.id);
  assert.ok(fetched, 'event must be returned');
  assert.equal(fetched.id, event.id);
  assert.equal(fetched.capacity, 25);
  assert.equal(fetched.seatsAvailable, 25);
  assert.equal(fetched.memberPriceMinor, 1500);

  const missing = await getEventById(pool, '00000000-0000-0000-0000-000000000000');
  assert.equal(missing, null, 'missing event returns null');
});

test('countAllocatedSeats counts pending and confirmed, but not cancelled (@rule:EVENT_CAPACITY)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const u1Email = 'cap-u1@example.test';
  const u2Email = 'cap-u2@example.test';
  const u3Email = 'cap-u3@example.test';
  let eventId = null;

  await cleanupUser(pool, u1Email);
  await cleanupUser(pool, u2Email);
  await cleanupUser(pool, u3Email);

  t.after(async () => {
    try {
      if (eventId) await cleanupEvent(pool, eventId);
      await cleanupUser(pool, u1Email);
      await cleanupUser(pool, u2Email);
      await cleanupUser(pool, u3Email);
    } finally {
      await pool.end();
    }
  });

  const u1 = await createUser(pool, { name: 'Cap U1', email: u1Email, passwordHash: '$2b$12$x' });
  const u2 = await createUser(pool, { name: 'Cap U2', email: u2Email, passwordHash: '$2b$12$x' });
  const u3 = await createUser(pool, { name: 'Cap U3', email: u3Email, passwordHash: '$2b$12$x' });

  const event = await createEvent(pool, {
    title: 'Capacity Test Event',
    venue: 'Auditorium',
    startsAt: '2026-11-20T10:00:00Z',
    endsAt: '2026-11-20T12:00:00Z',
    capacity: 10,
    memberPriceMinor: 1000,
    publicPriceMinor: 2000,
    currency: 'INR',
    status: 'published',
  });
  eventId = event.id;

  // 1 confirmed
  await insertRegistration(pool, {
    eventId: event.id,
    userId: u1.id,
    priceMinor: 1000,
    currency: 'INR',
    status: 'confirmed',
    tokenHash: hashToken('cap_tok_1'),
  });

  // 1 pending
  await insertRegistration(pool, {
    eventId: event.id,
    userId: u2.id,
    priceMinor: 1000,
    currency: 'INR',
    status: 'pending',
    tokenHash: hashToken('cap_tok_2'),
  });

  // 1 cancelled
  await insertRegistration(pool, {
    eventId: event.id,
    userId: u3.id,
    priceMinor: 1000,
    currency: 'INR',
    status: 'cancelled',
    tokenHash: hashToken('cap_tok_3'),
  });

  const allocated = await countAllocatedSeats(pool, event.id);
  assert.equal(allocated, 2, 'allocated seats must count pending (1) + confirmed (1) = 2, excluding cancelled (1)');
});

test('Concurrent booking race for final seat: exactly one succeeds (@rule:EVENT_CAPACITY)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool(10);

  const u1Email = 'race-u1@example.test';
  const u2Email = 'race-u2@example.test';
  let eventId = null;

  await cleanupUser(pool, u1Email);
  await cleanupUser(pool, u2Email);

  t.after(async () => {
    try {
      if (eventId) await cleanupEvent(pool, eventId);
      await cleanupUser(pool, u1Email);
      await cleanupUser(pool, u2Email);
    } finally {
      await pool.end();
    }
  });

  const u1 = await createUser(pool, { name: 'Race U1', email: u1Email, passwordHash: '$2b$12$x' });
  const u2 = await createUser(pool, { name: 'Race U2', email: u2Email, passwordHash: '$2b$12$x' });

  // Event with capacity = 1
  const event = await createEvent(pool, {
    title: 'Last Seat Race Event',
    venue: 'Exclusive Room',
    startsAt: '2026-11-25T10:00:00Z',
    endsAt: '2026-11-25T12:00:00Z',
    capacity: 1, // Only 1 seat!
    memberPriceMinor: 5000,
    publicPriceMinor: 10000,
    currency: 'INR',
    status: 'published',
  });
  eventId = event.id;

  // Function representing the transaction-aware booking service flow:
  async function attemptBooking(userId, token) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockedEvent = await lockEventForBooking(client, event.id);
      if (!lockedEvent) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'EVENT_NOT_FOUND' };
      }

      const allocated = await countAllocatedSeats(client, event.id);
      if (allocated >= lockedEvent.capacity) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'CAPACITY_EXCEEDED' };
      }

      const reg = await insertRegistration(client, {
        eventId: event.id,
        userId,
        priceMinor: lockedEvent.publicPriceMinor,
        currency: lockedEvent.currency,
        status: 'pending',
        tokenHash: hashToken(token),
        idempotencyKey: `idemp_${userId}_${event.id}`,
      });

      await client.query('COMMIT');
      return { success: true, registration: reg };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return { success: false, reason: err.message };
    } finally {
      client.release();
    }
  }

  // Execute two booking attempts concurrently
  const [result1, result2] = await Promise.all([
    attemptBooking(u1.id, 'race_token_u1'),
    attemptBooking(u2.id, 'race_token_u2'),
  ]);

  const successes = [result1, result2].filter(r => r.success);
  const failures = [result1, result2].filter(r => !r.success);

  assert.equal(successes.length, 1, 'exactly one concurrent request for final seat must succeed');
  assert.equal(failures.length, 1, 'second concurrent request must fail');
  assert.equal(failures[0].reason, 'CAPACITY_EXCEEDED', 'failed booking must be rejected due to capacity');

  const finalAllocated = await countAllocatedSeats(pool, event.id);
  assert.equal(finalAllocated, 1, 'final allocated seats must be exactly 1');
});

test('checkInEligibleTicket succeeds once and rejects duplicate/ineligible attempts (@rule:CHECKIN_ONCE)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'checkin-user@example.test';
  const staffEmail = 'checkin-staff@example.test';
  const pendingUserEmail = 'pen-u-checkin@example.test';
  let eventId = null;

  await cleanupUser(pool, userEmail);
  await cleanupUser(pool, staffEmail);
  await cleanupUser(pool, pendingUserEmail);

  t.after(async () => {
    try {
      if (eventId) await cleanupEvent(pool, eventId);
      await cleanupUser(pool, userEmail);
      await cleanupUser(pool, staffEmail);
      await cleanupUser(pool, pendingUserEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, { name: 'Ticket Holder', email: userEmail, passwordHash: '$2b$12$x' });
  const staff = await createUser(pool, { name: 'Gate Staff', email: staffEmail, passwordHash: '$2b$12$x' });
  const u2 = await createUser(pool, { name: 'Pending User', email: pendingUserEmail, passwordHash: '$2b$12$x' });

  const event = await createEvent(pool, {
    title: 'Checkin Test Event',
    venue: 'Gate 1',
    startsAt: '2026-11-30T10:00:00Z',
    endsAt: '2026-11-30T12:00:00Z',
    capacity: 50,
    memberPriceMinor: 1000,
    publicPriceMinor: 2000,
    currency: 'INR',
    status: 'published',
  });
  eventId = event.id;

  const validRawToken = 'unguessable_ticket_token_12345';
  const validTokenHash = hashToken(validRawToken);

  // 1. Confirmed ticket
  const reg = await insertRegistration(pool, {
    eventId: event.id,
    userId: user.id,
    priceMinor: 1000,
    currency: 'INR',
    status: 'confirmed',
    tokenHash: validTokenHash,
  });

  // First check-in: MUST succeed
  const checkin1 = await checkInEligibleTicket(pool, {
    eventId: event.id,
    tokenHash: validTokenHash,
    staffId: staff.id,
    at: '2026-11-30T10:05:00Z',
  });

  assert.ok(checkin1, 'first check-in must succeed');
  assert.equal(checkin1.registrationId, reg.id);
  assert.equal(checkin1.checkedInBy, staff.id);
  assert.ok(checkin1.checkedInAt, 'checkedInAt must be set');

  // Second check-in on the SAME ticket: MUST return null (@rule:CHECKIN_ONCE)
  const checkin2 = await checkInEligibleTicket(pool, {
    eventId: event.id,
    tokenHash: validTokenHash,
    staffId: staff.id,
    at: '2026-11-30T10:10:00Z',
  });

  assert.equal(checkin2, null, 'duplicate check-in attempt must return null');

  // Check-in on a pending ticket: MUST return null (unconfirmed)
  const pendingRawToken = 'pending_ticket_token_99999';
  const pendingTokenHash = hashToken(pendingRawToken);

  await insertRegistration(pool, {
    eventId: event.id,
    userId: u2.id,
    priceMinor: 1000,
    currency: 'INR',
    status: 'pending',
    tokenHash: pendingTokenHash,
  });

  const checkinPending = await checkInEligibleTicket(pool, {
    eventId: event.id,
    tokenHash: pendingTokenHash,
    staffId: staff.id,
  });
  assert.equal(checkinPending, null, 'check-in on pending ticket must return null');

  // Check-in with wrong eventId: MUST return null
  const checkinWrongEvent = await checkInEligibleTicket(pool, {
    eventId: '00000000-0000-0000-0000-000000000001',
    tokenHash: validTokenHash,
    staffId: staff.id,
  });
  assert.equal(checkinWrongEvent, null, 'check-in with wrong eventId must return null');
});

test('insertRegistration enforces idempotencyKey and single active registration per user per event', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'idemp-user@example.test';
  let eventId = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (eventId) await cleanupEvent(pool, eventId);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, { name: 'Idemp User', email: userEmail, passwordHash: '$2b$12$x' });
  const event = await createEvent(pool, {
    title: 'Idemp Test Event',
    venue: 'Hall 3',
    startsAt: '2026-12-10T10:00:00Z',
    endsAt: '2026-12-10T12:00:00Z',
    capacity: 50,
    memberPriceMinor: 1000,
    publicPriceMinor: 2000,
    currency: 'INR',
    status: 'published',
  });
  eventId = event.id;

  // First registration with idempotency key
  await insertRegistration(pool, {
    eventId: event.id,
    userId: user.id,
    priceMinor: 1000,
    currency: 'INR',
    status: 'pending',
    tokenHash: hashToken('idemp_tok_1'),
    idempotencyKey: 'booking_req_unique_key_1',
  });

  // Duplicate idempotencyKey with different token -> unique violation
  await assert.rejects(
    async () => {
      await insertRegistration(pool, {
        eventId: event.id,
        userId: user.id,
        priceMinor: 1000,
        currency: 'INR',
        status: 'pending',
        tokenHash: hashToken('idemp_tok_2'),
        idempotencyKey: 'booking_req_unique_key_1', // same key
      });
    },
    err => err.code === '23505',
    'duplicate idempotencyKey must raise unique violation (23505)'
  );

  // Duplicate active booking for the same user and event (different idempotency key)
  await assert.rejects(
    async () => {
      await insertRegistration(pool, {
        eventId: event.id,
        userId: user.id, // same user
        priceMinor: 1000,
        currency: 'INR',
        status: 'confirmed',
        tokenHash: hashToken('idemp_tok_3'),
        idempotencyKey: 'booking_req_unique_key_2',
      });
    },
    err => err.code === '23505',
    'second active booking for same user and event must raise unique violation'
  );
});

test('listUserTickets returns user tickets joined with event information', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'ticket-list-user@example.test';
  let eventId = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (eventId) await cleanupEvent(pool, eventId);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, { name: 'Ticket Collector', email: userEmail, passwordHash: '$2b$12$x' });
  const event = await createEvent(pool, {
    title: 'Festival 2026',
    venue: 'Open Grounds',
    startsAt: '2026-12-25T10:00:00Z',
    endsAt: '2026-12-25T22:00:00Z',
    capacity: 200,
    memberPriceMinor: 5000,
    publicPriceMinor: 10000,
    currency: 'INR',
    status: 'published',
  });
  eventId = event.id;

  await insertRegistration(pool, {
    eventId: event.id,
    userId: user.id,
    priceMinor: 5000,
    currency: 'INR',
    status: 'confirmed',
    tokenHash: hashToken('festival_tok_1'),
  });

  const tickets = await listUserTickets(pool, user.id);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].eventTitle, 'Festival 2026');
  assert.equal(tickets[0].eventVenue, 'Open Grounds');
  assert.equal(tickets[0].priceMinor, 5000);
  assert.equal(tickets[0].status, 'confirmed');
  assert.ok(!('tokenHash' in tickets[0]), 'raw tokenHash should not be leaked in listUserTickets');
});

test('transaction rollback leaves no registration record', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const userEmail = 'rollback-reg@example.test';
  let eventId = null;

  await cleanupUser(pool, userEmail);

  t.after(async () => {
    try {
      if (eventId) await cleanupEvent(pool, eventId);
      await cleanupUser(pool, userEmail);
    } finally {
      await pool.end();
    }
  });

  const user = await createUser(pool, { name: 'Rollback User', email: userEmail, passwordHash: '$2b$12$x' });
  const event = await createEvent(pool, {
    title: 'Rollback Event',
    venue: 'Lab A',
    startsAt: '2026-11-15T10:00:00Z',
    endsAt: '2026-11-15T12:00:00Z',
    capacity: 10,
    memberPriceMinor: 1000,
    publicPriceMinor: 2000,
    currency: 'INR',
    status: 'published',
  });
  eventId = event.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertRegistration(client, {
      eventId: event.id,
      userId: user.id,
      priceMinor: 1000,
      currency: 'INR',
      status: 'pending',
      tokenHash: hashToken('rollback_token_1'),
    });
    await client.query('ROLLBACK'); // intentional
  } finally {
    client.release();
  }

  const allocated = await countAllocatedSeats(pool, event.id);
  assert.equal(allocated, 0, 'rolled back registration must not consume capacity');

  const tickets = await listUserTickets(pool, user.id);
  assert.equal(tickets.length, 0, 'rolled back registration must not be returned');
});
