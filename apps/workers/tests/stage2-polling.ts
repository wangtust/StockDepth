import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
async function main() {
const reports = [{ key: 'market', title: 'Market', content: 'a'.repeat(100000) }, { key: 'news', title: 'News', content: 'b'.repeat(100000) }];
let index = 0, bytes = 0, requests = 0;
const server = createServer((req, res) => {
  requests++;
  const payload = JSON.stringify({ status: index === 19 ? 'complete' : 'running', report_version: index >= 10 ? 'v2' : 'v1', reports: reports.map(r => ({ ...r, content: index >= 10 && r.key === 'market' ? 'c'.repeat(100000) : r.content })), usage: { calls: [{ call_id: 'fixture', role: 'quick', model_config_id: 7, provider: 'mock', estimated_cost: '0.000026000000' }], history_complete: index >= 15 } });
  bytes += Buffer.byteLength(payload); res.setHeader('Content-Type', 'application/json'); res.end(payload);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/run`;
  let signature = '', replacements = 0;
  for (index = 0; index < 20; index++) {
    const run = await (await fetch(url)).json(); const next = JSON.stringify(run.reports);
    if (next !== signature) { replacements += run.reports.length; signature = next; }
  }
  assert.equal(requests, 20); assert.equal(replacements, 4);
  const result = { scenario: '20 polls, two 100KB reports, one body change, history completion change', requests, bytes, insertedRows: replacements, deletedRows: 2 };
  await writeFile('../../var/performance/stage2-worker/baseline.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
