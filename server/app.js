import express from 'express';
import { sessionMiddleware } from './config/session.js';
import { memberRouter } from './routes/member.routes.js';
import helmet from 'helmet';
import {eventRouter} from './routes/event.routes.js';
import { checkinRouter } from './routes/checkin.routes.js';
import { merchandiseRouter } from './routes/merchandise.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { errorHandler, notFound } from './middleware/error.middleware.js';

export function createApp(database, config = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.get('/api/live', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ data: { status: 'ok', api: 'available' } });
  });
  app.use('/api', healthRouter(database));
  if (config.trustProxy) app.set('trust proxy', 1);
  if (database.configured && config.sessionSecret) {
    app.use(
      '/api/v1',
      sessionMiddleware(database.pool, config),
      eventRouter(database.pool, config),
      memberRouter(database.pool, config),
      checkinRouter(database.pool, config),
      merchandiseRouter(database.pool, config)
    );
  }
  // Without configured DB/session secret, no business route is exposed.
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
