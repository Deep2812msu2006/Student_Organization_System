import pg from 'pg';
import { readFileSync } from 'node:fs';

export function createDatabase(config) {
  // Missing configuration must not silently connect using the machine's default PG credentials.
  if (!config.databaseUrl) return { configured: false, pool: null };
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectTimeoutMs,
    idleTimeoutMillis: 30000,
    query_timeout: config.queryTimeoutMs,
    statement_timeout: config.queryTimeoutMs,
    ssl: config.sslCaFile ? { ca: readFileSync(config.sslCaFile, 'utf8'), rejectUnauthorized: true } : false,
  });
  // An idle connection failure should not crash Node or expose database connection details.
  pool.on('error', () => console.error('An idle database connection failed.'));
  return { configured: true, pool };
}
