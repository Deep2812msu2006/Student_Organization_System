/**
 * server/services/payment.service.js — Dharmik owns this file.
 *
 * Manual payment confirmation workflow for authorized treasurer/organizer.
 *
 * @flow:PAYMENT_CONFIRMATION — Treasurer submits manual payment evidence →
 *   1. Validate the registration exists and is in 'pending' status.
 *   2. Reject cancelled registrations — never silently restore them.
 *   3. Check idempotency: if this key was already used, replay the result.
 *   4. For zero-price events: use 'zero_price' method, no payment amount invented.
 *   5. Validate amount/currency match the registration snapshot.
 *   6. Within ONE transaction:
 *      a. Lock the event row (prevent concurrent capacity changes).
 *      b. Insert durable payment_records evidence.
 *      c. Conditionally update registration pending → confirmed.
 *   7. If registration was already confirmed (race), roll back payment record
 *      and return the existing state idempotently.
 *
 * @rule:PAYMENT_ONCE — Idempotency key prevents duplicate payment records.
 *   confirmRegistration only transitions pending → confirmed.
 *   Already-confirmed returns replay. Cancelled is rejected.
 *
 * @rule:PAYMENT_EVIDENCE — Every confirmation writes a durable audit record.
 *   The payment record and status change share a transaction.
 *   Rollback on any failure preserves consistency.
 *
 * This service does NOT:
 *  - Simulate a payment gateway or collect card details.
 *  - Treat every confirmed ticket as evidence of money received.
 *  - Accept client-supplied 'paid' flags or registration status overrides.
 */

import * as eventModel from '../model/event.model.js';
import * as paymentModel from '../model/payment.model.js';
import * as merchModel from '../model/merchandise.model.js';
import * as memberModel from '../model/member.model.js';
import { transaction } from '../utils/transaction.js';
import { HttpError } from '../utils/httpError.js';
import { scopedKey } from '../utils/ticketToken.js';

/**
 * Record manual payment and confirm a pending registration.
 * This is labeled as "manual payment recording" — not an online payment flow.
 *
 * @param {import('pg').Pool} pool
 * @param {{
 *   registrationId: string,
 *   amountMinor: number,
 *   currency: string,
 *   method: string,
 *   externalReference?: string,
 *   notes?: string,
 *   idempotencyKey: string
 * }} params
 * @param {string} treasurerId - UUID of the authorized treasurer/organizer
 * @returns {Promise<{payment: object, registration: object, replayed: boolean}>}
 */
