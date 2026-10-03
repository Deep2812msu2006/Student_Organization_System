/**
 * server/routes/checkin.routes.js — Dharmik owns this file.
 *
 * Routes for ticket check-in and manual payment confirmation.
 * Both require authentication and 'organizer' role (staff permissions).
 *
 * @edit:CHECKIN_UI — POST /checkins endpoint
 * @edit:PAYMENT_UI — POST /payments/manual endpoint
 *
 * Staff permissions: Only organizer-role users can perform check-in or
 * record manual payments. Volunteers and regular members are denied.
 * This is enforced server-side by requireRole('organizer').
 */

import { Router } from 'express';
import { requireUser, requireRole, requireCsrf } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { checkinSchema, paymentSchema, paymentIdempotencySchema } from '../validators/checkin.schema.js';
import { idSchema } from '../validators/event.schema.js';
import { HttpError } from '../utils/httpError.js';
import * as checkinService from '../services/checkin.service.js';
import * as paymentService from '../services/payment.service.js';
import * as checkinModel from '../services/checkin.service.js';

export function checkinRouter(pool, config) {
  const router = Router();
  const auth = requireUser(pool);
  const staff = requireRole('organizer');

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // ─── Check-in ───────────────────────────────────────────────────────────────
  // POST /api/v1/checkins
  // @flow:CHECKIN — Staff submits eventId + admission code
  router.post('/checkins', requireCsrf, auth, staff, validate(checkinSchema), async (req, res) => {
    const { eventId, ticketToken } = req.validated;
    const result = await checkinService.checkIn(pool, eventId, ticketToken, req.user.id);
    res.status(200).json({ data: result });
  });

  // GET /api/v1/events/:eventId/attendance
  // Database-backed attendance totals for staff dashboard
  router.get('/events/:eventId/attendance', auth, staff, async (req, res) => {
    const eventId = req.params.eventId;
    if (!idSchema.safeParse(eventId).success) {
      throw new HttpError(400, 'INVALID_ID', 'Invalid event ID.');
    }
    const attendance = await checkinService.getEventAttendance(pool, eventId);
    res.json({ data: attendance });
  });

  // ─── Manual payment confirmation ───────────────────────────────────────────
  // POST /api/v1/payments/manual
  // @flow:PAYMENT_CONFIRMATION — Treasurer records out-of-band payment
  router.post('/payments/manual', requireCsrf, auth, staff, validate(paymentSchema), async (req, res) => {
    const keyResult = paymentIdempotencySchema.safeParse(req.get('Idempotency-Key'));
    if (!keyResult.success) {
      throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY',
        'Supply a 16–100 character Idempotency-Key header (letters, digits, underscore or hyphen).');
    }
    const result = await paymentService.confirmPayment(
      pool,
      { ...req.validated, idempotencyKey: keyResult.data },
      req.user.id
    );
    res.status(result.replayed ? 200 : 201).json({
      data: { payment: result.payment, registration: result.registration },
      replayed: result.replayed,
    });
  });

  // GET /api/v1/events/:eventId/pending-registrations
  // List pending registrations for treasurer confirmation screen
  router.get('/events/:eventId/pending-registrations', auth, staff, async (req, res) => {
    const eventId = req.params.eventId;
    if (!idSchema.safeParse(eventId).success) {
      throw new HttpError(400, 'INVALID_ID', 'Invalid event ID.');
    }
    const registrations = await paymentService.listPendingForEvent(pool, eventId);
    res.json({ data: registrations });
  });

  return router;
}
