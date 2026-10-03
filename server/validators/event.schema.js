import Joi, { wrap } from './joiHelper.js';

export const idSchema = wrap(Joi.string().guid().required());

export const eventSchema = wrap(Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().trim().max(5000).default('').allow(''),
  venue: Joi.string().trim().min(1).max(200).required(),
  startsAt: Joi.string().isoDate().required(),
  endsAt: Joi.string().isoDate().required(),
  capacity: Joi.number().integer().min(1).max(100000).required(),
  memberPriceMinor: Joi.number().integer().min(0).max(100000000).required(),
  publicPriceMinor: Joi.number().integer().min(0).max(100000000).required(),
  currency: Joi.string().valid('INR', 'USD', 'EUR', 'GBP').required(),
  status: Joi.string().valid('draft', 'published', 'cancelled').default('draft'),
}).unknown(false));

// PATCH must not apply create-time defaults to omitted fields (especially publication status).
export const eventPatchSchema = wrap(Joi.object({
  title: Joi.string().trim().min(1).max(200),
  description: Joi.string().trim().max(5000).allow(''),
  venue: Joi.string().trim().min(1).max(200),
  startsAt: Joi.string().isoDate(),
  endsAt: Joi.string().isoDate(),
  capacity: Joi.number().integer().min(1).max(100000),
  memberPriceMinor: Joi.number().integer().min(0).max(100000000),
  publicPriceMinor: Joi.number().integer().min(0).max(100000000),
  currency: Joi.string().valid('INR', 'USD', 'EUR', 'GBP'),
  status: Joi.string().valid('draft', 'published', 'cancelled'),
}).min(1).unknown(false).messages({
  'object.min': 'Provide at least one field.',
}));

export const bookingSchema = wrap(Joi.object({}).unknown(false));

export const idempotencySchema = wrap(Joi.string().min(16).max(100).pattern(/^[a-zA-Z0-9_-]+$/).required());
