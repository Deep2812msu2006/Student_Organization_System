import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { randomUUID } from 'node:crypto';
import * as expenseModel from '../model/expense.model.js';
import { transaction } from '../utils/transaction.js';
import { HttpError } from '../utils/httpError.js';
import { scopedKey } from '../utils/ticketToken.js';

// Private storage directory outside public assets
const STORAGE_DIR = fileURLToPath(new URL('../storage/receipts/', import.meta.url));

// Ensure directory exists
try {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
} catch {
  // Directory already exists or created on boot
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const EXT_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Validate and save a private receipt file to server storage.
 *
 * @param {{
 *   buffer: Buffer,
 *   mimeType: string,
 *   originalFilename?: string
 * }} param0
 * @returns {Promise<{ receiptKey: string, size: number, mimeType: string, originalFilename: string }>}
 */
export async function storeReceiptFile({ buffer, mimeType, originalFilename = 'receipt' }) {
  if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
    throw new HttpError(400, 'EMPTY_FILE', 'The uploaded receipt file is empty.');
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new HttpError(413, 'FILE_TOO_LARGE', `Receipt exceeds maximum allowed size of 5MB (got ${buffer.length} bytes).`);
  }

  const normalizedMime = (mimeType || '').toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    throw new HttpError(400, 'INVALID_FILE_TYPE', `File type "${normalizedMime}" is not supported. Allowed types: JPEG, PNG, WebP, PDF.`);
  }

  const signatures={
 'image/jpeg':buffer[0]===255&&buffer[1]===216&&buffer[2]===255,
 'image/png':buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
 'image/webp':buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP',
 'application/pdf':buffer.toString('ascii',0,5)==='%PDF-'
 };
 if(!signatures[normalizedMime])throw new HttpError(400,'INVALID_FILE_TYPE','File contents do not match the selected receipt type.');
 const ext = MIME_TO_EXT[normalizedMime] || 'bin';
  const sanitizedOriginal = path.basename(originalFilename).replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 100);
  const receiptKey = `receipt_${Date.now()}_${randomUUID().replace(/-/g, '')}.${ext}`;
  const targetPath = path.join(STORAGE_DIR, receiptKey);

  // Security check: ensure target path is inside STORAGE_DIR
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(STORAGE_DIR)) {
    throw new HttpError(400, 'INVALID_PATH', 'Path traversal attempt detected.');
  }

  await fs.promises.writeFile(resolved, buffer);

  return {
    receiptKey,
    size: buffer.length,
    mimeType: normalizedMime,
    originalFilename: sanitizedOriginal,
  };
}

/**
 * Retrieve a private receipt file from storage.
 *
 * @param {string} receiptKey
 * @returns {Promise<{ filePath: string, mimeType: string }>}
 */
export async function getReceiptFile(receiptKey) {
  if (!receiptKey || typeof receiptKey !== 'string') {
    throw new HttpError(400, 'INVALID_RECEIPT_KEY', 'Invalid receipt key.');
  }

  // Prevent path traversal
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(receiptKey)) {
    throw new HttpError(400, 'INVALID_RECEIPT_KEY', 'Receipt key contains illegal characters.');
  }

  const resolved = path.resolve(STORAGE_DIR, receiptKey);
  if (!resolved.startsWith(STORAGE_DIR)) {
    throw new HttpError(400, 'INVALID_PATH', 'Path traversal attempt detected.');
  }

  try {
    await fs.promises.access(resolved, fs.constants.R_OK);
  } catch {
    throw new HttpError(404, 'RECEIPT_NOT_FOUND', 'Receipt file not found on server.');
  }

  const ext = path.extname(receiptKey).toLowerCase().replace('.', '');
  const mimeType = EXT_TO_MIME[ext] || 'application/octet-stream';

  return { filePath: resolved, mimeType };
}

/**
 * Submit a new volunteer expense claim.
 */
export async function submitExpense(pool, { requesterId, amountMinor, currency, purpose, receiptKey }) {
  // @rule:RECEIPT_OWNER — only the uploader can attach this private file.
  const upload=await pool.query('SELECT 1 FROM receipt_uploads WHERE receipt_key=$1 AND owner_id=$2',[receiptKey,requesterId]);
  if(!upload.rowCount)throw new HttpError(403,'FORBIDDEN','Upload your own receipt before submitting.');
  // Validate that receipt file exists
  await getReceiptFile(receiptKey);

  const expense = await expenseModel.createExpense(pool, {
    requesterId,
    amountMinor,
    currency,
    purpose,
    receiptKey,
  });

  return expense;
}

/**
 * Fetch an expense by ID enforcing ownership/role security.
 */
export async function getExpense(pool, expenseId, user) {
  const expense = await expenseModel.getExpenseById(pool, expenseId);
  if (!expense) {
    throw new HttpError(404, 'EXPENSE_NOT_FOUND', 'Expense not found.');
  }

  const isStaff = user.roles && (user.roles.includes('treasurer') || user.roles.includes('organizer'));
  const isOwner = expense.requesterId === user.id;

  if (!isStaff && !isOwner) {
    throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to view this expense.');
  }

  return expense;
}

