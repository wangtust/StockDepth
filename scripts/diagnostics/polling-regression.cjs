// Browser UI uses mocked responses. Reads existing identities, creates no jobs.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(root + '/apps/web/node_modules/dotenv').config({ path: root + '/.env' });
const { chromium } = require(process.env.STOCKDEPTH_PLAYWRIGHT_MODULE || '/tmp/stockdepth-performance-tools/node_modules/playwright');
const sql = require(root + '/apps/web/node_modules/postgres')(process.env.POSTGRES_URL, { max: 1 });
(async () => {
  let browser;
  try {
    const [user] = await sql`select u.id from users u where u.status='active' and u.deleted_at is null
      and exists(select 1 from analysis_jobs j where j.user_id=u.id and j.hidden_at is null)
      order by (u.role='member') desc, u.id limit 1`;
    const { SignJWT } = await import(root + '/apps/web/node_modules/jose/dist/webapi/index.js');
    const token = await new SignJWT({ user: { id: user.id }, expires: new Date(Date.now() + 600000).toISOString() })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    const base = process.env.STOCKDEPTH_DIAGNOSTIC_URL || 'http://127.0.0.1:3000';
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext();
    await context.addCookies([{ name: 'session', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    let status = 'running', details = 0, reports = 0;
    await page.route('**/api/analysis/jobs/*', async route => {
      const url = new URL(route.request().url());
      if (!/^\/api\/analysis\/jobs\/\d+$/.test(url.pathname)) return route.continue();
      const id = Number(url.pathname.split('/').pop());
      const body = url.searchParams.has('report')
        ? (++reports, { report: { id: 1, reportKey: url.searchParams.get('report'), title: 'Mock', content: '# Test report\n\nNo model invoked.' } })
        : (++details, { job: { id, status, inputTokens: 10, outputTokens: 20, totalTokens: 30, tokenUsageComplete: true },
          reports: [{ id: 1, reportKey: 'market', title: 'Mock', updatedAt: status }], calls: [] });
      await route.fulfill({ json: body });
    });
    await page.goto(base + '/dashboard/analysis');
    await page.getByText('Test report', { exact: true }).waitFor();
    await page.waitForTimeout(1200);
    assert.equal(details, 1, 'Initial detail request must be deduplicated');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = { details, reports };
    await page.waitForTimeout(6500);
    assert.equal(details, hidden.details, 'Hidden tab must stop detail refresh');
    assert.equal(reports, hidden.reports, 'Hidden tab must stop report refresh');
    status = 'complete';
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(6500);
    assert(details > hidden.details, 'Visible tab must refresh');
    const completed = { details, reports };
    await page.waitForTimeout(6500);
    assert.equal(details, completed.details, 'Completed job must stop detail polling');
    assert.equal(reports, completed.reports, 'Completed job must stop report polling');
    console.log('PASS: request deduplication, hidden-tab pause, focus refresh, completed-job stop');
  } finally { if (browser) await browser.close(); await sql.end(); }
})().catch(e => { console.error('Polling regression failed:', e.message.split('\n')[0]); process.exitCode = 1; });