export async function confirmPayment(pool, params, treasurerId) {
  const {
    registrationId,
    amountMinor,
    currency,
    method,
    externalReference = null,
    notes = '',
    idempotencyKey,
  } = params;

  // @flow:PAYMENT_CONFIRMATION step 1 — validate registration
  const registration = await eventModel.findRegistrationById(pool, registrationId);
  if (!registration) {
    throw new HttpError(404, 'REGISTRATION_NOT_FOUND', 'Registration not found.');
  }

  // @flow:PAYMENT_CONFIRMATION step 2 — reject cancelled registrations
  // @rule:PAYMENT_ONCE — never silently restore a cancelled registration
  if (registration.status === 'cancelled') {
    throw new HttpError(409, 'REGISTRATION_CANCELLED',
      'This registration has been cancelled and cannot be confirmed. A new registration is required.');
  }

  // Already confirmed? Check if this is a replay by idempotency key.
  if (registration.status === 'confirmed') {
    const existing = await paymentModel.findPaymentByIdempotencyKey(pool, idempotencyKey);
    if (existing && existing.registrationId === registrationId) {
      // Idempotent replay — return the existing result
      return { payment: existing, registration, replayed: true };
    }
    throw new HttpError(409, 'ALREADY_CONFIRMED',
      'This registration is already confirmed. No duplicate payment is needed.');
  }

  // @flow:PAYMENT_CONFIRMATION step 4 — zero-price path
  const isZeroPrice = registration.priceMinor === 0;
  if (isZeroPrice) {
    // Zero-price confirmation: don't require amount, just confirm with zero_price method
    if (amountMinor !== 0) {
      throw new HttpError(400, 'AMOUNT_MISMATCH',
        'This is a zero-price registration. The confirmation amount must be 0.');
    }
  } else {
    // @flow:PAYMENT_CONFIRMATION step 5 — validate amount/currency match
    if (amountMinor !== registration.priceMinor) {
      throw new HttpError(400, 'AMOUNT_MISMATCH',
        `The payment amount does not match the registration price. Expected ${registration.priceMinor} ${registration.currency} minor units.`);
    }
  }

  if (currency !== registration.currency) {
    throw new HttpError(400, 'CURRENCY_MISMATCH',
      `Currency mismatch. Registration uses ${registration.currency}.`);
  }

  // @flow:PAYMENT_CONFIRMATION step 3 — idempotency check before transaction
  const existingPayment = await paymentModel.findPaymentByIdempotencyKey(pool, idempotencyKey);
  if (existingPayment) {
    if (existingPayment.registrationId !== registrationId) {
      throw new HttpError(409, 'IDEMPOTENCY_CONFLICT',
        'This idempotency key was already used for a different registration.');
    }
    // Replay: payment was already recorded for this registration with this key
    const currentReg = await eventModel.findRegistrationById(pool, registrationId);
    return { payment: existingPayment, registration: currentReg, replayed: true };
  }

  // @flow:PAYMENT_CONFIRMATION step 6 — atomic transaction
  // @rule:PAYMENT_EVIDENCE — payment record and status change in one transaction
  const result = await transaction(pool, async (client) => {
    // 6a. Lock the event row to prevent concurrent capacity changes
    const event = await eventModel.lockEventForBooking(client, registration.eventId);
    if (!event) {
      throw new HttpError(404, 'EVENT_NOT_FOUND', 'Event not found.');
    }

    // 6b. Insert durable payment evidence
    const payment = await paymentModel.insertPaymentRecord(client, {
      registrationId,
      amountMinor: isZeroPrice ? 0 : amountMinor,
      currency,
      method: isZeroPrice ? 'zero_price' : method,
      externalReference,
      notes,
      recordedBy: treasurerId,
      idempotencyKey,
    });

    // 6c. Conditionally confirm registration (pending → confirmed)
    const confirmed = await paymentModel.confirmRegistration(client, registrationId);
    if (!confirmed) {
      // @flow:PAYMENT_CONFIRMATION step 7 — race condition: someone else confirmed it
      throw new HttpError(409, 'ALREADY_CONFIRMED',
        'This registration was confirmed by another process. No duplicate payment recorded.');
    }

    return { payment, registration: confirmed };
  });

  return { ...result, replayed: false };
}

/**
 * List pending registrations for an event (treasurer view).
 *
 * @param {import('pg').Pool} pool
 * @param {string} eventId
 * @returns {Promise<Array<object>>}
 */
export async function listPendingForEvent(pool, eventId) {
  const event = await eventModel.getEventById(pool, eventId);
  if (!event) {
    throw new HttpError(404, 'EVENT_NOT_FOUND', 'Event not found.');
  }
  return paymentModel.listPendingRegistrations(pool, eventId);
}

// ─── Merchandise Payment Confirmation ───────────────────────────────────────

function safePayment(record) {
  if (!record) return null;
  const { idempotencyKey: _discarded, ...safe } = record;
  return safe;
}

function safeOrder(order) {
  if (!order) return null;
  const { idempotencyKey: _discarded, idempotencyPayloadHash: _hash, ...safe } = order;
  return safe;
}

function matchesOrderPaymentPayload(existing, expected) {
  const normRef = expected.externalReference || null;
  const existRef = existing.externalReference || null;
  const normNotes = expected.notes || '';
  const existNotes = existing.notes || '';
  return (
    existing.orderId === expected.orderId &&
    existing.amountMinor === expected.amountMinor &&
    existing.currency === expected.currency &&
    existing.method === expected.method &&
    existRef === normRef &&
    existNotes === normNotes
  );
}

