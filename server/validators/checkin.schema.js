/**
 * server/validators/checkin.schema.js — Dharmik owns this file.
 *
 * Request validation schemas for check-in and payment endpoints.
 * Uses Joi for schema definition and request validation.
 */

import Joi, { wrap } from './joiHelper.js';

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// @edit:CHECKIN_UI — Check-in request body
export const checkinSchema = wrap(Joi.object({
  eventId: Joi.string().pattern(uuidRegex).required().messages({
    'string.pattern.base': 'Invalid event ID.',
    'any.required': 'Invalid event ID.',
  }),
  ticketToken: Joi.string().trim().min(1).max(200).required().messages({
    'string.empty': 'Admission code is required.',
    'string.min': 'Admission code is required.',
    'string.max': 'Admission code is too long.',
    'any.required': 'Admission code is required.',
  }),
}).unknown(false));

// @edit:PAYMENT_UI — Manual payment confirmation request body
export const paymentSchema = wrap(Joi.object({
  registrationId: Joi.string().pattern(uuidRegex).required().messages({
    'string.pattern.base': 'Invalid registration ID.',
    'any.required': 'Invalid registration ID.',
  }),
  amountMinor: Joi.number().integer().min(0).max(100000000).required(),
  currency: Joi.string().valid('INR', 'USD', 'EUR', 'GBP').required(),
  method: Joi.string().trim().min(1).max(50).required(),
  externalReference: Joi.string().trim().max(200).allow('', null).optional(),
  notes: Joi.string().trim().max(500).default('').allow(''),
}).unknown(false));

// Idempotency key for payment requests (same format as event bookings)
export const paymentIdempotencySchema = wrap(Joi.string().min(16).max(100).pattern(/^[a-zA-Z0-9_-]+$/).required());

// @edit:MERCHANDISE_PAYMENT_UI — Manual merchandise order payment confirmation request body
export const merchandisePaymentSchema = wrap(Joi.object({
  orderId: Joi.string().pattern(uuidRegex).required().messages({
    'string.pattern.base': 'Invalid order ID.',
    'any.required': 'Invalid order ID.',
  }),
  amountMinor: Joi.number().integer().min(0).max(100000000).required(),
  currency: Joi.string().valid('INR', 'USD', 'EUR', 'GBP').required(),
  method: Joi.string().trim().min(1).max(50).required(),
  externalReference: Joi.string().trim().max(200).allow('', null).optional(),
  notes: Joi.string().trim().max(500).default('').allow(''),
}).unknown(false));

export const pendingOrderQuerySchema = wrap(Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(50).default(20),
}).unknown(false));
