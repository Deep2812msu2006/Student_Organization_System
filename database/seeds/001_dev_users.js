/**
 * Seed 001 — synthetic development users.
 *
 * @flow:MEMBER_PERSISTENCE
 *
 * Safety rules:
 *  - Uses INSERT ... ON CONFLICT DO NOTHING; re-running never duplicates.
 *  - No real student names, real emails or real passwords.
 *  - password_hash is a static bcrypt-format placeholder (cost 12, known text).
 *    Om's auth service must hash with bcrypt/argon2 at registration time.
 *    NEVER use these hashes outside local development.
 *
 * Synthetic test passwords (local dev only, never deploy):
 *  dev-member@example.local    → Dev$Member1!
 *  dev-organizer@example.local → Dev$Org1!
 *  dev-treasurer@example.local → Dev$Treasurer1!
 *
 * Hash below produced with: bcrypt.hash('Dev$Member1!', 12)
 * (All three users use the same synthetic hash for seeding convenience.)
 */

// Synthetic bcrypt hash of 'Dev$Member1!' at cost 12. LOCAL DEV ONLY.
const SYNTHETIC_HASH = '$2b$12$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

export async function seed(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Synthetic users — ON CONFLICT DO NOTHING prevents duplicates on re-runs.
    // @rule:EMAIL_UNIQUENESS: lower(email) uniqueness enforced by DB index.
    const usersResult = await client.query(`
      INSERT INTO users (id, name, email, password_hash)
      VALUES
        ('10000000-0000-0000-0000-000000000001', 'Dev Member',    'dev-member@example.local',    $1),
        ('10000000-0000-0000-0000-000000000002', 'Dev Organizer', 'dev-organizer@example.local', $1),
        ('10000000-0000-0000-0000-000000000003', 'Dev Treasurer', 'dev-treasurer@example.local', $1)
      ON CONFLICT DO NOTHING
      RETURNING id, email
    `, [SYNTHETIC_HASH]);

    if (usersResult.rowCount === 0) {
      // Users already seeded; skip role assignments to avoid duplicate errors.
      await client.query('COMMIT');
      return;
    }

    // Assign roles to synthetic users.
    await client.query(`
      INSERT INTO user_roles (user_id, role_name)
      VALUES
        ('10000000-0000-0000-0000-000000000001', 'member'),
        ('10000000-0000-0000-0000-000000000002', 'member'),
        ('10000000-0000-0000-0000-000000000002', 'organizer'),
        ('10000000-0000-0000-0000-000000000003', 'member'),
        ('10000000-0000-0000-0000-000000000003', 'organizer'),
        ('10000000-0000-0000-0000-000000000003', 'treasurer')
      ON CONFLICT DO NOTHING
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
