/**
 * Development seed runner — Deep owns this file.
 *
 * Usage (from repository root):
 *   npm run seed:dev             — insert synthetic development records
 *
 * Safety rules:
 *  - Only runs when NODE_ENV != 'production'.
 *  - Seeds use INSERT ... ON CONFLICT DO NOTHING so they are repeatable
 *    without duplicating records or overwriting real records.
 *  - Seeds never use real student names, emails or passwords.
 *  - Seeds call database/seeds/*.js files in sorted order.
 *  - DATABASE_URL must be set.
 */

import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createDatabase } from '../server/config/db.js';
import { readConfig } from '../server/config/env.js';

const SEEDS_DIR = fileURLToPath(new URL('./seeds', import.meta.url));

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Seed runner refuses to run in production. Set NODE_ENV to development.');
    process.exitCode = 1;
    return;
  }

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
    const files = (await readdir(SEEDS_DIR))
      .filter(f => f.endsWith('.js') && /^\d{3}_/.test(f))
      .sort();

    if (files.length === 0) {
      console.log('No seed files found in database/seeds.');
      return;
    }

    for (const file of files) {
      const seedPath = pathToFileURL(path.join(SEEDS_DIR, file)).href;
      const mod = await import(seedPath);
      if (typeof mod.seed !== 'function') {
        console.warn(`  skip   ${file} (no exported seed() function)`);
        continue;
      }
      process.stdout.write(`  seed   ${file} ... `);
      await mod.seed(pool);
      console.log('done');
    }

    console.log('\nDevelopment seeds complete.');
  } catch (err) {
    console.error('\nSeed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
