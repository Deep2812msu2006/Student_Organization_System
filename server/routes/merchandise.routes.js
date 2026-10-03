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
import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { HttpError } from '../utils/httpError.js';
import * as service from '../services/merchandise.service.js';
import * as paymentModel from '../model/payment.model.js';
import { transaction } from '../utils/transaction.js';

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

  // POST /orders/:id/razorpay/order: Create Razorpay order for instant UPI checkout
  router.post('/orders/:id/razorpay/order', auth, requireCsrf, async (req, res) => {
    const order = await service.getCustomerOrder(pool, req.params.id, req.user.id);
    if (!order) {
      throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    if (order.status !== 'pending') {
      throw new HttpError(400, 'ORDER_NOT_PENDING', `Cannot create payment for order in ${order.status} status.`);
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new HttpError(500, 'PAYMENT_CONFIG_MISSING', 'Razorpay credentials are not configured on server.');
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const receipt = `ord_${order.id.replace(/-/g, '').slice(0, 16)}`;
    const rzpOrder = await razorpay.orders.create({
      amount: order.totalMinor,
      currency: order.currency || 'INR',
      receipt,
      notes: {
        orderId: order.id,
        userId: req.user.id,
      },
    });

    res.json({
      data: {
        razorpayOrderId: rzpOrder.id,
        amountMinor: rzpOrder.amount,
        currency: rzpOrder.currency,
        keyId,
        orderId: order.id,
      },
    });
  });

  // POST /orders/:id/razorpay/verify: Verify Razorpay signature and directly confirm order as paid
  router.post('/orders/:id/razorpay/verify', auth, requireCsrf, async (req, res) => {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      throw new HttpError(400, 'INVALID_PAYMENT_DETAILS', 'Missing Razorpay payment verification fields.');
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      throw new HttpError(500, 'PAYMENT_CONFIG_MISSING', 'Razorpay secret is not configured.');
    }

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      throw new HttpError(400, 'INVALID_SIGNATURE', 'Razorpay payment verification signature failed.');
    }

    const updatedOrder = await transaction(pool, async client => {
      const lockedOrder = await paymentModel.lockOrderForPayment(client, req.params.id);
      if (!lockedOrder) {
        throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      }
      if (lockedOrder.userId !== req.user.id) {
        throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to pay for this order.');
      }
      if (lockedOrder.status === 'paid') {
        return await service.getCustomerOrder(client, lockedOrder.id, req.user.id);
      }
      if (lockedOrder.status !== 'pending') {
        throw new HttpError(409, 'ORDER_NOT_PENDING', `Cannot confirm payment for order in ${lockedOrder.status} status.`);
      }

      await paymentModel.insertPaymentRecord(client, {
        orderId: lockedOrder.id,
        amountMinor: lockedOrder.totalMinor,
        currency: lockedOrder.currency,
        method: 'razorpay_upi',
        externalReference: razorpay_payment_id,
        notes: `Instant Razorpay UPI Payment (ID: ${razorpay_payment_id})`,
        recordedBy: req.user.id,
        idempotencyKey: `rzp_${razorpay_payment_id}`,
      });

      const confirmed = await paymentModel.confirmOrderPayment(client, { orderId: lockedOrder.id });
      if (!confirmed) {
        throw new HttpError(409, 'ALREADY_PAID', 'Order payment was already confirmed.');
      }

      return await service.getCustomerOrder(client, lockedOrder.id, req.user.id);
    });

    res.json({
      data: updatedOrder,
      message: 'Payment verified successfully and order is confirmed as Paid.',
    });
  });

  return router;
}
