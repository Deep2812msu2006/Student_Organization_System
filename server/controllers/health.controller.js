export function createHealthController(database) {
  return async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!database.configured) {
      return res.status(503).json({ error: {
        code: 'DATABASE_NOT_CONFIGURED', message: 'Set DATABASE_URL in server/.env to check PostgreSQL.',
      } });
    }
    try {
      // @flow:DATABASE_HEALTH — real bounded database round trip; no schema or business data is implied.
      await database.pool.query('SELECT 1 AS healthy');
      return res.json({ data: { status: 'ok', api: 'available', database: 'connected', checkedAt: new Date().toISOString() } });
    } catch {
      return res.status(503).json({ error: {
        code: 'DATABASE_UNAVAILABLE', message: 'The API is running, but PostgreSQL could not be reached.',
      } });
    }
  };
}