/**
 * Record manual payment received for a merchandise order and confirm order status.
 *
 * @flow:PAYMENT_CONFIRMATION — Staff treasurer submits payment evidence:
 *  1. Scopes idempotency key consistently to the authenticated recorder.
 *  2. Pre-checks order existence and status (rejects cancelled and fulfilled orders).
 *  3. In-transaction:
 *     a. Serializes on scoped key via advisory lock to handle simultaneous requests.
 *     b. Rechecks existing payment evidence for replay.
 *     c. Locks the order row with FOR UPDATE (@rule:ORDER_LOCK_ORDER).
 *     d. Validates amount and currency against the database-stored order (handles zero-price honestly).
 *     e. Inserts durable payment_records row (@rule:PAYMENT_EVIDENCE).
 *     f. Transitions order status pending -> paid atomically (@rule:PAYMENT_ONCE).
 *     g. Does NOT deduct stock again (stock was already deducted at order placement).
 *  4. Returns safe payment and order objects (internal idempotency keys stripped).
 *
 * @param {import('pg').Pool} pool
 * @param {{
 *   orderId: string,
 *   amountMinor: number,
 *   currency: string,
 *   method: string,
 *   externalReference?: string|null,
 *   notes?: string,
 *   idempotencyKey: string
 * }} params
 * @param {string} staffId - UUID of authorized staff member
 * @returns {Promise<{ payment: object, order: object, replayed: boolean }>}
 */
