import test from 'node:test';
import assert from 'node:assert/strict';
import { signJwt, verifyJwt } from '../utils/jwt.js';
import { requireUser, requireRole } from '../middleware/auth.middleware.js';
import { HttpError } from '../utils/httpError.js';

test('JWT utilities: signs, verifies, and rejects tampered or expired tokens', () => {
  const secret = 'test-secret-at-least-32-chars-long-here!!';
  const payload = { userId: 'usr-1234', email: 'test@example.com', roles: ['member'] };

  // 1. Valid signature
  const token = signJwt(payload, secret, { expiresIn: '1h' });
  assert.ok(typeof token === 'string' && token.split('.').length === 3);

  const decoded = verifyJwt(token, secret);
  assert.equal(decoded.userId, payload.userId);
  assert.equal(decoded.email, payload.email);
  assert.deepEqual(decoded.roles, payload.roles);

  // 2. Tampered token rejection
  const tampered = token.slice(0, -5) + 'xxxxx';
  assert.equal(verifyJwt(tampered, secret), null);

  // 3. Wrong secret rejection
  assert.equal(verifyJwt(token, 'different-wrong-secret-key-12345678'), null);

  // 4. Expired token rejection
  const expiredToken = signJwt(payload, secret, { expiresIn: '0s' });
  assert.equal(verifyJwt(expiredToken, secret), null);
});

test('JWT Authorization middleware: requireRole enforces least-privilege permissions', () => {
  const organizerGuard = requireRole('organizer');
  const treasurerGuard = requireRole('treasurer', 'organizer');

  // Member role only -> forbidden for organizer
  const memberReq = { user: { id: 'usr-1', roles: ['member'] } };
  let errorCaught = null;
  organizerGuard(memberReq, {}, (err) => { errorCaught = err; });
  assert.ok(errorCaught instanceof HttpError);
  assert.equal(errorCaught.status, 403);
  assert.equal(errorCaught.code, 'FORBIDDEN');

  // Organizer role -> allowed
  const organizerReq = { user: { id: 'usr-2', roles: ['organizer'] } };
  let passed = false;
  organizerGuard(organizerReq, {}, (err) => { if (!err) passed = true; });
  assert.ok(passed);

  // Treasurer role -> allowed for treasurer/organizer guard
  const treasurerReq = { user: { id: 'usr-3', roles: ['treasurer'] } };
  let treasurerPassed = false;
  treasurerGuard(treasurerReq, {}, (err) => { if (!err) treasurerPassed = true; });
  assert.ok(treasurerPassed);
});

test('JWT Authentication middleware: requireUser accepts valid Bearer token and rejects unauthenticated', async () => {
  const secret = 'test-secret-at-least-32-chars-long-here!!';
  const mockPool = {};
  const authMiddleware = requireUser(mockPool, { jwtSecret: secret });

  // 1. Missing auth -> 401
  const emptyReq = { get: () => null, session: {} };
  await assert.rejects(
    async () => {
      await authMiddleware(emptyReq, {}, () => {});
    },
    (err) => err.status === 401 && err.code === 'UNAUTHENTICATED'
  );

  // 2. Invalid Bearer token -> 401 INVALID_TOKEN
  const invalidReq = { get: (name) => name === 'Authorization' ? 'Bearer invalid.bogus.token' : null, session: {} };
  let invalidErr = null;
  await authMiddleware(invalidReq, {}, (err) => { invalidErr = err; });
  assert.ok(invalidErr instanceof HttpError);
  assert.equal(invalidErr.status, 401);
  assert.equal(invalidErr.code, 'INVALID_TOKEN');
});
