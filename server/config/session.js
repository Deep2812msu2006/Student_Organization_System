import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

export const cookieName = 'student_org.sid';
export function sessionMiddleware(pool, config) {
  const Store = connectPgSimple(session);
  const store = new Store({ pool, tableName: 'sessions', createTableIfMissing: false, pruneSessionInterval: false,
    errorLog: () => console.error('Session storage operation failed.') });
  return session({ name: cookieName, store, secret: config.sessionSecret,
    resave: false, saveUninitialized: false, rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: 8 * 60 * 60 * 1000 },
  });
}
