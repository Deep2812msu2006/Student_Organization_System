import { randomBytes, timingSafeEqual } from 'node:crypto';
import { findUserById, getUserRoles } from '../model/auth.model.js';
import { HttpError } from '../utils/httpError.js';

export function csrfToken(req) {
  req.session.csrfToken ||= randomBytes(32).toString('hex');
  return req.session.csrfToken;
}
export function requireCsrf(req, _res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const actual = req.get('X-CSRF-Token');
  const expected = req.session.csrfToken;
  if (typeof actual !== 'string' || !/^[a-f0-9]{64}$/.test(actual) || !expected || actual.length !== expected.length ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    return next(new HttpError(403, 'CSRF_INVALID', 'Your form session expired. Refresh the page and try again.'));
  }
  next();
}
export function requireUser(pool) {
  return async (req, _res, next) => {
    if (!req.session.userId) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    const user = await findUserById(pool, req.session.userId);
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    req.user = { ...user, roles: await getUserRoles(pool, user.id) };
    next();
  };
}
export function requireRole(role) {
  return (req, _res, next) => req.user.roles.includes(role) ? next() : next(new HttpError(403, 'FORBIDDEN', 'You do not have permission for this action.'));
}
