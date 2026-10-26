const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const baseUrl = process.env.STOCKDEPTH_TEST_BASE_URL || 'http://127.0.0.1:3000';
require(root + '/apps/web/node_modules/dotenv').config({ path: root + '/.env' });
const sql = require(root + '/apps/web/node_modules/postgres')(process.env.POSTGRES_URL, { max: 1 });
(async () => {
  try {
    const [user] = await sql`select u.id, (select b.analysis_credits from billing_accounts b where b.user_id=u.id) as analysis_credits from users u where u.status='active' and u.deleted_at is null
      and exists(select 1 from analysis_jobs j where j.user_id=u.id and j.hidden_at is null and j.status='complete')
      order by (u.role='member') desc, u.id limit 1`;
    assert(user);
    const { SignJWT } = await import(root + '/apps/web/node_modules/jose/dist/webapi/index.js');
    const token = await new SignJWT({ user: { id: user.id }, expires: new Date(Date.now() + 600000).toISOString() })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    async function read(route) {
      const response = await fetch(baseUrl + route, { headers: { Cookie: 'session=' + token } });
      assert.equal(response.status, 200); return response.json();
    }
    const seen = new Set(); let before, latest;
    for (let page = 0; page < 3; page++) {
      const data = await read('/api/analysis/jobs' + (before ? '?before=' + before : ''));
      assert.equal(data.credits, user.analysis_credits); assert(data.jobs.length <= 20);
      for (const job of data.jobs) {
        assert(!seen.has(job.id)); if (before) assert(job.id < before);
        seen.add(job.id); assert.equal(job.runId, undefined); assert.equal(job.errorMessage, undefined);
        if (!latest && job.status === 'complete') latest = job;
      }
      before = data.nextCursor;
      if (!before) break;
      assert.equal(before, data.jobs.at(-1).id);
    }
    assert(latest);
    const detail = await read('/api/analysis/jobs/' + latest.id);
    const [job] = await sql`select input_tokens,output_tokens,total_tokens,token_usage_complete from analysis_jobs where id=${latest.id}`;
    assert.equal(detail.job.totalTokens, Number(job.total_tokens));
    assert.equal(detail.job.inputTokens, Number(job.input_tokens));
    assert.equal(detail.job.outputTokens, Number(job.output_tokens));
    assert.equal(detail.job.tokenUsageComplete, job.token_usage_complete);
    const calls = await sql`select call_id,input_tokens,output_tokens,total_tokens from analysis_model_calls where job_id=${latest.id}`;
    assert.equal(detail.calls.length, calls.length);
    for (const call of calls) {
      const actual = detail.calls.find(value => value.callId === call.call_id); assert(actual);
      for (const [key, column] of [['inputTokens','input_tokens'], ['outputTokens','output_tokens'], ['totalTokens','total_tokens']])
        assert.equal(actual[key], call[column] == null ? null : Number(call[column]));
      assert.equal(actual.estimatedCost, undefined); assert.equal(actual.pricingSnapshot, undefined);
    }
    const reports = await sql`select id,report_key,content from analysis_reports where job_id=${latest.id} and user_id=${user.id} order by id`;
    assert.equal(detail.reports.length, reports.length);
    assert(detail.reports.every(report => report.content === undefined));
    if (reports.length) {
      const body = await read(`/api/analysis/jobs/${latest.id}?report=${encodeURIComponent(reports[0].report_key)}`);
      assert.equal(body.report.content, reports[0].content);
      const url = baseUrl + `/api/analysis/jobs/${latest.id}?report=${encodeURIComponent(reports[0].report_key)}`;
      const response = await fetch(url, { headers: { Cookie: 'session=' + token } });
      const etag = response.headers.get('etag');
      assert(etag);
      const unchanged = await fetch(url, { headers: { Cookie: 'session=' + token, 'If-None-Match': etag } });
      assert.equal(unchanged.status, 304);
      assert.equal(await unchanged.text(), '');
      const anonymous = await fetch(url, { headers: { 'If-None-Match': etag } });
      assert.equal(anonymous.status, 401, 'conditional requests still require authentication');
      const missing = await fetch(baseUrl + '/api/analysis/jobs/2147483647?report=complete', {
        headers: { Cookie: 'session=' + token, 'If-None-Match': etag }
      });
      assert.equal(missing.status, 404, 'validators cannot bypass report visibility checks');
    }
    console.log('PASS: cursor pagination, credits, historical token/call totals, report catalog/body consistency, public cost isolation');
  } finally { await sql.end(); }
})().catch(e => { console.error('Read regression failed:', e.message); process.exitCode = 1; });
