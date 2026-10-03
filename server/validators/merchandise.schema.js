import Joi, { wrap } from './joiHelper.js';

export const idSchema = wrap(Joi.string().guid().required());

export const idempotencySchema = wrap(Joi.string().min(16).max(100).pattern(/^[a-zA-Z0-9_-]+$/).required());

export const productQuerySchema = wrap(Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(50).default(20),
  category: Joi.string().trim().max(50).optional(),
}).unknown(false));

export const orderItemSchema = wrap(Joi.object({
  variantId: Joi.string().guid().required(),
  quantity: Joi.number().integer().min(1).max(50).required(),
}).unknown(false));

// Reject any client-supplied prices, totals, currencies, or statuses
export const orderCreateSchema = wrap(Joi.object({
  items: Joi.array().items(orderItemSchema).min(1).max(20).required(),
}).unknown(false));

export const cancelOrderSchema = wrap(Joi.object({
  reason: Joi.string().trim().max(200).optional().allow(''),
}).unknown(false));

export const orderPaginationSchema = wrap(Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(50).default(20),
}).unknown(false));
