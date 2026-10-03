/**
 * Migration runner — Deep owns this file.
 *
 * Usage (from repository root):
 *   npm run migrate              — apply all pending migrations
 *   npm run migrate -- --status  — list applied migrations without running
 *
 * Design rules:
 *  - Ordered by filename prefix (001_, 002_, ...).
 *  - Each migration runs in its own transaction; DDL is transactional in
 *    PostgreSQL (unlike MySQL). If a migration fails the transaction rolls
 *    back, the schema_migrations row is not inserted, and the runner exits.
 *  - Already-applied migrations are skipped (idempotent re-runs).
 *  - The schema_migrations table is created if it does not exist.
 *  - DATABASE_URL must be set; running without it exits with an error.
 *  - Never drops the database or runs a destructive reset automatically.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDatabase } from '../server/config/db.js';
import { readConfig } from '../server/config/env.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

// Bootstrap: create schema_migrations if absent. Uses a separate connection.
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT        PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function bootstrap(pool) {
  await pool.query(BOOTSTRAP_SQL);
}

async function loadApplied(pool) {
  const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(rows.map(r => r.name));
}

async function runMigration(pool, name, sql) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const statusOnly = process.argv.includes('--status');

  let config;
  try {
    config = readConfig();
  } catch (err) {
    console.error('Configuration error:', err.message);
    process.exitCode = 1;
    return;
  }

  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set. Set it in server/.env and retry.');
    process.exitCode = 1;
    return;
  }

  const { pool } = createDatabase(config);

  try {
    await bootstrap(pool);
    const applied = await loadApplied(pool);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter(f => f.endsWith('.sql') && /^\d{3}_/.test(f))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found in database/migrations.');
      return;
    }

    if (statusOnly) {
      console.log('\nMigration status:');
      for (const f of files) {
        const mark = applied.has(f) ? 'applied' : 'pending';
        console.log(`  [${mark}]  ${f}`);
      }
      console.log('');
      return;
    }

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip   ${file}`);
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`  run    ${file} ... `);
      await runMigration(pool, file, sql);
      console.log('done');
      ran++;
    }

    if (ran === 0) {
      console.log('All migrations already applied. Nothing to do.');
    } else {
      console.log(`\n${ran} migration(s) applied.`);
    }
  } catch (err) {
    console.error('\nMigration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
