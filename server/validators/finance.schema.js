import { z } from 'zod';

export const duesPaymentSchema = z.object({
  duesObligationId: z.string().uuid('Invalid dues obligation ID.'),
  amountMinor: z.number().int().nonnegative('Amount must be non-negative.'),
  currency: z.string().length(3, 'Currency must be a 3-letter ISO code.').toUpperCase(),
  method: z.enum(['cash', 'bank_transfer', 'upi', 'card', 'zero_price'], {
    errorMap: () => ({ message: 'Method must be one of: cash, bank_transfer, upi, card, zero_price.' }),
  }),
  externalReference: z.string().max(200, 'External reference must not exceed 200 characters.').optional().nullable(),
  notes: z.string().max(500, 'Notes must not exceed 500 characters.').optional(),
});

export const waiveDuesSchema = z.object({
  notes: z.string().max(500, 'Waiver notes must not exceed 500 characters.').optional().default(''),
});

export const pendingDuesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const createExpenseSchema = z.object({
  amountMinor: z.number().int().positive('Amount must be greater than zero.'),
  currency: z.string().length(3, 'Currency must be a 3-letter ISO code.').toUpperCase(),
  purpose: z.string().trim().min(3, 'Purpose must be at least 3 characters.').max(500, 'Purpose must not exceed 500 characters.'),
  receiptKey: z.string().trim().min(1, 'Receipt key is required.').max(500, 'Receipt key must not exceed 500 characters.'),
});

export const expenseDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected'], {
    errorMap: () => ({ message: 'Decision must be either "approved" or "rejected".' }),
  }),
  reason: z.string().max(500, 'Decision reason must not exceed 500 characters.').optional().default(''),
}).refine(data => {
  if (data.decision === 'rejected') {
    return data.reason && data.reason.trim().length > 0;
  }
  return true;
}, {
  message: 'A rejection reason is required when rejecting an expense.',
  path: ['reason'],
});

export const expenseReimbursementSchema = z.object({
  reimbursementReference: z.string().trim().max(200, 'Reimbursement reference must not exceed 200 characters.').optional().nullable(),
});

export const expenseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['submitted', 'approved', 'rejected', 'reimbursed']).optional(),
  requesterId: z.string().uuid().optional(),
});

export const financeSummaryQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional().or(z.literal('')),
  to: z.string().datetime({ offset: true }).optional().or(z.literal('')),
});
