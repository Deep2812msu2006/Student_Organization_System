import { z } from 'zod';
export const idSchema=z.string().uuid();
export const eventSchema=z.object({
  title:z.string().trim().min(1).max(200),description:z.string().trim().max(5000).default(''),
  venue:z.string().trim().min(1).max(200),startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),
  capacity:z.number().int().min(1).max(100000),memberPriceMinor:z.number().int().min(0).max(100000000),
  publicPriceMinor:z.number().int().min(0).max(100000000),currency:z.enum(['INR','USD','EUR','GBP']),
  status:z.enum(['draft','published','cancelled']).default('draft'),
}).strict();
// PATCH must not apply create-time defaults to omitted fields (especially publication status).
export const eventPatchSchema=eventSchema.omit({description:true,status:true}).partial().extend({
  description:z.string().trim().max(5000).optional(),status:z.enum(['draft','published','cancelled']).optional(),
}).strict().refine(value=>Object.keys(value).length>0,'Provide at least one field.');
export const bookingSchema=z.object({}).strict();
export const idempotencySchema=z.string().min(16).max(100).regex(/^[a-zA-Z0-9_-]+$/);
