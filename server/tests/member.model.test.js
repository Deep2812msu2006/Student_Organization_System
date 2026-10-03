/**
 * member.model.test.js — Deep owns this file.
 *
 * Tests for server/model/member.model.js.
 *
 * Requires NODE_TEST_DATABASE_URL (isolated test database with migrations applied).
 *
 * Covers:
 *  - @rule:MEMBERSHIP_VALIDITY: active, pending, expired, future periods.
 *  - createMembership inside a transaction.
 *  - listMembers pagination.
 *  - Missing user returns null from getMemberProfile.
 *  - Transaction rollback leaves no partial membership.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createUser } from '../model/auth.model.js';
import { getMemberProfile, listMembers, createMembership } from '../model/member.model.js';

const TEST_DB_URL = process.env.NODE_TEST_DATABASE_URL;
const PLAN_ID = '00000000-0000-0000-0000-000000000001'; // inserted by migration 003

function skipIfNoTestDb(t) {
  if (!TEST_DB_URL) { t.skip('NODE_TEST_DATABASE_URL not set'); return true; }
  return false;
}

function makePool() {
  const pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 3, connectionTimeoutMillis: 3000 });
  pool.on('error', () => {});
  return pool;
}

async function cleanupUser(pool, email) {
  await pool.query(`DELETE FROM users WHERE lower(email) = $1`, [email.toLowerCase()]);
}

// Helper: create a user and a membership period + dues in a given state.
async function makeUserWithMembership(pool, opts) {
  const { email, name, startsAt, expiresAt, duesStatus, paidAt } = opts;
  const user = await createUser(pool, { name, email, passwordHash: '$2b$12$x' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await createMembership(client, {
      userId: user.id,
      planId: PLAN_ID,
      startsAt,
      expiresAt,
      duesAmountMinor: 50000,
      currency: 'INR',
    });
    // Update dues to desired status for testing.
    if (duesStatus !== 'pending') {
      await client.query(
        `UPDATE dues_obligations SET status = $1, paid_at = $2, updated_at = now()
           WHERE id = $3`,
        [duesStatus, paidAt ?? null, result.duesObligationId]
      );
    }
    await client.query('COMMIT');
    return { user, ...result };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const NOW = '2026-10-03T10:00:00.000Z';

test('getMemberProfile: active paid membership (@rule:MEMBERSHIP_VALIDITY)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const email = 'mp-active@example.test';
  t.after(() => cleanupUser(pool, email).finally(() => pool.end()));

  await makeUserWithMembership(pool, {
    email, name: 'Active Member',
    startsAt: '2026-04-01T00:00:00Z',
    expiresAt: '2027-03-31T23:59:59Z',
    duesStatus: 'paid',
    paidAt: '2026-04-02T00:00:00Z',
  });

  const user = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  const profile = await getMemberProfile(pool, user.rows[0].id, NOW);

  assert.equal(profile.membershipStatus, 'active', 'paid in-window period must be active');
  assert.equal(profile.duesStatus, 'paid');
  assert.ok(!('passwordHash' in profile), 'no hash in profile');
});

test('getMemberProfile: pending dues → status is pending, not active (@rule:MEMBERSHIP_VALIDITY)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const email = 'mp-pending@example.test';
  t.after(() => cleanupUser(pool, email).finally(() => pool.end()));

  await makeUserWithMembership(pool, {
    email, name: 'Pending Member',
    startsAt: '2026-04-01T00:00:00Z',
    expiresAt: '2027-03-31T23:59:59Z',
    duesStatus: 'pending',
  });

  const user = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  const profile = await getMemberProfile(pool, user.rows[0].id, NOW);

  assert.equal(profile.membershipStatus, 'pending');
});

test('getMemberProfile: expired period → status is expired (@rule:MEMBERSHIP_VALIDITY)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const email = 'mp-expired@example.test';
  t.after(() => cleanupUser(pool, email).finally(() => pool.end()));

  await makeUserWithMembership(pool, {
    email, name: 'Expired Member',
    startsAt: '2025-04-01T00:00:00Z',
    expiresAt: '2026-03-31T23:59:59Z',
    duesStatus: 'paid',
    paidAt: '2025-04-02T00:00:00Z',
  });

  const user = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  const profile = await getMemberProfile(pool, user.rows[0].id, NOW);

  assert.equal(profile.membershipStatus, 'expired');
});

test('getMemberProfile: future period → status is future (@rule:MEMBERSHIP_VALIDITY)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const email = 'mp-future@example.test';
  t.after(() => cleanupUser(pool, email).finally(() => pool.end()));

  await makeUserWithMembership(pool, {
    email, name: 'Future Member',
    startsAt: '2027-04-01T00:00:00Z',
    expiresAt: '2028-03-31T23:59:59Z',
    duesStatus: 'paid',
    paidAt: '2027-04-02T00:00:00Z',
  });

  const user = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  const profile = await getMemberProfile(pool, user.rows[0].id, NOW);

  assert.equal(profile.membershipStatus, 'future');
});

test('getMemberProfile: user with no membership → status is none', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const email = 'mp-none@example.test';
  t.after(() => cleanupUser(pool, email).finally(() => pool.end()));

  const user = await createUser(pool, { name: 'No Membership', email, passwordHash: '$2b$12$x' });
  const profile = await getMemberProfile(pool, user.id, NOW);

  assert.equal(profile.membershipStatus, 'none');
  assert.ok(!profile.membershipPeriodId, 'no period id for user with no membership');
});

test('getMemberProfile: non-existent userId → null', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();
  t.after(() => pool.end());

  const profile = await getMemberProfile(pool, '00000000-0000-0000-0000-deadbeef0000', NOW);
  assert.equal(profile, null);
});

test('listMembers returns paginated rows and total', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  // Create two synthetic users for listing.
  const emails = ['list-a@example.test', 'list-b@example.test'];
  t.after(() => Promise.all(emails.map(e => cleanupUser(pool, e))).finally(() => pool.end()));

  for (const [i, email] of emails.entries()) {
    await createUser(pool, { name: `List User ${i}`, email, passwordHash: '$2b$12$x' });
  }

  const result = await listMembers(pool, { page: 1, pageSize: 50 });
  assert.ok(typeof result.total === 'number', 'total must be a number');
  assert.ok(result.rows.length > 0, 'at least one row expected');

  const row = result.rows[0];
  assert.ok(!('passwordHash' in row), 'no password hash in list result');
  assert.ok('membershipStatus' in row, 'membershipStatus must be present');
});

test('createMembership rollback leaves no partial records', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();

  const email = 'mp-rollback@example.test';
  t.after(() => cleanupUser(pool, email).finally(() => pool.end()));

  const user = await createUser(pool, { name: 'MP Rollback', email, passwordHash: '$2b$12$x' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await createMembership(client, {
      userId: user.id, planId: PLAN_ID,
      startsAt: '2026-04-01T00:00:00Z',
      expiresAt: '2027-03-31T23:59:59Z',
      duesAmountMinor: 50000,
      currency: 'INR',
    });
    await client.query('ROLLBACK'); // intentional
  } finally {
    client.release();
  }

  const { rows } = await pool.query(
    'SELECT id FROM membership_periods WHERE user_id = $1', [user.id]
  );
  assert.equal(rows.length, 0, 'rolled-back membership must not persist');
});
