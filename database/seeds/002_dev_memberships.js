/**
 * Seed 002 — synthetic development membership periods.
 *
 * @rule:MEMBERSHIP_VALIDITY
 * @flow:MEMBER_PERSISTENCE
 *
 * Creates three representative membership states for testing:
 *   dev-member:    active paid membership (current period, dues paid).
 *   dev-organizer: unpaid/pending membership (period exists, dues pending).
 *   dev-treasurer: expired paid membership (period in past, dues paid).
 *
 * PROVISIONAL DEMO: year-end is March 31 of the following year.
 * This is a local dev seed; none of these records represent real students.
 */

const PLAN_ID = '00000000-0000-0000-0000-000000000001'; // Standard Membership

const MEMBER_USER_ID    = '10000000-0000-0000-0000-000000000001';
const ORGANIZER_USER_ID = '10000000-0000-0000-0000-000000000002';
const TREASURER_USER_ID = '10000000-0000-0000-0000-000000000003';

export async function seed(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Active paid membership for dev-member.
    // @rule:MEMBERSHIP_VALIDITY: starts_at <= now, expires_at > now, status=paid.
    const activePeriod = await client.query(`
      INSERT INTO membership_periods
        (id, user_id, plan_id, starts_at, expires_at, dues_amount_minor, currency)
      VALUES
        (
          '20000000-0000-0000-0000-000000000001',
          $1, $2,
          '2026-04-01 00:00:00+00',
          '2027-03-31 23:59:59+00',
          50000, 'INR'
        )
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [MEMBER_USER_ID, PLAN_ID]);

    if (activePeriod.rowCount > 0) {
      await client.query(`
        INSERT INTO dues_obligations
          (id, membership_period_id, amount_minor, currency, status, paid_at)
        VALUES
          ('30000000-0000-0000-0000-000000000001',
           '20000000-0000-0000-0000-000000000001',
           50000, 'INR', 'paid', '2026-04-02 10:00:00+00')
        ON CONFLICT DO NOTHING
      `);
    }

    // Pending (unpaid) membership for dev-organizer.
    // @rule:MEMBERSHIP_VALIDITY: status=pending → membership NOT active.
    const pendingPeriod = await client.query(`
      INSERT INTO membership_periods
        (id, user_id, plan_id, starts_at, expires_at, dues_amount_minor, currency)
      VALUES
        (
          '20000000-0000-0000-0000-000000000002',
          $1, $2,
          '2026-04-01 00:00:00+00',
          '2027-03-31 23:59:59+00',
          50000, 'INR'
        )
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [ORGANIZER_USER_ID, PLAN_ID]);

    if (pendingPeriod.rowCount > 0) {
      await client.query(`
        INSERT INTO dues_obligations
          (id, membership_period_id, amount_minor, currency, status)
        VALUES
          ('30000000-0000-0000-0000-000000000002',
           '20000000-0000-0000-0000-000000000002',
           50000, 'INR', 'pending')
        ON CONFLICT DO NOTHING
      `);
    }

    // Expired paid membership for dev-treasurer.
    // @rule:MEMBERSHIP_VALIDITY: expires_at < now → membership NOT active.
    const expiredPeriod = await client.query(`
      INSERT INTO membership_periods
        (id, user_id, plan_id, starts_at, expires_at, dues_amount_minor, currency)
      VALUES
        (
          '20000000-0000-0000-0000-000000000003',
          $1, $2,
          '2025-04-01 00:00:00+00',
          '2026-03-31 23:59:59+00',
          50000, 'INR'
        )
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [TREASURER_USER_ID, PLAN_ID]);

    if (expiredPeriod.rowCount > 0) {
      await client.query(`
        INSERT INTO dues_obligations
          (id, membership_period_id, amount_minor, currency, status, paid_at)
        VALUES
          ('30000000-0000-0000-0000-000000000003',
           '20000000-0000-0000-0000-000000000003',
           50000, 'INR', 'paid', '2025-04-05 10:00:00+00')
        ON CONFLICT DO NOTHING
      `);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