/**
 * List expenses with strict role scoping:
 * Regular members can only view their own expense claims.
 * Treasurers and organizers can view all or filter by requester/status.
 */
export async function listExpenses(pool, user, { page = 1, pageSize = 20, status = null, requesterId = null } = {}) {
  const isStaff = user.roles && (user.roles.includes('treasurer') || user.roles.includes('organizer'));
  
  // Non-staff members are strictly scoped to their own claims
  const effectiveRequesterId = isStaff ? (requesterId || null) : user.id;

  return expenseModel.listExpenses(pool, {
    page,
    pageSize,
    status: status || null,
    requesterId: effectiveRequesterId,
  });
}

/**
 * Review an expense claim (approve or reject).
 *
 * @rule:EXPENSE_TRANSITIONS — Submitted -> approved | rejected.
 * @rule:EXPENSE_NO_SELF_APPROVAL — Submitter cannot approve or reject their own claim.
 */
export async function decideExpense(pool, expenseId, { decision, reason = '' }, actor) {
  return transaction(pool, async (client) => {
    const locked = await expenseModel.lockExpenseForDecision(client, expenseId);
    if (!locked) {
      throw new HttpError(404, 'EXPENSE_NOT_FOUND', 'Expense not found.');
    }

    // Segregation of duties guard: no self-approval
    if (locked.requesterId === actor.id) {
      throw new HttpError(403, 'CANNOT_APPROVE_OWN_EXPENSE', 'Users cannot review or decide their own expense claims.');
    }

    if (locked.status !== 'submitted') {
      throw new HttpError(409, 'INVALID_EXPENSE_STATUS', `Expense is already in "${locked.status}" status and cannot be decided.`);
    }

    const updated = await expenseModel.decideExpense(client, {
      expenseId,
      actorId: actor.id,
      decision,
      reason,
      at: new Date().toISOString(),
    });

    if (!updated) {
      throw new HttpError(409, 'INVALID_EXPENSE_STATUS', 'Expense could not be decided in its current state.');
    }

    return updated;
  });
}

/**
 * Record reimbursement for an approved expense claim.
 *
 * @rule:EXPENSE_TRANSITIONS — Approved -> reimbursed.
 * @rule:REIMBURSEMENT_ONCE — Idempotency key prevents duplicate reimbursements.
 * @rule:EXPENSE_NO_SELF_APPROVAL — Submitter cannot reimburse their own claim.
 */
export async function reimburseExpense(pool, expenseId, { reimbursementReference = null, idempotencyKey }, actor) {
  const scopedIdempKey = scopedKey(actor.id, idempotencyKey);

  // 1. Pre-check idempotency key
  const existing = await expenseModel.findExpenseByReimbursementIdempotencyKey(pool, scopedIdempKey);
  if (existing) {
    if (existing.id !== expenseId) {
      throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different expense reimbursement.');
    }
    return { expense: existing, replayed: true };
  }

  // 2. Transaction
  try {
    const result = await transaction(pool, async (client) => {
      // 2a. Advisory lock on scoped idempotency key
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [scopedIdempKey]);

      // 2b. Recheck in-tx replay
      const existingInTx = await expenseModel.findExpenseByReimbursementIdempotencyKey(client, scopedIdempKey);
      if (existingInTx) {
        if (existingInTx.id !== expenseId) {
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different expense reimbursement.');
        }
        return { expense: existingInTx, replayed: true };
      }

      // 2c. Lock approved expense row
      const locked = await expenseModel.lockExpenseForReimbursement(client, expenseId);
      if (!locked) {
        throw new HttpError(404, 'EXPENSE_NOT_FOUND', 'Expense not found.');
      }

      // Segregation of duties guard: no self-reimbursement
      if (locked.requesterId === actor.id) {
        throw new HttpError(403, 'CANNOT_REIMBURSE_OWN_EXPENSE', 'Users cannot record reimbursement for their own expense claims.');
      }

      if (locked.status === 'reimbursed') {
        if (locked.reimbursementIdempotencyKey === scopedIdempKey) {
          return { expense: locked, replayed: true };
        }
        throw new HttpError(409, 'ALREADY_REIMBURSED', 'This expense has already been reimbursed.');
      }

      if (locked.status !== 'approved') {
        throw new HttpError(409, 'EXPENSE_NOT_APPROVED', `Expense must be in "approved" status before reimbursement (current status: "${locked.status}").`);
      }

      // 2d. Transition approved -> reimbursed
      const reimbursed = await expenseModel.reimburseExpense(client, {
        expenseId,
        actorId: actor.id,
        reimbursementReference,
        idempotencyKey: scopedIdempKey,
        at: new Date().toISOString(),
      });

      if (!reimbursed) {
        throw new HttpError(409, 'ALREADY_REIMBURSED', 'Expense was already reimbursed by another process.');
      }

      return { expense: reimbursed, replayed: false };
    });

    return result;
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'expenses_reimbursement_idempotency_key_key') {
      const existing = await expenseModel.findExpenseByReimbursementIdempotencyKey(pool, scopedIdempKey);
      if (existing) {
        if (existing.id !== expenseId) {
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different expense reimbursement.');
        }
        return { expense: existing, replayed: true };
      }
    }
    throw error;
  }
}
