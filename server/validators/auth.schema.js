import { z } from 'zod';
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10, 'Use at least 10 characters.').refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Use no more than 72 UTF-8 bytes.');
export const registrationSchema = z.object({ name: z.string().trim().min(1).max(100), email, password }).strict();
export const loginSchema = z.object({ email, password: z.string().min(1).refine(value => Buffer.byteLength(value,'utf8') <= 72) }).strict();
export const membershipSchema = z.object({ planId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Choose a valid plan.') }).strict();
export const paginationSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict();
