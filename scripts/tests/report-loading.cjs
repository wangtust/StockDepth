const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const esbuild = require(root + '/apps/web/node_modules/esbuild');
(async () => {
  const build = await esbuild.build({ entryPoints: [root + '/apps/web/lib/http/analysis-fetcher.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
  const module = { exports: {} };
  new Function('module', 'exports', build.outputFiles[0].text)(module, module.exports);
  const { analysisFetcher } = module.exports;
  const requests = [];
  let status = 200, etag = '"v1"', content = 'original';
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    requests.push({ url, headers: init.headers });
    return new Response(status === 304 ? null : JSON.stringify({ report: { content } }), { status, headers: { ETag: etag } });
  };
  try {
    const url = '/api/analysis/jobs/1?report=complete';
    const first = await analysisFetcher(url);
    assert.equal(requests.at(-1).headers, undefined);
    status = 304;
    assert.equal(await analysisFetcher(url), first);
    assert.equal(requests.at(-1).headers['If-None-Match'], '"v1"');
    status = 200; content = 'updated'; etag = '"v2"';
    assert.equal((await analysisFetcher(url)).report.content, 'updated');
    status = 403;
    await assert.rejects(analysisFetcher(url), error => error.status === 403);
    status = 200;
    await analysisFetcher(url);
    assert.equal(requests.at(-1).headers, undefined, 'denied responses must evict cached data');
    await analysisFetcher('/api/analysis/jobs');
    await analysisFetcher('/api/analysis/jobs');
    assert.equal(requests.at(-1).headers, undefined, 'job polling must always fetch fresh data');
    for (let i = 2; i <= 18; i++) await analysisFetcher(`/api/analysis/jobs/${i}?report=complete`);
    await analysisFetcher(url);
    assert.equal(requests.at(-1).headers, undefined, 'old entries must be evicted at the cache bound');
    console.log('PASS: conditional report reads, unchanged object reuse, changed content, permission denial eviction, fresh job polling, bounded cache');
  } finally { global.fetch = originalFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
