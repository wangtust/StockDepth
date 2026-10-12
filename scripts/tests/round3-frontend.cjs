// Isolated browser mock: no server, credentials, database, or model calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const fs = require('node:fs');
const esbuildPackage = fs.readdirSync(root + '/node_modules/.pnpm').find(name => name.startsWith('esbuild@'));
const esbuild = require(root + '/node_modules/.pnpm/' + esbuildPackage + '/node_modules/esbuild');
const { chromium } = require('/tmp/stockdepth-performance-tools/node_modules/playwright');
const baseline = process.argv.includes('--baseline');
const origin = process.argv.includes('--http') ? 'http://portfolio.test' : 'https://portfolio.test';
const originalPage = baseline ? require('node:child_process').execFileSync('git', ['show', 'HEAD:apps/web/app/(dashboard)/dashboard/portfolio/page.tsx'], {cwd:root,encoding:'utf8'}) : null;
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
      import Analysis from './app/(dashboard)/dashboard/analysis/analysis-client';
      import {DataCache} from './components/data-cache';
      const root=createRoot(document.getElementById('root'));
      window.mount=(count=1,user='one')=>root.render(<DataCache key={user} fallback={{}}>{Array.from({length:count},(_,i)=><Page key={i}/>)}</DataCache>);
      window.mountAnalysis=(payload)=>root.render(<DataCache key={JSON.stringify(payload)} fallback={{}}><Analysis initialPayload={payload}/></DataCache>); window.mount(2);`, resolveDir: root + '/apps/web', loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', jsx: 'automatic', tsconfig: root + '/apps/web/tsconfig.json',
    plugins: baseline ? [{name:'round3-original',setup(build){build.onLoad({filter:/portfolio\/page\.tsx$/},()=>({contents:originalPage,loader:'tsx',resolveDir:root+'/apps/web/app/(dashboard)/dashboard/portfolio'}));}}] : [],

  });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let analysisJob; const writes=[]; let mode='lost'; let lastKey; let gets = 0, posts = 0, fail = false, writeSuccess = false, lastWrite, status = 'complete', olderActive = false;
    await page.route(origin + '/**', async route => {
      const req = route.request();
      if (req.url().endsWith('/bundle.js')) return route.fulfill({ contentType: 'text/javascript', body: outputFiles[0].text });
      if (new URL(req.url()).pathname.startsWith('/api/')) {
        if (req.method() !== 'GET') {
          posts++; lastWrite=req.postDataJSON(); lastKey=req.headers()['idempotency-key'];
          writes.push({key:lastKey,body:lastWrite});
          await new Promise(r=>setTimeout(r,100));
          if(mode==='lost') return route.abort('failed');
          if(mode==='malformed') return route.fulfill({body:'broken',contentType:'application/json'});
          if(mode==='conflict') return route.fulfill({status:409,json:{error:'Conflict'}});
          if(mode==='reject') return route.fulfill({status:400,json:{error:'Insufficient cash'}});
          return route.fulfill({json:{trade:{id:posts},position:{id:1}}});
        }
        if(req.url().includes('/api/analysis/')) return route.fulfill({json:{job:analysisJob,reports:[],calls:[]}});
        gets++;
        await new Promise(r => setTimeout(r, 100));
        return route.fulfill(fail ? { status: 503, json: { error: 'Mock read failed' } } : { json: { ...payload, hasActiveAnalysisRuns: olderActive, analysisRuns: [{ id: 1, jobId: 1, ticker: 'AAPL', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', status, depth: 1, tradeDate: '2026-10-12', reportCount: 0 }] } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/bundle.js"></script>' });
    });
    await page.goto(origin + '/');
    const cryptoContext = await page.evaluate(() => ({ secure: isSecureContext,
      randomUUID: typeof crypto.randomUUID, getRandomValues: typeof crypto.getRandomValues }));
    assert.equal(cryptoContext.secure, !process.argv.includes('--http'));
    assert.equal(cryptoContext.randomUUID, process.argv.includes('--http') ? 'undefined' : 'function');
    assert.equal(cryptoContext.getRandomValues, 'function');
    console.log(JSON.stringify({ origin, cryptoContext }));
    await page.waitForTimeout(700);
    console.log(`Two simultaneous mounts: ${gets} GET requests`);
    assert.equal(gets, 1);
    await page.evaluate(() => window.mount(1));
    await page.locator('#price').fill('100');
    const submit=async()=>{await page.waitForFunction(()=>!document.querySelector('#price').closest('form').querySelector('button[type=submit]').disabled); return page.locator('#price').evaluate(el=>{const form=el.closest('form'); form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});};
    await submit();
    if(baseline){await page.getByText('Failed to fetch',{exact:true}).waitFor(); assert.equal(posts,2,'Baseline same-tick duplicate sends two POSTs'); assert.equal(writes[0].key,undefined); console.log('BASELINE: no UUID header; two same-tick POSTs; lost response shown as ordinary Failed to fetch'); return;}
    await page.getByRole('button',{name:'Retry original trade'}).waitFor();
    assert.equal(posts,1,'Same-tick duplicate submit blocked');
    assert.match(writes[0].key,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    await page.waitForTimeout(600); assert.equal(posts,1,'No automatic POST retry');
    assert((await page.locator('body').innerText()).includes('may already have executed'));
    mode='malformed'; await page.getByRole('button',{name:'Retry original trade'}).click();
    await page.getByText(/Unrecognized|Unexpected token/).first().waitFor();
    assert.equal(writes[1].key,writes[0].key);
    mode='conflict'; await page.getByRole('button',{name:'Retry original trade'}).click();
    await page.getByText(/Trade response uncertain.*Conflict/).waitFor();
    assert.equal(writes[2].key,writes[0].key);
    mode='success'; await page.getByRole('button',{name:'Retry original trade'}).click();
    await page.waitForFunction(()=>!document.body.innerText.includes('Retry original trade'));
    assert.equal(writes[3].key,writes[0].key); assert.deepEqual(writes[3].body,writes[0].body);
    await submit(); await page.waitForTimeout(300);
    assert.notEqual(writes[4].key,writes[0].key,'Next identical successful trade gets new key');
    mode='reject'; await submit(); await page.getByText('Trade rejected: Insufficient cash').waitFor();
    const rejected=writes.at(-1).key;
    await submit(); await page.waitForTimeout(250); assert.notEqual(writes.at(-1).key,rejected,'Business rejection retires key');
    mode='lost'; await submit(); await page.getByRole('button',{name:'Retry original trade'}).waitFor();
    const lost=writes.at(-1);
    await page.locator('#quantity').fill('11'); mode='success'; await submit(); await page.waitForTimeout(300);
    assert.notEqual(writes.at(-1).key,lost.key,'Changed content new key');
    assert.equal(writes.at(-1).body.quantity,11);
    await page.getByRole('button',{name:'Retry original trade'}).click(); await page.waitForTimeout(300);
    assert.deepEqual(writes.at(-1),lost,'Original request preserved despite edits');
    fail=true; await page.locator('#note').fill('saved note'); await submit();
    await page.getByText('Saved, but refreshing the portfolio failed: Mock read failed',{exact:true}).waitFor();
    assert.equal(await page.locator('#note').inputValue(),'');
    fail=false;
    for (const [jobStatus,externalStatus,text] of [
      ['queued',null,'任务已排队，等待工作进程接手。'],
      ['running',null,'任务正在执行，已保存的报告会持续更新。'],
      ['failed',null,'任务执行失败。已保存的报告仍可查看；可使用 Continue 请求从检查点继续。'],
      ['queued','resume-queued','继续请求已排队，等待工作进程接手；将从已保存的检查点恢复。']
    ]) {
      analysisJob={id:42,ticker:'MOCK',tradeDate:'2026-10-12',status:jobStatus,externalStatus,depth:1,language:'Chinese',totalTokens:1234,inputTokens:1000,outputTokens:234,tokenUsageComplete:false,createdAt:'2026-10-12',updatedAt:'2026-10-12',quickModel:'quick-mock',deepModel:'deep-mock',errorMessage:jobStatus==='failed'?'Actual server error':null};
      await page.evaluate(job=>window.mountAnalysis({credits:100,jobs:[job],models:[{id:1,name:'Mock',modelName:'model-mock',isDefault:true}]}),analysisJob);
      await page.getByText(text,{exact:true}).first().waitFor();
      assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).count(),jobStatus==='failed'?1:0);
      assert((await page.locator('body').innerText()).includes('快速 quick-mock · 深度 deep-mock'));
      assert((await page.locator('body').innerText()).includes('总 token 1,234（统计不完整）'));
      assert.equal(await page.getByRole('button',{name:'MOCK 任务操作'}).count(),1);
      if(jobStatus==='failed') await page.getByText('Actual server error',{exact:true}).first().waitFor();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: UUID lifecycle, same-tick duplicates, lost/malformed responses, 409 retention, explicit original retry, input changes, definitive rejection, successful refresh failure, queued/running/failed/resume-queued, models and Continue');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
