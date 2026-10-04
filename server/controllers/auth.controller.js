import * as auth from '../services/auth.service.js';
import { csrfToken } from '../middleware/auth.middleware.js';
import { cookieName } from '../config/session.js';
import { signJwt } from '../utils/jwt.js';

async function startSession(req, user, config = {}) {
  if (req.session) {
    await new Promise((resolve,reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id;
  }
  const token = csrfToken(req);
  if (req.session) {
    await new Promise((resolve,reject) => req.session.save(error => error ? reject(error) : resolve()));
  }
  const jwtSecret = config.jwtSecret || config.sessionSecret;
  const jwtToken = signJwt({ userId: user.id, email: user.email, roles: user.roles || [] }, jwtSecret);
  return { user, token: jwtToken, accessToken: jwtToken, csrfToken: token };
}

export function authController(pool, config = {}) {
  return {
    csrf: (req,res) => res.json({ data: { csrfToken: csrfToken(req) } }),
    register: async (req,res) => res.status(201).json({ data: await startSession(req, await auth.register(pool, req.validated), config) }),
    login: async (req,res) => res.json({ data: await startSession(req, await auth.login(pool, req.validated), config) }),
    me: (req,res) => {
      const jwtSecret = config.jwtSecret || config.sessionSecret;
      const token = req.token || (req.user ? signJwt({ userId: req.user.id, email: req.user.email, roles: req.user.roles || [] }, jwtSecret) : null);
      return res.json({ data: { user: req.user, token, accessToken: token, csrfToken: csrfToken(req) } });
    },
    logout: async (req,res) => {
      if (req.session) {
        await new Promise((resolve,reject) => req.session.destroy(error => error ? reject(error) : resolve()));
      }
      res.clearCookie(cookieName, { path: '/' });
      res.status(204).end();
    },
  };
}
