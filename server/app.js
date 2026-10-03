import express from 'express';
import helmet from 'helmet';
import { healthRouter } from './routes/health.routes.js';
import { errorHandler, notFound } from './middleware/error.middleware.js';

export function createApp(database) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.get('/api/live', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ data: { status: 'ok', api: 'available' } });
  });
  app.use('/api', healthRouter(database));
  // Business routers will be mounted at /api/v1 after authentication and validation exist.
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
