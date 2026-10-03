import { createApp } from './app.js';
import { readConfig } from './config/env.js';
import { createDatabase } from './config/db.js';

const config = readConfig();
const database = createDatabase(config);
const server = createApp(database, config).listen(config.port, config.host, () => {
  console.log(`API listening at http://${config.host}:${config.port}`);
  if (!database.configured) console.log('Database is not configured; /api/health will return 503.');
});
server.on('error', async error => {
  console.error(error.code === 'EADDRINUSE' ? 'API port is already in use.' : 'API failed to start.');
  await database.pool?.end();
  process.exitCode = 1;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();
  server.close(async () => {
    await database.pool?.end();
    clearTimeout(timer);
  });
  server.closeIdleConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
