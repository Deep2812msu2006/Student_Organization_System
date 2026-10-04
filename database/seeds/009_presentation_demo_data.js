/**
 * database/seeds/009_presentation_demo_data.js
 *
 * Populates clean, realistic, end-to-end dummy data for the presentation video:
 * - Grants staff/organizer/treasurer privileges to khatriom12062007@gmail.com
 * - 6 beautifully titled events matching photo assets
 * - Polished announcements, volunteer tasks, orders, and expense claims
 * - Safe & idempotent for local development
 */

const ORGANIZER_USER_ID = '10000000-0000-0000-0000-000000000002'; // Dev Organizer

export async function seed(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Remove messy automated test artifacts
    await client.query("DELETE FROM announcements WHERE title LIKE 'Integration announcement%'");
    await client.query("DELETE FROM volunteer_tasks WHERE title LIKE 'Integration announcement%'");
    await client.query("DELETE FROM events WHERE title LIKE 'Demo workshop 179%'");

    // 2. Identify and setup Om's user account with staff privileges
    const omRes = await client.query("SELECT id FROM users WHERE email = 'khatriom12062007@gmail.com'");
    const omId = omRes.rows[0]?.id;

    if (omId) {
      // Add organizer and treasurer roles so Om can showcase the entire platform
      for (const role of ['member', 'organizer', 'treasurer']) {
        await client.query(
          "INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [omId, role]
        );
      }

      // Ensure Om has an active membership with paid dues
      const PLAN_ID = '00000000-0000-0000-0000-000000000001';
      const periodRes = await client.query(
        "SELECT id FROM membership_periods WHERE user_id = $1 AND starts_at <= now() AND expires_at > now()",
        [omId]
      );
      let periodId = periodRes.rows[0]?.id;
      if (!periodId) {
        const ins = await client.query(
          `INSERT INTO membership_periods (user_id, plan_id, starts_at, expires_at, dues_amount_minor, currency)
           VALUES ($1, $2, now() - interval '10 days', now() + interval '350 days', 50000, 'INR')
           RETURNING id`,
          [omId, PLAN_ID]
        );
        periodId = ins.rows[0].id;
      }
      await client.query(
        `INSERT INTO dues_obligations (membership_period_id, amount_minor, currency, status, paid_at)
         VALUES ($1, 50000, 'INR', 'paid', now() - interval '10 days')
         ON CONFLICT DO NOTHING`,
        [periodId]
      );
    }

    // 3. Populate 6 high-quality realistic events for presentation
    const events = [
      {
        id: '40000000-0000-0000-0000-000000000001',
        title: 'Annual Tech Symposium 2026',
        description: 'Flagship annual technology symposium featuring keynotes, panel discussions, and project showcases from leading industry engineers.',
        venue: 'Main Auditorium, Campus Center',
        starts_at: '2026-11-15 09:00:00+00',
        ends_at: '2026-11-15 17:00:00+00',
        capacity: 100,
        member_price_minor: 25000,
        public_price_minor: 50000,
        currency: 'INR',
        status: 'published',
      },
      {
        id: '40000000-0000-0000-0000-000000000002',
        title: 'Web Development Intensive Workshop',
        description: 'Hands-on full-stack web development workshop covering modern backend and frontend workflows, APIs, and containerized deployment.',
        venue: 'Engineering Lab 3B',
        starts_at: '2026-12-01 14:00:00+00',
        ends_at: '2026-12-01 18:00:00+00',
        capacity: 25,
        member_price_minor: 10000,
        public_price_minor: 20000,
        currency: 'INR',
        status: 'published',
      },
      {
        id: '40000000-0000-0000-0000-000000000003',
        title: 'Campus Robotics & AI Showcase 2026',
        description: 'Explore live robotics demonstrations, autonomous obstacle navigation, computer vision bots, and interactive AI hardware booths.',
        venue: 'Student Innovation Hub, Central Wing',
        starts_at: '2026-11-20 10:00:00+00',
        ends_at: '2026-11-20 16:00:00+00',
        capacity: 80,
        member_price_minor: 15000,
        public_price_minor: 30000,
        currency: 'INR',
        status: 'published',
      },
      {
        id: '40000000-0000-0000-0000-000000000004',
        title: 'Design Systems & UI/UX Masterclass',
        description: 'Learn modern Figma component architectures, design tokens, micro-interactions, and accessible design system engineering.',
        venue: 'Arts & Media Center, Room 204',
        starts_at: '2026-11-28 11:00:00+00',
        ends_at: '2026-11-28 15:30:00+00',
        capacity: 40,
        member_price_minor: 12000,
        public_price_minor: 25000,
        currency: 'INR',
        status: 'published',
      },
      {
        id: '40000000-0000-0000-0000-000000000005',
        title: 'Winter Hackathon & Codefest 2026',
        description: '36-hour sprint building campus tools and open-source applications with live mentorship, hardware kits, and cash prizes.',
        venue: 'Great Hall & Digital Commons',
        starts_at: '2026-12-12 09:00:00+00',
        ends_at: '2026-12-13 21:00:00+00',
        capacity: 120,
        member_price_minor: 15000,
        public_price_minor: 35000,
        currency: 'INR',
        status: 'published',
      },
      {
        id: '40000000-0000-0000-0000-000000000006',
        title: 'Annual Alumni & Industry Mixer',
        description: 'Connect with former association leaders, software architects, and tech startup founders in an informal networking setting with refreshments.',
        venue: 'Campus Rooftop Terrace & Lounge',
        starts_at: '2026-12-18 18:00:00+00',
        ends_at: '2026-12-18 22:00:00+00',
        capacity: 60,
        member_price_minor: 20000,
        public_price_minor: 40000,
        currency: 'INR',
        status: 'published',
      },
    ];

    for (const ev of events) {
      await client.query(
        `INSERT INTO events (id, title, description, venue, starts_at, ends_at, capacity, member_price_minor, public_price_minor, currency, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           venue = EXCLUDED.venue,
           starts_at = EXCLUDED.starts_at,
           ends_at = EXCLUDED.ends_at,
           capacity = EXCLUDED.capacity,
           member_price_minor = EXCLUDED.member_price_minor,
           public_price_minor = EXCLUDED.public_price_minor,
           status = EXCLUDED.status`,
        [ev.id, ev.title, ev.description, ev.venue, ev.starts_at, ev.ends_at, ev.capacity, ev.member_price_minor, ev.public_price_minor, ev.currency, ev.status, ORGANIZER_USER_ID]
      );
    }

    // 4. Populate clean announcements
    const presentationAnnouncements = [
      {
        id: '70000000-0000-0000-0000-000000000001',
        title: 'Welcome to Skyline Student Association (2026–2027)',
        body: 'Welcome new and returning students! Skyline is your hub for engineering workshops, hackathons, networking mixers, and merchandise. Explore our upcoming events and join as a member today to unlock ticket and shop discounts.',
        audience: 'public',
        status: 'published',
      },
      {
        id: '70000000-0000-0000-0000-000000000002',
        title: 'Keynote Speakers Announced for Tech Symposium 2026',
        body: 'We are thrilled to announce our keynote lineup featuring alumni engineers from top cloud & AI companies. Seating reservations are filling quickly; secure your seat under Events.',
        audience: 'public',
        status: 'published',
      },
      {
        id: '70000000-0000-0000-0000-000000000003',
        title: 'Exclusive Member Perks & 5% Merchandise Discount',
        body: 'A quick reminder to all active association members: your standard membership entitles you to discounted event tickets and 5% off all official club merchandise. Visit the Shop to check out our new hoodies, pins, and tumblers!',
        audience: 'members',
        status: 'published',
      },
      {
        id: '70000000-0000-0000-0000-000000000004',
        title: 'Call for Volunteers: Winter Hackathon & Codefest',
        body: 'We are recruiting student volunteers to assist with attendee check-in, mentor logistics, and audio/visual setup for the Winter Codefest. Check the Tasks tab to get involved!',
        audience: 'members',
        status: 'published',
      },
    ];

    for (const an of presentationAnnouncements) {
      await client.query(
        `INSERT INTO announcements (id, title, body, audience, status, author_id, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           body = EXCLUDED.body,
           audience = EXCLUDED.audience,
           status = EXCLUDED.status`,
        [an.id, an.title, an.body, an.audience, an.status, ORGANIZER_USER_ID]
      );
    }

    // 5. Populate volunteer tasks assigned to Om
    if (omId) {
      const omTasks = [
        {
          id: '71000000-0000-0000-0000-000000000011',
          title: 'Review keynote speaker presentation decks',
          description: 'Ensure AV compatibility and aspect ratio on the auditorium stage display.',
          status: 'in_progress',
          eventId: '40000000-0000-0000-0000-000000000001',
        },
        {
          id: '71000000-0000-0000-0000-000000000012',
          title: 'Prepare attendee check-in badge scanner kiosk',
          description: 'Set up admission code scanner tables and badge printing stations at Main Auditorium entrance.',
          status: 'todo',
          eventId: '40000000-0000-0000-0000-000000000001',
        },
        {
          id: '71000000-0000-0000-0000-000000000013',
          title: 'Distribute volunteer swag & shirts',
          description: 'Hand out official volunteer t-shirts and lanyards to assigned team members.',
          status: 'done',
          eventId: '40000000-0000-0000-0000-000000000001',
        },
      ];

      for (const t of omTasks) {
        await client.query(
          `INSERT INTO volunteer_tasks (id, title, description, assignee_id, created_by, event_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             status = EXCLUDED.status`,
          [t.id, t.title, t.description, omId, ORGANIZER_USER_ID, t.eventId, t.status]
        );
      }

      // 6. Ensure realistic expenses for Om in /expenses
      await client.query(
        `INSERT INTO expenses (id, purpose, amount_minor, currency, status, requester_id, receipt_key, decided_at, decided_by, decision_reason, reimbursed_at, reimbursed_by, reimbursement_reference, reimbursement_idempotency_key, submitted_at)
         VALUES
           ('60000000-0000-0000-0000-000000000011', 'Stage lighting & microphone cables rental', 35000, 'INR', 'approved', $1, 'receipts/2026/dev-audio-cables.pdf', now() - interval '2 days', '10000000-0000-0000-0000-000000000003', 'Approved per AV budget line item', null, null, null, null, now() - interval '3 days'),
           ('60000000-0000-0000-0000-000000000012', 'A3 Poster & signage printing for campus noticeboards', 12000, 'INR', 'reimbursed', $1, 'receipts/2026/dev-workshop-supplies.pdf', now() - interval '5 days', '10000000-0000-0000-0000-000000000003', 'Approved campus outreach printing', now() - interval '4 days', '10000000-0000-0000-0000-000000000003', 'UPI-REF-99281726', 'seed-reimb-key-om-01', now() - interval '6 days'),
           ('60000000-0000-0000-0000-000000000013', 'Refreshment snacks for workshop attendees', 24000, 'INR', 'submitted', $1, 'receipts/2026/dev-meeting-snacks.pdf', null, null, '', null, null, null, null, now() - interval '1 hour')
         ON CONFLICT (id) DO NOTHING`,
        [omId]
      );
    }

    await client.query('COMMIT');
    console.log('Presentation video demo data seeded successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
