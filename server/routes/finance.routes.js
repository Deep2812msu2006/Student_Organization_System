import { Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import { requireUser, requireRole, requireCsrf } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { paymentIdempotencySchema } from '../validators/checkin.schema.js';
import {
  duesPaymentSchema,
  waiveDuesSchema,
  pendingDuesQuerySchema,
  createExpenseSchema,
  expenseDecisionSchema,
  expenseReimbursementSchema,
  expenseListQuerySchema,
  financeSummaryQuerySchema,
} from '../validators/finance.schema.js';
import { HttpError } from '../utils/httpError.js';
import * as paymentService from '../services/payment.service.js';
import * as expenseService from '../services/expense.service.js';
import * as financeService from '../services/finance.service.js';

export function financeRouter(pool, _config) {
  const router = Router();
  const auth = requireUser(pool);
  const paymentStaff = requireRole('organizer', 'treasurer');

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // ─── Membership Dues Endpoints ──────────────────────────────────────────────

  const handlePendingDues = async (req, res) => {
    const result = await paymentService.listPendingDues(pool, req.validated);
    res.json({
      data: result.rows,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      },
    });
  };

  router.get('/dues/pending', auth, paymentStaff, validate(pendingDuesQuerySchema, 'query'), handlePendingDues);
  router.get('/staff/dues/pending', auth, paymentStaff, validate(pendingDuesQuerySchema, 'query'), handlePendingDues);

  // POST /api/v1/payments/dues/manual
  // @flow:DUES_PAYMENT — Treasurer/organizer records manual dues payment received
  router.post('/payments/dues/manual', auth, paymentStaff, requireCsrf, validate(duesPaymentSchema), async (req, res) => {
    const keyResult = paymentIdempotencySchema.safeParse(req.get('Idempotency-Key'));
    if (!keyResult.success) {
      throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY',
        'Supply a 16–100 character Idempotency-Key header (letters, digits, underscore or hyphen).');
    }

    const result = await paymentService.confirmDuesPayment(
      pool,
      { ...req.validated, idempotencyKey: keyResult.data },
      req.user.id
    );

    res.status(result.replayed ? 200 : 201).json({
      data: {
        payment: result.payment,
        duesObligation: result.duesObligation,
        memberProfile: result.memberProfile,
      },
      replayed: result.replayed,
    });
  });

  // POST /api/v1/dues/:id/waive
  router.post('/dues/:id/waive', auth, paymentStaff, requireCsrf, validate(waiveDuesSchema), async (req, res) => {
    const duesObligationId = req.params.id;
    const result = await paymentService.waiveDues(pool, duesObligationId, req.validated?.notes, req.user.id);
    res.json({ data: result });
  });

  // ─── Volunteer Expense Endpoints ────────────────────────────────────────────

  // POST /api/v1/expenses/receipts
  // Private receipt upload accepting JSON base64 or raw binary
  router.post(
    '/expenses/receipts',
    auth,
    requireCsrf,
    express.raw({ limit: '5mb', type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }),
    async (req, res) => {
      let buffer;
      let mimeType;
      let originalFilename = 'receipt';

      if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
        buffer = req.body;
        mimeType = req.get('content-type') || 'application/octet-stream';
        originalFilename = req.get('x-filename') || (req.query.filename ? String(req.query.filename) : 'receipt');
      } else if (req.body && typeof req.body === 'object' && req.body.dataBase64) {
        buffer = Buffer.from(req.body.dataBase64, 'base64');
        mimeType = req.body.contentType || 'application/octet-stream';
        originalFilename = req.body.filename || 'receipt';
      } else {
        throw new HttpError(400, 'INVALID_PAYLOAD',
          'Provide a receipt file as binary body or JSON with dataBase64, contentType, and filename.');
      }

      const receipt = await expenseService.storeReceiptFile({
        buffer,
        mimeType,
        originalFilename,
      });

      res.status(201).json({ data: receipt });
    }
  );

  // POST /api/v1/expenses
  router.post('/expenses', auth, requireCsrf, validate(createExpenseSchema), async (req, res) => {
    const expense = await expenseService.submitExpense(pool, {
      requesterId: req.user.id,
      ...req.validated,
    });
    res.status(201).json({ data: expense });
  });

  // GET /api/v1/expenses
  router.get('/expenses', auth, validate(expenseListQuerySchema, 'query'), async (req, res) => {
    const result = await expenseService.listExpenses(pool, req.user, req.validated);
    res.json({
      data: result.rows,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      },
    });
  });

  // GET /api/v1/expenses/:id
  router.get('/expenses/:id', auth, async (req, res) => {
    const expense = await expenseService.getExpense(pool, req.params.id, req.user);
    res.json({ data: expense });
  });

  // GET /api/v1/expenses/:id/receipt
  router.get('/expenses/:id/receipt', auth, async (req, res) => {
    const expense = await expenseService.getExpense(pool, req.params.id, req.user);
    const { filePath, mimeType } = await expenseService.getReceiptFile(expense.receiptKey);

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-cache',
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'READ_ERROR', message: 'Failed to read receipt file.' } });
      }
    });
    stream.pipe(res);
  });

  // PATCH & POST /api/v1/expenses/:id/decision
  const handleDecision = async (req, res) => {
    const updated = await expenseService.decideExpense(
      pool,
      req.params.id,
      req.validated,
      req.user
    );
    res.json({ data: updated });
  };

  router.patch('/expenses/:id/decision', auth, paymentStaff, requireCsrf, validate(expenseDecisionSchema), handleDecision);
  router.post('/expenses/:id/decision', auth, paymentStaff, requireCsrf, validate(expenseDecisionSchema), handleDecision);

  // POST /api/v1/expenses/:id/reimburse
  router.post('/expenses/:id/reimburse', auth, paymentStaff, requireCsrf, validate(expenseReimbursementSchema), async (req, res) => {
    const keyResult = paymentIdempotencySchema.safeParse(req.get('Idempotency-Key'));
    if (!keyResult.success) {
      throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY',
        'Supply a 16–100 character Idempotency-Key header (letters, digits, underscore or hyphen).');
    }

    const result = await expenseService.reimburseExpense(
      pool,
      req.params.id,
      {
        reimbursementReference: req.validated?.reimbursementReference,
        idempotencyKey: keyResult.data,
      },
      req.user
    );

    res.status(result.replayed ? 200 : 200).json({
      data: result.expense,
      replayed: result.replayed,
    });
  });

  // ─── Financial Summary Reporting ────────────────────────────────────────────

  // GET /api/v1/finance/summary
  router.get('/finance/summary', auth, paymentStaff, validate(financeSummaryQuerySchema, 'query'), async (req, res) => {
    const summary = await financeService.getFinancialSummary(pool, {
      from: req.validated?.from || null,
      to: req.validated?.to || null,
    });
    res.json({ data: summary });
  });

  return router;
}
