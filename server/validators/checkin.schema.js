/**
 * server/validators/checkin.schema.js — Dharmik owns this file.
 *
 * Request validation schemas for check-in and payment endpoints.
 * Uses Zod, consistent with existing auth.schema.js and event.schema.js.
 */

import { z } from 'zod';

// @edit:CHECKIN_UI — Check-in request body
export const checkinSchema = z.object({
  eventId: z.string().uuid('Invalid event ID.'),
  ticketToken: z.string().min(1, 'Admission code is required.').max(200, 'Admission code is too long.'),
}).strict();

// @edit:PAYMENT_UI — Manual payment confirmation request body
export const paymentSchema = z.object({
  registrationId: z.string().uuid('Invalid registration ID.'),
  amountMinor: z.number().int().min(0).max(100000000),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP']),
  method: z.string().trim().min(1).max(50),
  externalReference: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(500).default(''),
}).strict();

// Idempotency key for payment requests (same format as event bookings)
export const paymentIdempotencySchema = z.string().min(16).max(100).regex(/^[a-zA-Z0-9_-]+$/);
