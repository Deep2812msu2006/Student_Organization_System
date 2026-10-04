import jwt from 'jsonwebtoken';

const DEFAULT_SECRET = 'skyline-student-org-system-jwt-secret-key-32chars!';

export function signJwt(payload, secret = DEFAULT_SECRET, options = {}) {
  const jwtSecret = secret || DEFAULT_SECRET;
  return jwt.sign(payload, jwtSecret, {
    expiresIn: '7d',
    ...options,
  });
}

export function verifyJwt(token, secret = DEFAULT_SECRET) {
  try {
    const jwtSecret = secret || DEFAULT_SECRET;
    return jwt.verify(token, jwtSecret);
  } catch (_err) {
    return null;
  }
}
