/**
 * auth.model.test.js — Deep owns this file.
 *
 * Tests for server/model/auth.model.js.
 *
 * Uses NODE_TEST_DATABASE_URL (a dedicated isolated test database) to avoid
 * touching the development database. Set it before running:
 *
 *   $env:NODE_TEST_DATABASE_URL = "postgresql://club_user:...@127.0.0.1:5432/student_org_test"
 *   npm run test:models
 *
 * The test database must have migrations applied before these tests run:
 *   $env:DATABASE_URL = "postgresql://club_user:...@127.0.0.1:5432/student_org_test"
 *   npm run migrate
 *
 * Each test cleans up the rows it inserts. Tests are intentionally isolated
 * and do not depend on dev seeds.
 *
 * Covers:
 *  - createUser returns safe profile (no passwordHash).
 *  - findUserByEmail with normalized email.
 *  - @rule:EMAIL_UNIQUENESS: duplicate normalized email rejected (23505).
 *  - findUserById returns safe profile or null.
 *  - assignRole: idempotent, no duplicate error.
 *  - getUserRoles: correct list.
 *  - Transaction rollback leaves no partial records.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  findUserByEmail,
  createUser,
  findUserById,
  assignRole,
  getUserRoles,
} from '../model/auth.model.js';

const TEST_DB_URL = process.env.NODE_TEST_DATABASE_URL;

function skipIfNoTestDb(t) {
  if (!TEST_DB_URL) {
    t.skip('NODE_TEST_DATABASE_URL not set; skipping model test');
    return true;
  }
  return false;
}

function makePool() {
  const pool = new pg.Pool({
    connectionString: TEST_DB_URL,
    max: 3,
    connectionTimeoutMillis: 3000,
  });
  pool.on('error', () => {});
  return pool;
}

// Cleanup helper — deletes test rows after each test.
async function cleanup(pool, emails) {
  if (!emails.length) return;
  const normalized = emails.map(e => e.toLowerCase());
  await pool.query(
    `DELETE FROM users WHERE lower(email) = ANY($1::text[])`,
    [normalized]
  );
}

test('createUser returns safe profile without passwordHash', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();
  t.after(() => pool.end());

  const email = 'test-create-safe@example.test';
  t.after(() => cleanup(pool, [email]));

  const user = await createUser(pool, {
    name: 'Test Create Safe',
    email,
    passwordHash: '$2b$12$fakehash',
  });

  assert.ok(user.id, 'id must be present');
  assert.equal(user.name, 'Test Create Safe');
  assert.equal(user.email, email);
  assert.ok(user.createdAt, 'createdAt must be present');
  // @rule:EMAIL_UNIQUENESS: no password hash in returned object.
  assert.ok(!('passwordHash' in user), 'passwordHash must NOT be returned');
  assert.ok(!('password_hash' in user), 'password_hash must NOT be returned');
});

test('findUserByEmail returns user including passwordHash for auth', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();
  t.after(() => pool.end());

  const email = 'test-find-email@example.test';
  t.after(() => cleanup(pool, [email]));

  await createUser(pool, { name: 'Find Email', email, passwordHash: '$2b$12$findtest' });
  // @rule:EMAIL_UNIQUENESS: normalize before lookup.
  const found = await findUserByEmail(pool, email.toLowerCase());

  assert.ok(found, 'user must be found');
  assert.equal(found.email, email);
  // passwordHash IS returned here (for Om's bcrypt.compare only).
  assert.equal(found.passwordHash, '$2b$12$findtest', 'passwordHash must be returned for auth comparison');
});

test('findUserByEmail is case-insensitive (@rule:EMAIL_UNIQUENESS)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();
  t.after(() => pool.end());

  const email = 'CaseEmail@Example.Test';
  t.after(() => cleanup(pool, [email]));

  await createUser(pool, { name: 'Case Test', email, passwordHash: '$2b$12$x' });

  const found = await findUserByEmail(pool, 'caseemail@example.test');
  assert.ok(found, 'must find by lowercase normalized email');

  const notFound = await findUserByEmail(pool, 'notexist@example.test');
  assert.equal(notFound, null, 'missing email must return null');
});

test('duplicate normalized email is rejected (@rule:EMAIL_UNIQUENESS)', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();
  t.after(() => pool.end());

  const email = 'dup@example.test';
  t.after(() => cleanup(pool, [email]));

  await createUser(pool, { name: 'Original', email, passwordHash: '$2b$12$x' });

  // Exact duplicate.
  await assert.rejects(
    () => createUser(pool, { name: 'Duplicate', email, passwordHash: '$2b$12$x' }),
    err => {
      assert.equal(err.code, '23505', 'must be unique_violation');
      return true;
    }
  );

  // Case-variant duplicate — normalized index still catches it.
  await assert.rejects(
    () => createUser(pool, { name: 'Case Dup', email: 'DUP@EXAMPLE.TEST', passwordHash: '$2b$12$x' }),
    err => {
      assert.equal(err.code, '23505', 'case-variant must also be rejected');
      return true;
    }
  );
});

test('findUserById returns safe profile or null', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();
  t.after(() => pool.end());

  const email = 'test-by-id@example.test';
  t.after(() => cleanup(pool, [email]));

  const created = await createUser(pool, { name: 'By ID', email, passwordHash: '$2b$12$x' });
  const found = await findUserById(pool, created.id);

  assert.ok(found, 'must find by id');
  assert.equal(found.id, created.id);
  assert.ok(!('passwordHash' in found), 'no hash in findUserById result');

  const missing = await findUserById(pool, '00000000-0000-0000-0000-000000000000');
  assert.equal(missing, null, 'non-existent id must return null');
});

test('assignRole is idempotent; getUserRoles returns sorted list', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();
  t.after(() => pool.end());

  const email = 'test-roles@example.test';
  t.after(() => cleanup(pool, [email]));

  const user = await createUser(pool, { name: 'Role Test', email, passwordHash: '$2b$12$x' });

  await assignRole(pool, { userId: user.id, roleName: 'member' });
  await assignRole(pool, { userId: user.id, roleName: 'organizer' });
  // Duplicate — must not throw.
  await assert.doesNotReject(() => assignRole(pool, { userId: user.id, roleName: 'member' }));

  const roles = await getUserRoles(pool, user.id);
  assert.deepEqual(roles, ['member', 'organizer'], 'roles must be sorted');
});

test('transaction rollback leaves no partial user record', async t => {
  if (skipIfNoTestDb(t)) return;
  const pool = makePool();
  t.after(() => pool.end());

  const email = 'test-rollback@example.test';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await createUser(client, { name: 'Rollback Test', email, passwordHash: '$2b$12$x' });
    // Intentional rollback before commit.
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  // The user must not exist after rollback.
  const result = await findUserByEmail(pool, email);
  assert.equal(result, null, 'rolled-back user must not persist');
});
