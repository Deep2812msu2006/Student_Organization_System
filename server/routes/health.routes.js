import { Router } from 'express';
import { createHealthController } from '../controllers/health.controller.js';

export function healthRouter(database) {
  const router = Router();
  router.get('/health', createHealthController(database));
  return router;
}
