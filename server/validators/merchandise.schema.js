import { z } from 'zod';

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const idSchema = z.string().regex(uuidRegex, 'Invalid UUID format');

export const idempotencySchema = z.string().min(16).max(100).regex(/^[a-zA-Z0-9_-]+$/);

export const productQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  category: z.string().trim().max(50).optional(),
}).strict();

export const orderItemSchema = z.object({
  variantId: z.string().regex(uuidRegex, 'Invalid variant ID'),
  quantity: z.number().int().min(1).max(50),
}).strict();

// Reject any client-supplied prices, totals, currencies, or statuses
export const orderCreateSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(20),
}).strict();

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(200).optional(),
}).strict();

export const orderPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
