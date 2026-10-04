import { randomBytes, timingSafeEqual } from 'node:crypto';
import { findUserById, getUserRoles } from '../model/auth.model.js';
import { HttpError } from '../utils/httpError.js';
import { verifyJwt } from '../utils/jwt.js';

export function csrfToken(req) {
  if (!req.session) return randomBytes(32).toString('hex');
  req.session.csrfToken ||= randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

export function requireCsrf(req, _res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  // Authorization: Bearer <token> requests are authenticated via header, immune to cookie CSRF
  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }
  const actual = req.get('X-CSRF-Token');
  const expected = req.session?.csrfToken;
  if (typeof actual !== 'string' || !/^[a-f0-9]{64}$/.test(actual) || !expected || actual.length !== expected.length ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    return next(new HttpError(403, 'CSRF_INVALID', 'Your form session expired. Refresh the page and try again.'));
  }
  next();
}

export function requireUser(pool, config = {}) {
  return async (req, _res, next) => {
    // 1. If user was already resolved (e.g. from jwtAuthMiddleware)
    if (req.user && req.user.id) return next();

    // 2. Check Authorization Bearer header
    const authHeader = req.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const rawToken = authHeader.slice(7).trim();
      const jwtSecret = config?.jwtSecret || config?.sessionSecret;
      const decoded = verifyJwt(rawToken, jwtSecret);
      if (!decoded || !decoded.userId) {
        return next(new HttpError(401, 'INVALID_TOKEN', 'Authentication token is invalid or expired.'));
      }
      const user = await findUserById(pool, decoded.userId);
      if (!user) return next(new HttpError(401, 'UNAUTHENTICATED', 'User account was not found.'));
      const roles = decoded.roles && Array.isArray(decoded.roles) && decoded.roles.length > 0
        ? decoded.roles
        : await getUserRoles(pool, user.id);
      req.user = { ...user, roles };
      req.token = rawToken;
      if (req.session) req.session.userId = user.id;
      return next();
    }

    // 3. Fall back to Session Cookie
    if (!req.session?.userId) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    const user = await findUserById(pool, req.session.userId);
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    req.user = { ...user, roles: await getUserRoles(pool, user.id) };
    next();
  };
}

export function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, _res, next) => {
    if (!req.user || !req.user.roles) {
      return next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
    }
    return allowed.some(role => req.user.roles.includes(role))
      ? next()
      : next(new HttpError(403, 'FORBIDDEN', 'You do not have permission for this action.'));
  };
}

// Global pre-middleware to extract JWT if present on any request
export function jwtAuthMiddleware(pool, config = {}) {
  return async (req, _res, next) => {
    const authHeader = req.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const rawToken = authHeader.slice(7).trim();
      const jwtSecret = config?.jwtSecret || config?.sessionSecret;
      const decoded = verifyJwt(rawToken, jwtSecret);
      if (decoded && decoded.userId) {
        try {
          const user = await findUserById(pool, decoded.userId);
          if (user) {
            const roles = decoded.roles && Array.isArray(decoded.roles) && decoded.roles.length > 0
              ? decoded.roles
              : await getUserRoles(pool, user.id);
            req.user = { ...user, roles };
            req.token = rawToken;
            if (req.session) req.session.userId = user.id;
          }
        } catch (_err) {
          // Ignore background fetch error, requireUser will handle enforcement if needed
        }
      }
    }
    next();
  };
}