export async function confirmMerchandisePayment(pool, params, staffId) {
  const {
    orderId,
    amountMinor,
    currency,
    method,
    externalReference = null,
    notes = '',
    idempotencyKey,
  } = params;

  // Scope idempotency key consistently to the authenticated recorder
  const scopedIdempKey = scopedKey(staffId, idempotencyKey);

  // 1. Initial quick existence and status check
  const order = await merchModel.findOrderById(pool, orderId);
  if (!order) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  }
  if (order.status === 'cancelled') {
    throw new HttpError(409, 'ORDER_CANCELLED', 'This order was cancelled and cannot receive payment.');
  }
  if (order.status === 'fulfilled') {
    throw new HttpError(409, 'ORDER_FULFILLED', 'This order has already been fulfilled.');
  }

  const isZeroPrice = order.totalMinor === 0;
  const effectiveMethod = isZeroPrice ? 'zero_price' : method;

  // 2. Pre-transaction idempotency replay check
  const existingPayment = await paymentModel.findPaymentByIdempotencyKey(pool, scopedIdempKey);
  if (existingPayment) {
    if (existingPayment.orderId !== orderId) {
      throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different order.');
    }
    if (!matchesOrderPaymentPayload(existingPayment, { orderId, amountMinor, currency, method: effectiveMethod, externalReference, notes })) {
      throw new HttpError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'An identical idempotency key was reused with different payment parameters.');
    }
    const currentOrder = await merchModel.getOrderDetails(pool, orderId);
    return {
      payment: safePayment(existingPayment),
      order: safeOrder(currentOrder),
      replayed: true,
    };
  }

  // 3. Amount and currency validation against database-stored order
  if (isZeroPrice) {
    if (amountMinor !== 0) {
      throw new HttpError(400, 'AMOUNT_MISMATCH', 'This is a zero-total order. The confirmation amount must be 0.');
    }
  } else {
    if (amountMinor !== order.totalMinor) {
      throw new HttpError(400, 'AMOUNT_MISMATCH', `Payment amount (${amountMinor}) does not match order total (${order.totalMinor}).`);
    }
  }

  if (currency !== order.currency) {
    throw new HttpError(400, 'CURRENCY_MISMATCH', `Currency (${currency}) does not match order currency (${order.currency}).`);
  }

  // 4. Atomic transaction
  try {
    const result = await transaction(pool, async (client) => {
      // 4a. Advisory transaction lock on scoped idempotency key to serialize concurrent requests with the same key
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [scopedIdempKey]);

      // 4b. Recheck idempotency evidence inside the transaction (handles simultaneous identical requests without error)
      const existingInTx = await paymentModel.findPaymentByIdempotencyKey(client, scopedIdempKey);
      if (existingInTx) {
        if (existingInTx.orderId !== orderId) {
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different order.');
        }
        if (!matchesOrderPaymentPayload(existingInTx, { orderId, amountMinor, currency, method: effectiveMethod, externalReference, notes })) {
          throw new HttpError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'An identical idempotency key was reused with different payment parameters.');
        }
        const currentOrder = await merchModel.getOrderDetails(client, orderId);
        return {
          payment: safePayment(existingInTx),
          order: safeOrder(currentOrder),
          replayed: true,
        };
      }

      // 4c. Lock the order row first (@rule:ORDER_LOCK_ORDER)
      const lockedOrder = await paymentModel.lockOrderForPayment(client, orderId);
      if (!lockedOrder) {
        throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      }
      if (lockedOrder.status === 'cancelled') {
        throw new HttpError(409, 'ORDER_CANCELLED', 'This order was cancelled and cannot receive payment.');
      }
      if (lockedOrder.status === 'fulfilled') {
        throw new HttpError(409, 'ORDER_FULFILLED', 'This order has already been fulfilled.');
      }
      if (lockedOrder.status === 'paid') {
        // Check if this was paid by this same idempotency key or another process
        const orderPayment = await paymentModel.findPaymentByOrder(client, orderId);
        if (orderPayment && orderPayment.idempotencyKey === scopedIdempKey) {
          if (!matchesOrderPaymentPayload(orderPayment, { orderId, amountMinor, currency, method: effectiveMethod, externalReference, notes })) {
            throw new HttpError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'An identical idempotency key was reused with different payment parameters.');
          }
          const currentOrder = await merchModel.getOrderDetails(client, orderId);
          return {
            payment: safePayment(orderPayment),
            order: safeOrder(currentOrder),
            replayed: true,
          };
        }
        throw new HttpError(409, 'ALREADY_PAID', 'This order has already been paid.');
      }
      if (lockedOrder.status !== 'pending') {
        throw new HttpError(409, 'ORDER_NOT_PENDING', 'Order is no longer awaiting payment.');
      }

      // 4d. Re-verify amount and currency against locked order row
      if (lockedOrder.totalMinor !== amountMinor) {
        throw new HttpError(400, 'AMOUNT_MISMATCH', `Payment amount (${amountMinor}) does not match order total (${lockedOrder.totalMinor}).`);
      }
      if (lockedOrder.currency !== currency) {
        throw new HttpError(400, 'CURRENCY_MISMATCH', `Currency (${currency}) does not match order currency (${lockedOrder.currency}).`);
      }

      // 4e. Insert durable payment evidence (@rule:PAYMENT_EVIDENCE)
      const payment = await paymentModel.insertPaymentRecord(client, {
        orderId,
        amountMinor,
        currency,
        method: effectiveMethod,
        externalReference,
        notes,
        recordedBy: staffId,
        idempotencyKey: scopedIdempKey,
      });

      // 4f. Conditionally confirm order payment pending -> paid (@rule:PAYMENT_ONCE)
      const confirmed = await paymentModel.confirmOrderPayment(client, { orderId });
      if (!confirmed) {
        throw new HttpError(409, 'ALREADY_PAID', 'This order was confirmed by another process.');
      }

      // 4g. Return safe payment and updated order details
      const fullOrder = await merchModel.getOrderDetails(client, orderId);
      return {
        payment: safePayment(payment),
        order: safeOrder(fullOrder),
        replayed: false,
      };
    });

    return result;
  } catch (error) {
    if (error.code === '23505') {
      if (error.constraint === 'payment_records_unique_order_idx') {
        throw new HttpError(409, 'ALREADY_PAID', 'This order has already been paid.');
      }
      if (error.constraint === 'payment_records_idempotency_key_key') {
        const existing = await paymentModel.findPaymentByIdempotencyKey(pool, scopedIdempKey);
        if (existing) {
          if (existing.orderId !== orderId) {
            throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different order.');
          }
          if (!matchesOrderPaymentPayload(existing, { orderId, amountMinor, currency, method: effectiveMethod, externalReference, notes })) {
            throw new HttpError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'An identical idempotency key was reused with different payment parameters.');
          }
          const currentOrder = await merchModel.getOrderDetails(pool, orderId);
          return {
            payment: safePayment(existing),
            order: safeOrder(currentOrder),
            replayed: true,
          };
        }
      }
    }
    throw error;
  }
}

