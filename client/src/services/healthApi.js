export async function getHealth(signal) {
  const response = await fetch('/api/health', { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  let body;
  try { body = await response.json(); } catch { throw new Error('The API did not return JSON. Check the Express server and Vite proxy.'); }
  if (!response.ok) throw new Error(body.error?.message || 'The health check failed.');
  if (body.data?.database !== 'connected') throw new Error('The API returned an unexpected health response.');
  return body.data;
}
