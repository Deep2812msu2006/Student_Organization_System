/**
 * server/model/event.model.js — Deep owns this file.
 *
 * Events and ticket registrations database layer.
 *
 * Design constraints:
 *  - Parameterized queries ONLY ($1, $2, ...).
 *  - Accepts `db` (pg.Pool or pg.PoolClient).
 *  - Services own transactions. Functions here participate in transactions
 *    using the caller's PoolClient; they never issue BEGIN, COMMIT, or ROLLBACK.
 *  - Prices stored in integer minor units (paise/cents).
 *  - Raw ticket tokens are NEVER stored or queried directly; tokenHash is used.
 *
 * @rule:EVENT_CAPACITY — Total allocated seats equals registrations with
 *   status IN ('pending', 'confirmed'). Pending reservations consume capacity
 *   to avoid overselling during payment processing. Cancelled reservations release capacity.
 *   Services must serialize booking requests via `lockEventForBooking` (FOR UPDATE)
 *   and verify `countAllocatedSeats(client, eventId) < event.capacity`.
 *
 * @rule:CHECKIN_ONCE — An atomic conditional UPDATE ensures a ticket is checked in
 *   exactly once. The update filters on `status = 'confirmed'` and `checked_in_at IS NULL`.
 *   If the ticket is already checked in, unconfirmed, cancelled, or for a different event,
 *   zero rows are updated and `checkInEligibleTicket` returns null.
 */

/**
 * List published events with pagination and calculated available seats.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ page?: number, pageSize?: number }} [params]
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number }>}
 */
export async function listPublishedEvents(db, { page = 1, pageSize = 20, includeUnpublished = false } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (safePage - 1) * safePageSize;
  const statuses = includeUnpublished ? ['draft', 'published', 'cancelled'] : ['published'];

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM events WHERE status = ANY($1::text[])`, [statuses]
  );
  const total = countResult.rows[0]?.total ?? 0;

  const { rows } = await db.query(
    `SELECT
       e.id,
       e.title,
       e.description,
       e.venue,
       e.starts_at AS "startsAt",
       e.ends_at AS "endsAt",
       e.capacity,
       e.member_price_minor AS "memberPriceMinor",
       e.public_price_minor AS "publicPriceMinor",
       e.currency,
       e.status,
       e.created_at AS "createdAt",
       GREATEST(0, e.capacity - COALESCE(reg.allocated_count, 0))::int AS "seatsAvailable"
     FROM events e
     LEFT JOIN (
       SELECT event_id, COUNT(*)::int AS allocated_count
       FROM registrations
       WHERE status IN ('pending', 'confirmed')
       GROUP BY event_id
     ) reg ON reg.event_id = e.id
     WHERE e.status = ANY($3::text[])
     ORDER BY e.starts_at ASC, e.id ASC
     LIMIT $1 OFFSET $2`,
    [safePageSize, offset, statuses]
  );

  return {
    rows,
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

/**
 * Fetch a single event by ID with available seat count.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} eventId
 * @returns {Promise<object | null>}
 */
export async function getEventById(db, eventId) {
  const { rows } = await db.query(
    `SELECT
       e.id,
       e.title,
       e.description,
       e.venue,
       e.starts_at AS "startsAt",
       e.ends_at AS "endsAt",
       e.capacity,
       e.member_price_minor AS "memberPriceMinor",
       e.public_price_minor AS "publicPriceMinor",
       e.currency,
       e.status,
       e.created_at AS "createdAt",
       GREATEST(0, e.capacity - COALESCE(reg.allocated_count, 0))::int AS "seatsAvailable"
     FROM events e
     LEFT JOIN (
       SELECT event_id, COUNT(*)::int AS allocated_count
       FROM registrations
       WHERE status IN ('pending', 'confirmed')
       GROUP BY event_id
     ) reg ON reg.event_id = e.id
     WHERE e.id = $1`,
    [eventId]
  );

  return rows[0] ?? null;
}

/**
 * Insert a new event record (for organizers).
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {object} params
 */
export async function createEvent(db, {
  title,
  description = '',
  venue,
  startsAt,
  endsAt,
  capacity,
  memberPriceMinor,
  publicPriceMinor,
  currency,
  createdBy = null,
  status = 'draft',
}) {
  const { rows } = await db.query(
    `INSERT INTO events
       (title, description, venue, starts_at, ends_at, capacity,
        member_price_minor, public_price_minor, currency, created_by, status)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING
       id,
       title,
       description,
       venue,
       starts_at AS "startsAt",
       ends_at AS "endsAt",
       capacity,
       member_price_minor AS "memberPriceMinor",
       public_price_minor AS "publicPriceMinor",
       currency,
       status,
       created_by AS "createdBy",
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [
      title,
      description,
      venue,
      startsAt,
      endsAt,
      capacity,
      memberPriceMinor,
      publicPriceMinor,
      currency,
      createdBy,
      status,
    ]
  );

  return rows[0];
}

