import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchWithBackoff } from '../../apps/workers/src/request';

async function main() {
  let retries = 0, denied = 0, mutations = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { mutations++; response.writeHead(503); response.end(); return; }
    if (request.url === '/denied') { denied++; response.writeHead(401); response.end(); return; }
    retries++;
    response.writeHead(retries < 3 ? 429 : 200, { 'retry-after': '0' });
    response.end('ok');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetchWithBackoff(base);
    assert.equal(response.status, 200); assert.equal(retries, 3);
    assert.equal(await response.text(), 'ok');
    const unauthorized = await fetchWithBackoff(base + '/denied');
    assert.equal(unauthorized.status, 401); assert.equal(denied, 1);
    await unauthorized.body?.cancel();
    const mutation = await fetchWithBackoff(base, { method: 'POST' });
    assert.equal(mutation.status, 503); assert.equal(mutations, 1);
    await mutation.body?.cancel();
    console.log('PASS: transient read retry, successful response, no retry on authentication failure or ambiguous start mutation');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
