/**
 * server/services/checkin.service.js — Dharmik owns this file.
 *
 * Ticket check-in workflow for authorized staff.
 *
 * @flow:CHECKIN — Staff submits {eventId, ticketToken} →
 *   1. Validate event exists and is published.
 *   2. Hash the submitted token with SHA-256.
 *   3. Call Deep's checkInEligibleTicket (atomic conditional UPDATE).
 *   4. If null → ticket is invalid, already used, not confirmed, or wrong event.
 *   5. If row → admission granted. Return safe summary with check-in time.
 *
 * @rule:CHECKIN_ONCE — Enforced at the database level by checkInEligibleTicket.
 *   Simultaneous scans for the same ticket: only one UPDATE can succeed because
 *   the conditional clause requires checked_in_at IS NULL.
 *
 * @rule:STAFF_PERMISSION — Only users with 'organizer' role can perform check-in.
 *   The route enforces requireRole('organizer'). This is stricter than volunteer
 *   access; volunteers do not get unrestricted check-in capability.
 */

import * as eventModel from '../model/event.model.js';
import * as paymentModel from '../model/payment.model.js';
import { transaction } from '../utils/transaction.js';
import { hashToken } from '../utils/ticketToken.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Check in a ticket at an event.
 *
 * @param {import('pg').Pool} pool
 * @param {string} eventId - UUID of the event
 * @param {string} ticketToken - Raw admission code (e.g. "sky1_...")
 * @param {string} staffId - UUID of the staff member performing check-in
 * @returns {Promise<object>} Check-in result
 */
export async function checkIn(pool, eventId, ticketToken, staffId) {
  // @flow:CHECKIN step 1 — validate event existence and publication status
  const event = await eventModel.getEventById(pool, eventId);
  if (!event || event.status !== 'published') {
    throw new HttpError(404, 'EVENT_NOT_FOUND', 'Event not found or not published.');
  }

  // @flow:CHECKIN step 2 — hash the submitted token
  const tokenHash = hashToken(ticketToken);

  // @flow:CHECKIN step 3 — atomic conditional check-in
  // Uses a transaction so the check-in timestamp and staff identity are recorded atomically.
  const result = await transaction(pool, async (client) => {
    const checkedIn = await eventModel.checkInEligibleTicket(client, {
      eventId,
      tokenHash,
      staffId,
      at: new Date().toISOString(),
    });
    return checkedIn;
  });

  // @flow:CHECKIN step 4 — null means ineligible/already used
  if (!result) {
    // Distinguish between common failure reasons without exposing personal data.
    // We intentionally don't tell the scanner exactly why — just that the ticket
    // is not valid for admission at this event right now.
    throw new HttpError(409, 'CHECKIN_DENIED',
      'This ticket cannot be admitted. It may be invalid, already used, not confirmed, or for a different event.');
  }

  // @flow:CHECKIN step 5 — return safe admission summary
  return {
    registrationId: result.registrationId,
    eventId: result.eventId,
    status: result.status,
    checkedInAt: result.checkedInAt,
    checkedInBy: result.checkedInBy,
  };
}

/**
 * Get attendance totals for an event (database-backed).
 *
 * @param {import('pg').Pool} pool
 * @param {string} eventId
 * @returns {Promise<object>}
 */
export async function getEventAttendance(pool, eventId) {
  const event = await eventModel.getEventById(pool, eventId);
  if (!event) {
    throw new HttpError(404, 'EVENT_NOT_FOUND', 'Event not found.');
  }

  const totals = await paymentModel.getAttendanceTotals(pool, eventId);
  return {
    eventId: event.id,
    eventTitle: event.title,
    capacity: event.capacity,
    ...totals,
  };
}
