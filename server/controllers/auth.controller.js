import * as auth from '../services/auth.service.js';
import { csrfToken } from '../middleware/auth.middleware.js';
import { cookieName } from '../config/session.js';

async function startSession(req, user) {
  await new Promise((resolve,reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  const token = csrfToken(req);
  await new Promise((resolve,reject) => req.session.save(error => error ? reject(error) : resolve()));
  return { user, csrfToken: token };
}
export function authController(pool) {
  return {
    csrf: (req,res) => res.json({ data: { csrfToken: csrfToken(req) } }),
    register: async (req,res) => res.status(201).json({ data: await startSession(req, await auth.register(pool, req.validated)) }),
    login: async (req,res) => res.json({ data: await startSession(req, await auth.login(pool, req.validated)) }),
    me: (req,res) => res.json({ data: { user: req.user, csrfToken: csrfToken(req) } }),
    logout: async (req,res) => {
      await new Promise((resolve,reject) => req.session.destroy(error => error ? reject(error) : resolve()));
      res.clearCookie(cookieName, { path: '/' }); res.status(204).end();
    },
  };
}
