import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { RunPoller } from '../src/analysis-polling';
async function main() {
 let index = 0, mode = 'normal', statusRequests = 0, bodyRequests = 0, bytes = 0;
 const reports = () => [{ key: 'market', title: 'Market', content: (index >= 10 ? 'c' : 'a').repeat(100000) }, { key: 'news', title: 'News', content: 'b'.repeat(100000) }];
 const version = () => index >= 10 ? 'v2' : 'v1';
 const server = createServer((req, res) => {
  const status = req.url?.startsWith('/api/run/status');
  if (status) statusRequests++; else bodyRequests++;
  if (mode === 'legacy' && status) { res.statusCode = 404; res.end('{}'); return; }
  if (mode === 'error' && status) { res.statusCode = 500; res.end('{}'); return; }
  if (mode === 'malformed' && status) { res.end('{'); return; }
  const payload = JSON.stringify({ status: index === 19 ? 'complete' : 'running', report_version: mode === 'race' && !status ? 'v3' : version(),
   reports: status ? reports().map(({ content, ...r }) => ({ ...r, version: version(), size: content.length })) : reports(),
   usage: { calls: [{ call_id: 'fixture', role: 'quick', model_config_id: 7, provider: 'mock', estimated_cost: '0.000026000000' }], history_complete: index >= 15 } });
  bytes += Buffer.byteLength(payload); res.setHeader('Content-Type', 'application/json'); res.end(payload);
 });
 await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
 const url = `http://127.0.0.1:${(server.address() as any).port}/api/run?run_id=fixture`;
 try {
  const poller = new RunPoller<any>(url);
  for (index = 0; index < 20; index++) {
   const run = await poller.poll(); assert(run.reportsConsistent);
   assert.deepEqual(run.reports, reports()); assert.equal(run.usage.history_complete, index >= 15);
   assert.equal(run.usage.calls[0].estimated_cost, '0.000026000000');
  }
  assert.equal(statusRequests, 20); assert.equal(bodyRequests, 2);
  const metrics = { statusRequests, bodyRequests, requests: statusRequests + bodyRequests, bytes };
  await new RunPoller(url).poll(); assert.equal(bodyRequests, 3, 'Recovery must reload bodies');
  mode = 'race'; const race = new RunPoller(url); const raced = await race.poll(); assert.equal(raced.reportsConsistent, false); assert.equal(raced.report_version, 'v3');
  mode = 'normal'; assert.equal((await race.poll()).reportsConsistent, true);
  mode = 'error'; await assert.rejects(new RunPoller(url).poll());
  mode = 'malformed'; await assert.rejects(new RunPoller(url).poll());
  mode = 'legacy'; const legacy = new RunPoller(url); const prior = statusRequests;
  await legacy.poll(); await legacy.poll(); assert.equal(statusRequests - prior, 1, 'Unsupported status endpoint probed once');
  mode = 'normal'; assert.equal((await new RunPoller(url).poll()).reportsConsistent, true);
  await writeFile('../../var/performance/stage2-worker/polling.json', JSON.stringify({ metrics, tests: ['version-equality', 'same-size-content-change', 'independent-usage-completeness', 'decimal-identity', 'recovery-reloads', 'race-retries', '500-propagates', 'invalid-json-propagates', 'legacy-fallback'] }, null, 2));
  console.log(JSON.stringify(metrics)); console.log('9 polling cases passed');
 } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
