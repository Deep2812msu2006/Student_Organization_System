import bcrypt from 'bcryptjs';

// Local synthetic accounts only. Never deployed by the production-blocked seed runner.
const fixtures = [
  ['10000000-0000-0000-0000-000000000001', 'Dev Member', 'dev-member@example.local', 'Dev$Member1!', ['member']],
  ['10000000-0000-0000-0000-000000000002', 'Dev Organizer', 'dev-organizer@example.local', 'Dev$Org1!', ['member', 'organizer']],
  ['10000000-0000-0000-0000-000000000003', 'Dev Treasurer', 'dev-treasurer@example.local', 'Dev$Treasurer1!', ['member', 'organizer', 'treasurer']],
];
const oldPlaceholder = '$2b$12$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

export async function seed(pool) {
  const hashed = await Promise.all(fixtures.map(async row => [...row, await bcrypt.hash(row[3], 12)]));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [id, name, email, , roles, hash] of hashed) {
      await client.query('INSERT INTO users (id,name,email,password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id,name,email,hash]);
      const { rows: [existing] } = await client.query('SELECT email FROM users WHERE id=$1', [id]);
      if (existing?.email !== email) throw new Error('Synthetic seed identity collision; no records were overwritten.');
      // Repair only the exact broken placeholder on the known synthetic account.
      await client.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND email=$3 AND password_hash=$4', [hash,id,email,oldPlaceholder]);
      for (const role of roles) await client.query('INSERT INTO user_roles (user_id,role_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id,role]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
