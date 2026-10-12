// Isolated browser mock: no server, credentials, database, or model calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const fs = require('node:fs');
const esbuildPackage = fs.readdirSync(root + '/node_modules/.pnpm').find(name => name.startsWith('esbuild@'));
const esbuild = require(root + '/node_modules/.pnpm/' + esbuildPackage + '/node_modules/esbuild');
const { chromium } = require('/tmp/stockdepth-performance-tools/node_modules/playwright');
const baseline = process.argv.includes('--baseline');
const originalPage = baseline ? require('node:child_process').execFileSync('git', ['show', 'HEAD:apps/web/app/(dashboard)/dashboard/portfolio/page.tsx'], { cwd: root, encoding: 'utf8' }) : null;
const payload = {
  credits: 100, portfolio: { id: 1, name: 'Mock', initialCashCents: 10000000, cashCents: 9990000, currency: 'USD', status: 'active', autoTradeEnabled: false },
  watchlist: [{ id: 1, ticker: 'AAPL' }, { id: 2, ticker: 'MSFT' }],
  positions: [{ id: 1, ticker: 'AAPL', quantity: 1, avgCostCents: 10000, lastPriceCents: 10000, realizedPnlCents: 0 }],
  trades: [], analysisRuns: [], defaultModel: { id: 1, name: 'Mock', provider: 'mock', modelName: 'mock', isDefault: true }
};
(async () => {
  const { outputFiles } = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import Page from './app/(dashboard)/dashboard/portfolio/page';
      import {DataCache} from './components/data-cache';
      const root=createRoot(document.getElementById('root'));
      window.mount=(count=1,user='one')=>root.render(<DataCache key={user} fallback={{}}>{Array.from({length:count},(_,i)=><Page key={i}/>)}</DataCache>);
      window.mount(2);`, resolveDir: root + '/apps/web', loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', jsx: 'automatic', tsconfig: root + '/apps/web/tsconfig.json',
    plugins: baseline ? [{ name: 'original-portfolio', setup(build) {
      build.onLoad({ filter: /portfolio\/page\.tsx$/ }, () => ({ contents: originalPage, loader: 'tsx', resolveDir: root + '/apps/web/app/(dashboard)/dashboard/portfolio' }));
    } }] : []
  });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let gets = 0, posts = 0, fail = false, writeSuccess = false, lastWrite, status = 'complete', olderActive = false;
    await page.route('http://portfolio.test/**', async route => {
      const req = route.request();
      if (req.url().endsWith('/bundle.js')) return route.fulfill({ contentType: 'text/javascript', body: outputFiles[0].text });
      if (new URL(req.url()).pathname.startsWith('/api/')) {
        if (req.method() !== 'GET') { posts++; lastWrite = req.postDataJSON(); return route.fulfill(writeSuccess ? { json: { ok: true } } : { status: 503, json: { error: 'Mock write failed' } }); }
        gets++;
        await new Promise(r => setTimeout(r, 100));
        return route.fulfill(fail ? { status: 503, json: { error: 'Mock read failed' } } : { json: { ...payload, hasActiveAnalysisRuns: olderActive, analysisRuns: [{ id: 1, jobId: 1, ticker: 'AAPL', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', status, depth: 1, tradeDate: '2026-10-12', reportCount: 0 }] } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/bundle.js"></script>' });
    });
    await page.goto('http://portfolio.test/');
    await page.waitForTimeout(700);
    console.log(`Two simultaneous mounts: ${gets} GET requests`);
    assert.equal(gets, baseline ? 2 : 1);
    if (baseline) return;
    await page.evaluate(() => window.mount(1));
    await page.getByLabel('Select MSFT for analysis').check();
    fail = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('Mock read failed', { exact: true }).waitFor();
    assert(await page.getByLabel('Select MSFT for analysis').isChecked());
    assert.equal(await page.locator('#tradeTicker').inputValue(), 'AAPL');
    assert(await page.getByText('$99,900.00', { exact: true }).count());
    fail = false; status = 'running';
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('running', { exact: true }).waitFor();
    const active = gets; await page.waitForTimeout(10500); assert(gets > active, 'Active analysis polls');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    const hidden = gets; await page.waitForTimeout(10500); assert.equal(gets, hidden, 'Hidden pauses');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
    const offline = gets; await page.waitForTimeout(10500); assert.equal(gets, offline, 'Offline pauses');
    status = 'complete';
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
    await page.getByText('complete', { exact: true }).waitFor();
    const complete = gets; await page.waitForTimeout(10500); assert.equal(gets, complete, 'Completed stops');
    olderActive = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForTimeout(700);
    const older = gets; await page.waitForTimeout(10500); assert(gets > older, 'Older activity beyond the displayed history polls');
    olderActive = false;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForTimeout(700);
    // A new user cache must not display previous data on an initial failure.
    fail = true; await page.evaluate(() => window.mount(1, 'two'));
    await page.getByText('Mock read failed', { exact: true }).waitFor();
    assert.equal(await page.getByText('$99,900.00', { exact: true }).count(), 0);
    fail = false; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('$99,900.00', { exact: true }).waitFor();
    await page.locator('#price').fill('100');
    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    await page.getByText('Mock write failed', { exact: true }).waitFor();
    await page.waitForTimeout(5500); assert.equal(posts, 1, 'Failed trade POST is not retried');
    assert.deepEqual(lastWrite, { portfolioId: 1, ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, note: '' });
    writeSuccess = true; fail = true;
    await page.locator('#note').fill('Successful mock trade');
    const beforeMutation = gets;
    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    await page.getByText('Saved, but refreshing the portfolio failed: Mock read failed', { exact: true }).waitFor();
    assert.equal(gets, beforeMutation + 1, 'Successful mutation revalidates once');
    assert.equal(posts, 2, 'Successful mutation sends one POST');
    assert.equal(await page.locator('#note').inputValue(), '', 'Successful write result retained despite read failure');
    assert(await page.getByText('$99,900.00', { exact: true }).count());
    assert.deepEqual(errors, []);
    console.log('PASS: deduplication, stale error/selection/money, active polling, hidden/offline pause, completion stop, user isolation, initial failure recovery, POST no retry, mutation refresh failure');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
