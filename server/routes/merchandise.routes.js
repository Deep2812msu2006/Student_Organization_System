import { Router } from 'express';
import { requireUser, requireCsrf } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  idSchema,
  idempotencySchema,
  productQuerySchema,
  orderCreateSchema,
  cancelOrderSchema,
  orderPaginationSchema,
} from '../validators/merchandise.schema.js';
import { HttpError } from '../utils/httpError.js';
import * as service from '../services/merchandise.service.js';

export function merchandiseRouter(pool, _config) {
  const router = Router();
  const auth = requireUser(pool);

  // Validate UUID params safely
  router.param('id', (_req, _res, next, value) => {
    if (!idSchema.safeParse(value).success) {
      return next(new HttpError(400, 'INVALID_ID', 'Invalid resource identifier format.'));
    }
    next();
  });

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // ─── Public Catalog Endpoints ───────────────────────────────────────────────

  // GET /products: Catalog list with category filtering and pagination
  router.get('/products', validate(productQuerySchema, 'query'), async (req, res) => {
    const result = await service.listCatalog(pool, req.validated);
    res.json({
      data: result.rows,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      },
    });
  });

  // GET /products/:id: Product details with active variants and stock levels
  router.get('/products/:id', async (req, res) => {
    const product = await service.detailProduct(pool, req.params.id);
    res.json({ data: product });
  });

  // ─── Authenticated Order Endpoints ──────────────────────────────────────────

  // POST /orders: Place order with atomic stock allocation and idempotency key
  router.post('/orders', auth, requireCsrf, validate(orderCreateSchema), async (req, res) => {
    const rawKey = req.get('Idempotency-Key');
    const parsedKey = idempotencySchema.safeParse(rawKey);
    if (!parsedKey.success) {
      throw new HttpError(
        400,
        'INVALID_IDEMPOTENCY_KEY',
        'Supply a valid 16–100 character Idempotency-Key header (letters, digits, underscore or hyphen).'
      );
    }

    const result = await service.submitOrder(pool, req.user.id, req.validated, parsedKey.data);
    res.status(result.replayed ? 200 : 201).json({
      data: result.order,
      replayed: result.replayed,
    });
  });

  // GET /orders/me: Customer order history (paginated)
  router.get('/orders/me', auth, validate(orderPaginationSchema, 'query'), async (req, res) => {
    const result = await service.listCustomerOrders(pool, req.user.id, req.validated);
    res.json({
      data: result.rows,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      },
    });
  });

  // GET /orders/:id: Customer single order view (enforcing ownership)
  router.get('/orders/:id', auth, async (req, res) => {
    const order = await service.getCustomerOrder(pool, req.params.id, req.user.id);
    res.json({ data: order });
  });

  // POST /orders/:id/cancel: Customer cancellation (restores stock if pending/paid)
  router.post('/orders/:id/cancel', auth, requireCsrf, validate(cancelOrderSchema), async (req, res) => {
    const order = await service.cancelCustomerOrder(
      pool,
      req.params.id,
      req.user.id,
      req.validated?.reason
    );
    res.json({ data: order });
  });

  return router;
}
