import bcrypt from 'bcryptjs';
import { createUser, assignRole, findUserByEmail, getUserRoles } from '../model/auth.model.js';
import { transaction } from '../utils/transaction.js';
import { HttpError } from '../utils/httpError.js';

const dummyHash = bcrypt.hashSync('timing-only-not-an-account', 12);
// @flow:MEMBER_SIGNUP — user and least-privilege role persist atomically; dues are a separate enrollment.
export async function register(pool, { name, email, password }) {
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    return await transaction(pool, async client => {
      const user = await createUser(client, { name, email, passwordHash });
      await assignRole(client, { userId: user.id, roleName: 'member' });
      return { ...user, roles: ['member'] };
    });
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    throw error;
  }
}
export async function login(pool, { email, password }) {
  const user = await findUserByEmail(pool, email);
  const valid = await bcrypt.compare(password, user?.passwordHash || dummyHash);
  if (!user || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  const { passwordHash: _secret, ...safe } = user;
  return { ...safe, roles: await getUserRoles(pool, user.id) };
}
