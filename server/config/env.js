import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

function integer(name, fallback, min, max) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

export function readConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    let url;
    try { url = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.');
    // TLS policy is explicit below, not overridden by URL options in node-postgres.
    if (['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].some(key => url.searchParams.has(key))) {
      throw new Error('Configure database TLS with DB_SSL_CA_FILE instead of URL SSL parameters.');
    }
  }
  return {
    host: process.env.HOST || '127.0.0.1', port: integer('PORT', 5000, 1, 65535),
    databaseUrl, poolMax: integer('DB_POOL_MAX', 10, 1, 50),
    connectTimeoutMs: integer('DB_CONNECT_TIMEOUT_MS', 3000, 100, 30000),
    queryTimeoutMs: integer('DB_QUERY_TIMEOUT_MS', 4000, 100, 30000),
    sslCaFile: process.env.DB_SSL_CA_FILE || null,
  };
}