/**
 * Acquire an exclusive row lock on the target event inside an active transaction.
 *
 * @rule:EVENT_CAPACITY — Serialization point for concurrent booking attempts.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} eventId
 * @returns {Promise<object | null>} Event record or null if not found.
 */
export async function lockEventForBooking(client, eventId) {
  const { rows } = await client.query(
    `SELECT
       id,
       title,
       description,
       venue,
       starts_at AS "startsAt",
       ends_at AS "endsAt",
       capacity,
       member_price_minor AS "memberPriceMinor",
       public_price_minor AS "publicPriceMinor",
       currency,
       status
     FROM events
     WHERE id = $1
     FOR UPDATE`,
    [eventId]
  );

  return rows[0] ?? null;
}

/**
 * Count active seat allocations for an event inside a booking transaction.
 *
 * @rule:EVENT_CAPACITY — Pending and confirmed registrations both consume capacity.
 * Cancelled registrations do not consume capacity.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} client
 * @param {string} eventId
 * @returns {Promise<number>}
 */
export async function countAllocatedSeats(client, eventId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM registrations
     WHERE event_id = $1 AND status IN ('pending', 'confirmed')`,
    [eventId]
  );

  return rows[0]?.count ?? 0;
}

/**
 * Insert a registration/ticket record within a booking transaction.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   eventId: string,
 *   userId: string,
 *   priceMinor: number,
 *   currency: string,
 *   status?: 'pending' | 'confirmed' | 'cancelled',
 *   tokenHash: string,
 *   idempotencyKey?: string | null
 * }} params
 * @returns {Promise<object>}
 */
export async function insertRegistration(client, {
  eventId,
  userId,
  priceMinor,
  currency,
  status = 'pending',
  tokenHash,
  idempotencyKey = null,
}) {
  const { rows } = await client.query(
    `INSERT INTO registrations
       (event_id, user_id, price_minor, currency, status, token_hash, idempotency_key)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7)
     RETURNING
       id,
       event_id AS "eventId",
       user_id AS "userId",
       price_minor AS "priceMinor",
       currency,
       status,
       token_hash AS "tokenHash",
       idempotency_key AS "idempotencyKey",
       checked_in_at AS "checkedInAt",
       checked_in_by AS "checkedInBy",
       created_at AS "createdAt"`,
    [
      eventId,
      userId,
      priceMinor,
      currency,
      status,
      tokenHash,
      idempotencyKey,
    ]
  );

  return rows[0];
}

/**
 * Atomically check in an eligible confirmed ticket once.
 *
 * @rule:CHECKIN_ONCE — Conditional mutation: only succeeds if event matches,
 * tokenHash matches, status is 'confirmed', and checked_in_at is currently NULL.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} client
 * @param {{
 *   eventId: string,
 *   tokenHash: string,
 *   staffId?: string | null,
 *   at?: string
 * }} params
 * @returns {Promise<object | null>} Updated registration summary or null if ineligible/already checked in.
 */
export async function checkInEligibleTicket(client, {
  eventId,
  tokenHash,
  staffId = null,
  at = new Date().toISOString(),
}) {
  const { rows } = await client.query(
    `UPDATE registrations
     SET
       checked_in_at = $1,
       checked_in_by = $2,
       updated_at = now()
     WHERE
       event_id = $3
       AND token_hash = $4
       AND status = 'confirmed'
       AND checked_in_at IS NULL
     RETURNING
       id AS "registrationId",
       event_id AS "eventId",
       user_id AS "userId",
       status,
       checked_in_at AS "checkedInAt",
       checked_in_by AS "checkedInBy"`,
    [at, staffId, eventId, tokenHash]
  );

  return rows[0] ?? null;
}

/**
 * List registrations belonging to a specific user (for GET /tickets/me).
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} userId
 * @returns {Promise<Array<object>>}
 */
export async function listUserTickets(db, userId) {
  const { rows } = await db.query(
    `SELECT
       r.id,
       e.status AS "eventStatus",
       r.event_id AS "eventId",
       r.price_minor AS "priceMinor",
       r.currency,
       r.status,
       r.checked_in_at AS "checkedInAt",
       r.created_at AS "createdAt",
       e.title AS "eventTitle",
       e.venue AS "eventVenue",
       e.starts_at AS "eventStartsAt",
       e.ends_at AS "eventEndsAt"
     FROM registrations r
     JOIN events e ON e.id = r.event_id
     WHERE r.user_id = $1
     ORDER BY r.created_at DESC`,
    [userId]
  );

  return rows;
}

/**
 * Find a registration by ID.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} registrationId
 * @returns {Promise<object | null>}
 */
export async function findRegistrationById(db, registrationId) {
  const { rows } = await db.query(
    `SELECT
       id,
       event_id AS "eventId",
       user_id AS "userId",
       price_minor AS "priceMinor",
       currency,
       status,
       token_hash AS "tokenHash",
       idempotency_key AS "idempotencyKey",
       checked_in_at AS "checkedInAt",
       checked_in_by AS "checkedInBy",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM registrations
     WHERE id = $1`,
    [registrationId]
  );

  return rows[0] ?? null;
}

/**
 * Find a registration by idempotency key.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} idempotencyKey
 * @returns {Promise<object | null>}
 */
export async function findRegistrationByIdempotencyKey(db, idempotencyKey) {
  const { rows } = await db.query(
    `SELECT
       id,
       event_id AS "eventId",
       user_id AS "userId",
       price_minor AS "priceMinor",
       currency,
       status,
       token_hash AS "tokenHash",
       idempotency_key AS "idempotencyKey",
       checked_in_at AS "checkedInAt",
       checked_in_by AS "checkedInBy",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM registrations
     WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  return rows[0] ?? null;
}

