/**
 * database/seeds/007_dev_community.js — Deep owns database seeds.
 *
 * Seed announcements and volunteer tasks for community workflows.
 * Safe for local development with ON CONFLICT DO NOTHING.
 */

const announcements = [
  {
    id: '70000000-0000-0000-0000-000000000001',
    title: 'Welcome to Skyline Student Association (2026–2027)',
    body: 'Welcome new and returning students! Skyline is your hub for engineering workshops, hackathons, networking mixers, and merchandise. Explore our upcoming events and join as a member today to unlock ticket and shop discounts.',
    audience: 'public',
    status: 'published',
    authorId: '10000000-0000-0000-0000-000000000002', // Dev Organizer
  },
  {
    id: '70000000-0000-0000-0000-000000000002',
    title: 'Upcoming Web Development Intensive Workshop',
    body: 'Registration is officially open for our hands-on Web Development Intensive Workshop in Engineering Lab 3B. Seating is strictly limited to 20 seats to ensure dedicated mentor support. Active members qualify for discounted reservations.',
    audience: 'public',
    status: 'published',
    authorId: '10000000-0000-0000-0000-000000000002',
  },
  {
    id: '70000000-0000-0000-0000-000000000003',
    title: 'Exclusive Member Perks & 5% Merchandise Discount',
    body: 'A quick reminder to all active association members: your standard membership entitles you to 10% off event ticket reservations and 5% off all official club merchandise. Visit the Shop to check out our new hoodies, pins, and accessories!',
    audience: 'members',
    status: 'published',
    authorId: '10000000-0000-0000-0000-000000000002',
  },
  {
    id: '70000000-0000-0000-0000-000000000004',
    title: 'Call for Volunteers: Annual Tech Symposium 2026',
    body: 'We are recruiting student volunteers to assist with attendee check-in, stage logistics, and photography for the upcoming Annual Tech Symposium. Check the Tasks tab under Community if you would like to get involved!',
    audience: 'members',
    status: 'published',
    authorId: '10000000-0000-0000-0000-000000000002',
  }
];

const tasks = [
  {
    id: '71000000-0000-0000-0000-000000000001',
    title: 'Coordinate check-in desk badge printing',
    description: 'Ensure QR scanner devices and printed badge holders are ready for the Tech Symposium.',
    assigneeId: '10000000-0000-0000-0000-000000000001', // Dev Member
    createdBy: '10000000-0000-0000-0000-000000000002',  // Dev Organizer
    eventId: '40000000-0000-0000-0000-000000000001',
    status: 'in_progress',
  },
  {
    id: '71000000-0000-0000-0000-000000000002',
    title: 'Organize speaker welcome packets',
    description: 'Assemble physical merchandise packets and schedule sheets for guest speakers.',
    assigneeId: '10000000-0000-0000-0000-000000000001',
    createdBy: '10000000-0000-0000-0000-000000000002',
    eventId: '40000000-0000-0000-0000-000000000001',
    status: 'todo',
  }
];

export async function seed(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const a of announcements) {
      await client.query(
        `INSERT INTO announcements (id, title, body, audience, status, author_id, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title,
             body = EXCLUDED.body,
             audience = EXCLUDED.audience,
             status = EXCLUDED.status,
             published_at = EXCLUDED.published_at`,
        [a.id, a.title, a.body, a.audience, a.status, a.authorId]
      );
    }

    for (const t of tasks) {
      await client.query(
        `INSERT INTO volunteer_tasks (id, title, description, assignee_id, created_by, event_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title,
             description = EXCLUDED.description,
             status = EXCLUDED.status`,
        [t.id, t.title, t.description, t.assigneeId, t.createdBy, t.eventId, t.status]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