/**
 * List pending merchandise orders for authorized staff (treasurer view).
 * Strips internal idempotency keys before returning.
 *
 * @param {import('pg').Pool} pool
 * @param {{ page?: number, pageSize?: number }} [pagination]
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number }>}
 */
export async function listPendingMerchandiseOrders(pool, { page = 1, pageSize = 20 } = {}) {
  const result = await paymentModel.listPendingOrders(pool, { page, pageSize });
  const safeRows = (result.rows || []).map(({ idempotencyKey: _key, ...safe }) => safe);
  return {
    rows: safeRows,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };
}

// ─── Membership Dues Payment Confirmation ───────────────────────────────────

function matchesDuesPaymentPayload(existing, expected) {
  const normRef = expected.externalReference || null;
  const existRef = existing.externalReference || null;
  const normNotes = expected.notes || '';
  const existNotes = existing.notes || '';
  return (
    existing.duesObligationId === expected.duesObligationId &&
    existing.amountMinor === expected.amountMinor &&
    existing.currency === expected.currency &&
    existing.method === expected.method &&
    existRef === normRef &&
    existNotes === normNotes
  );
}

async function getDuesObligationDetails(db, duesObligationId) {
  const { rows } = await db.query(
    `SELECT
       d.id,
       d.membership_period_id AS "membershipPeriodId",
       d.amount_minor AS "amountMinor",
       d.currency,
       d.status,
       d.paid_at AS "paidAt",
       d.payment_ref AS "paymentRef",
       mp.user_id AS "userId",
       mp.starts_at AS "startsAt",
       mp.expires_at AS "expiresAt",
       u.name AS "userName",
       u.email AS "userEmail"
     FROM dues_obligations d
     JOIN membership_periods mp ON mp.id = d.membership_period_id
     JOIN users u ON u.id = mp.user_id
     WHERE d.id = $1`,
    [duesObligationId]
  );
  return rows[0] ?? null;
}

/**
 * Record manual payment received for a membership dues obligation.
 * Refreshes evaluated membership status upon confirmation.
 *
 * @flow:DUES_PAYMENT — Staff records manual payment received:
 *  1. Scopes idempotency key to staff user.
 *  2. Pre-checks existing payment replay.
 *  3. In transaction:
 *     a. Serializes on scoped key via advisory lock.
 *     b. Rechecks in-tx replay.
 *     c. Locks obligation row (SELECT ... FOR UPDATE).
 *     d. Validates pending status, amount, and currency.
 *     e. Inserts durable payment_records row (@rule:PAYMENT_TARGET_MUTEX).
 *     f. Transitions obligation pending -> paid (@rule:DUES_PAYMENT_ONCE).
 *     g. Evaluates refreshed member profile (@rule:MEMBERSHIP_VALIDITY).
 *
 * @param {import('pg').Pool} pool
 * @param {{
 *   duesObligationId: string,
 *   amountMinor: number,
 *   currency: string,
 *   method: string,
 *   externalReference?: string|null,
 *   notes?: string,
 *   idempotencyKey: string
 * }} params
 * @param {string} staffId - UUID of authorized staff member
 * @returns {Promise<{ payment: object, duesObligation: object, memberProfile: object, replayed: boolean }>}
 */