/**
 * Update registration status (for Dharmik's payment confirmation flow: pending -> confirmed, or cancellation).
 *
 * @param {import('pg').PoolClient} client
 * @param {{ registrationId: string, status: 'pending' | 'confirmed' | 'cancelled' }} params
 * @returns {Promise<object | null>}
 */
export async function updateRegistrationStatus(client, { registrationId, status }) {
  const { rows } = await client.query(
    `UPDATE registrations
     SET
       status = $1,
       updated_at = now()
     WHERE id = $2
     RETURNING
       id,
       event_id AS "eventId",
       user_id AS "userId",
       price_minor AS "priceMinor",
       currency,
       status,
       updated_at AS "updatedAt"`,
    [status, registrationId]
  );

  return rows[0] ?? null;
}

// Additive Step 4 model: caller holds the same event row lock as registrations.
export async function updateEvent(client, eventId, event) {
  await client.query(`UPDATE events SET title=$2,description=$3,venue=$4,starts_at=$5,ends_at=$6,
    capacity=$7,member_price_minor=$8,public_price_minor=$9,currency=$10,status=$11,updated_at=now()
    WHERE id=$1`, [eventId,event.title,event.description,event.venue,event.startsAt,event.endsAt,
    event.capacity,event.memberPriceMinor,event.publicPriceMinor,event.currency,event.status]);
  return getEventById(client,eventId);
}

// Internal credential lookup is deliberately separate from the safe ticket-list model.
export async function ownedTicketCredentials(db,userId){
  return (await db.query('SELECT id,token_hash AS "tokenHash",idempotency_key AS "idempotencyKey" FROM registrations WHERE user_id=$1',[userId])).rows;
}
