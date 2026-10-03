import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';

async function serve(t, database) {
  const server = createApp(database).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('liveness works without a database', async t => {
  const url = await serve(t, { configured: false });
  const res = await fetch(`${url}/api/live`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.api, 'available');
  assert.equal(res.headers.get('x-powered-by'), null);
});
test('readiness queries the database and reports connection', async t => {
  let query;
  const url = await serve(t, { configured: true, pool: { query: async sql => { query = sql; } } });
  const res = await fetch(`${url}/api/health`);
  assert.equal(res.status, 200);
  assert.equal(query, 'SELECT 1 AS healthy');
  assert.equal((await res.json()).data.database, 'connected');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
test('missing config is explicit and unavailable', async t => {
  const url = await serve(t, { configured: false });
  const res = await fetch(`${url}/api/health`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'DATABASE_NOT_CONFIGURED');
});
test('database failures never leak credentials or stack traces', async t => {
  const url = await serve(t, { configured: true, pool: { query: async () => { throw new Error('password=SECRET host=private'); } } });
  const res = await fetch(`${url}/api/health`);
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.ok(body.includes('DATABASE_UNAVAILABLE'));
  assert.ok(!body.includes('SECRET'));
  assert.ok(!body.includes('private'));
});
test('unknown API routes return a JSON 404', async t => {
  const url = await serve(t, { configured: false });
  const res = await fetch(`${url}/api/v1/members`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'NOT_FOUND');
});
test('malformed JSON and oversized bodies have safe errors', async t => {
  const url = await serve(t, { configured: false });
  for (const [body, expected] of [['{', 400], [JSON.stringify({ value: 'x'.repeat(110000) }), 413]]) {
    const res = await fetch(`${url}/api/missing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(res.status, expected);
    assert.ok((await res.json()).error.code);
  }
});