export async function confirmDuesPayment(pool, params, staffId) {
  const {
    duesObligationId,
    amountMinor,
    currency,
    method,
    externalReference = null,
    notes = '',
    idempotencyKey,
  } = params;

  const scopedIdempKey = scopedKey(staffId, idempotencyKey);

  // 1. Pre-transaction idempotency replay check
  const existingPayment = await paymentModel.findPaymentByIdempotencyKey(pool, scopedIdempKey);
  if (existingPayment) {
    if (existingPayment.duesObligationId !== duesObligationId) {
      throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different dues obligation.');
    }
    if (!matchesDuesPaymentPayload(existingPayment, { duesObligationId, amountMinor, currency, method, externalReference, notes })) {
      throw new HttpError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'An identical idempotency key was reused with different payment parameters.');
    }
    const obligation = await getDuesObligationDetails(pool, duesObligationId);
    const memberProfile = obligation ? await memberModel.getMemberProfile(pool, obligation.userId, new Date()) : null;
    return {
      payment: safePayment(existingPayment),
      duesObligation: obligation,
      memberProfile,
      replayed: true,
    };
  }

  // 2. Transaction
  try {
    const result = await transaction(pool, async (client) => {
      // 2a. Advisory lock on scoped idempotency key
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [scopedIdempKey]);

      // 2b. Recheck inside transaction
      const existingInTx = await paymentModel.findPaymentByIdempotencyKey(client, scopedIdempKey);
      if (existingInTx) {
        if (existingInTx.duesObligationId !== duesObligationId) {
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different dues obligation.');
        }
        if (!matchesDuesPaymentPayload(existingInTx, { duesObligationId, amountMinor, currency, method, externalReference, notes })) {
          throw new HttpError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'An identical idempotency key was reused with different payment parameters.');
        }
        const obligation = await getDuesObligationDetails(client, duesObligationId);
        const memberProfile = obligation ? await memberModel.getMemberProfile(client, obligation.userId, new Date()) : null;
        return {
          payment: safePayment(existingInTx),
          duesObligation: obligation,
          memberProfile,
          replayed: true,
        };
      }

      // 2c. Lock dues obligation
      const lockedObligation = await paymentModel.lockDuesObligationForPayment(client, duesObligationId);
      if (!lockedObligation) {
        throw new HttpError(404, 'DUES_OBLIGATION_NOT_FOUND', 'Dues obligation not found.');
      }
      if (lockedObligation.status === 'paid') {
        const duesPayment = await paymentModel.findPaymentByDuesObligation(client, duesObligationId);
        if (duesPayment && duesPayment.idempotencyKey === scopedIdempKey) {
          if (!matchesDuesPaymentPayload(duesPayment, { duesObligationId, amountMinor, currency, method, externalReference, notes })) {
            throw new HttpError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'An identical idempotency key was reused with different payment parameters.');
          }
          const memberProfile = await memberModel.getMemberProfile(client, lockedObligation.userId, new Date());
          return {
            payment: safePayment(duesPayment),
            duesObligation: lockedObligation,
            memberProfile,
            replayed: true,
          };
        }
        throw new HttpError(409, 'ALREADY_PAID', 'This dues obligation has already been paid.');
      }
      if (lockedObligation.status === 'waived') {
        throw new HttpError(409, 'DUES_WAIVED', 'This dues obligation was waived and cannot receive payment.');
      }
      if (lockedObligation.status !== 'pending') {
        throw new HttpError(409, 'INVALID_STATUS', 'Dues obligation is no longer awaiting payment.');
      }

      // 2d. Validate amount and currency
      if (amountMinor !== lockedObligation.amountMinor) {
        throw new HttpError(400, 'AMOUNT_MISMATCH', `Payment amount (${amountMinor}) does not match dues obligation (${lockedObligation.amountMinor}).`);
      }
      if (currency !== lockedObligation.currency) {
        throw new HttpError(400, 'CURRENCY_MISMATCH', `Currency (${currency}) does not match dues obligation currency (${lockedObligation.currency}).`);
      }

      // 2e. Insert durable payment evidence
      const payment = await paymentModel.insertPaymentRecord(client, {
        duesObligationId,
        amountMinor,
        currency,
        method,
        externalReference,
        notes,
        recordedBy: staffId,
        idempotencyKey: scopedIdempKey,
      });

      // 2f. Transition pending -> paid
      const confirmedObligation = await paymentModel.confirmDuesPayment(client, {
        duesObligationId,
        paymentRef: externalReference || method,
        paidAt: new Date().toISOString(),
      });
      if (!confirmedObligation) {
        throw new HttpError(409, 'ALREADY_PAID', 'Dues obligation was confirmed by another process.');
      }

      // 2g. Refreshed membership status evaluated using existing period/benefit rules
      const memberProfile = await memberModel.getMemberProfile(client, lockedObligation.userId, new Date());

      return {
        payment: safePayment(payment),
        duesObligation: confirmedObligation,
        memberProfile,
        replayed: false,
      };
    });

    return result;
  } catch (error) {
    if (error.code === '23505') {
      if (error.constraint === 'payment_records_unique_dues_obligation_idx') {
        throw new HttpError(409, 'ALREADY_PAID', 'This dues obligation has already been paid.');
      }
      if (error.constraint === 'payment_records_idempotency_key_key') {
        const existing = await paymentModel.findPaymentByIdempotencyKey(pool, scopedIdempKey);
        if (existing) {
          if (existing.duesObligationId !== duesObligationId) {
            throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different dues obligation.');
          }
          if (!matchesDuesPaymentPayload(existing, { duesObligationId, amountMinor, currency, method, externalReference, notes })) {
            throw new HttpError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'An identical idempotency key was reused with different payment parameters.');
          }
          const obligation = await getDuesObligationDetails(pool, duesObligationId);
          const memberProfile = obligation ? await memberModel.getMemberProfile(pool, obligation.userId, new Date()) : null;
          return {
            payment: safePayment(existing),
            duesObligation: obligation,
            memberProfile,
            replayed: true,
          };
        }
      }
    }
    throw error;
  }
}

