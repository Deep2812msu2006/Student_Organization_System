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
import { transaction } from '../utils/transaction.js';
import { HttpError } from '../utils/httpError.js';

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
