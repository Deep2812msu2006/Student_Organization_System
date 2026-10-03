export async function transaction(pool, action) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await action(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