/**
 * Waive a pending dues obligation without recording money collected.
 * Refreshes membership profile.
 *
 * @param {import('pg').Pool} pool
 * @param {string} duesObligationId
 * @param {string} [notes]
 * @param {string} staffId
 * @returns {Promise<{ duesObligation: object, memberProfile: object }>}
 */
export async function waiveDues(pool, duesObligationId, notes = '', _staffId) {
  return transaction(pool, async (client) => {
    const locked = await paymentModel.lockDuesObligationForPayment(client, duesObligationId);
    if (!locked) {
      throw new HttpError(404, 'DUES_OBLIGATION_NOT_FOUND', 'Dues obligation not found.');
    }
    if (locked.status === 'paid') {
      throw new HttpError(409, 'ALREADY_PAID', 'Cannot waive an obligation that has already been paid.');
    }
    if (locked.status === 'waived') {
      throw new HttpError(409, 'DUES_WAIVED', 'This dues obligation has already been waived.');
    }
    if (locked.status !== 'pending') {
      throw new HttpError(409, 'INVALID_STATUS', 'Only pending dues obligations can be waived.');
    }

    const waived = await paymentModel.waiveDuesObligation(client, { duesObligationId, notes });
    if (!waived) {
      throw new HttpError(409, 'ALREADY_PROCESSED', 'Obligation could not be waived in its current state.');
    }

    const memberProfile = await memberModel.getMemberProfile(client, locked.userId, new Date());
    return {
      duesObligation: waived,
      memberProfile,
    };
  });
}

/**
 * List pending dues obligations for authorized staff (treasurer view).
 *
 * @param {import('pg').Pool} pool
 * @param {{ page?: number, pageSize?: number }} [pagination]
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number }>}
 */
export async function listPendingDues(pool, { page = 1, pageSize = 20 } = {}) {
  return paymentModel.listPendingDuesObligations(pool, { page, pageSize });
}

