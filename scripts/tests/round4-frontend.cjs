// Isolated browser mock. All requests intercepted; no DB, credentials or providers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const pkg = fs.readdirSync(root + '/node_modules/.pnpm').find(n => n.startsWith('esbuild@'));
const esbuild = require(`${root}/node_modules/.pnpm/${pkg}/node_modules/esbuild`);
const { chromium } = require('/tmp/stockdepth-performance-tools/node_modules/playwright');
(async () => {
  const { outputFiles } = await esbuild.build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {StocksClient,StockDetailClient} from './app/(dashboard)/dashboard/stocks/stocks-client';
    import * as math from './app/(dashboard)/dashboard/stocks/market-display';
    import Portfolio from './app/(dashboard)/dashboard/portfolio/page'; import {DataCache} from './components/data-cache';
    const root=createRoot(document.getElementById('root')); window.math=math;
    window.mount=(kind,user='one')=>root.render(<DataCache key={user+kind} fallback={{}}>{kind==='list'?<StocksClient/>:kind==='detail'?<StockDetailClient id='1'/>:<Portfolio/>}</DataCache>); window.mount('list');`, resolveDir: root + '/apps/web', loader: 'tsx' }, define:{'process.env':'{}'},bundle:true,write:false,platform:'browser',jsx:'automatic',tsconfig:root+'/apps/web/tsconfig.json' });
  const browser = await chromium.launch({args:['--no-sandbox']});
  try {
    const page = await browser.newPage(); const errors=[],requests=[];
    page.on('pageerror',e=>{errors.push(e.message);console.error('pageerror:',e.message)});
    let fail=false, empty=false, missing=false, user='one', second=false;
    const instrument={id:1,symbol:'MOCK',exchange:'NYSE',name:'Mock stock',currency:'USD',timezone:'America/New_York',status:'verified'};
    const quote={id:1,price:'100.123456789012',currency:'USD',quotedAt:new Date(Date.now()-60000).toISOString(),fetchedAt:new Date(Date.now()-30000).toISOString(),source:'mock',priceType:'regular_unadjusted',freshness:'fresh'};
    const position={id:1,ticker:'MOCK',quantity:3,avgCostCents:10000,lastPriceCents:999999,realizedPnlCents:123,instrumentId:1,quote,valuationStatus:'valid'};
    await page.route('http://market.test/**',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.pathname==='/bundle.js') return route.fulfill({contentType:'text/javascript',body:outputFiles[0].text});
      if(url.pathname.startsWith('/api/')) {
        requests.push({method:req.method(),path:url.pathname,search:url.search});
        assert.equal(req.method(),'GET','Shared UI is read-only');
        if(fail) return route.fulfill({status:503,json:{error:'Mock unavailable'}});
        if(url.pathname==='/api/paper') return route.fulfill({json:{credits:0,portfolio:{id: user==='one'?1:2,name:user,cashCents:10000,initialCashCents:40000,currency:'USD',status:'active',autoTradeEnabled:false},positions:missing?[{...position,quote:null}]:user==='one'?[position]:[],trades:[],watchlist:[],analysisRuns:[]}});
        if(url.pathname==='/api/market/instruments/1') return route.fulfill({json:{instrument,latestQuote:missing?null:quote,dailyPrices:[],sync:{status:'ready',lastSuccessAt:quote.fetchedAt}}});
        assert.equal(url.searchParams.get('limit'),'25');
        second=url.searchParams.has('before');
        return route.fulfill({json:{instruments:empty?[]:[{...instrument,id:second?2:1}],nextCursor:second?null:'cursor / opaque'}});
      }
      return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/bundle.js"></script>'});
    });
    await page.goto('http://market.test/'); await page.getByRole('link',{name:'MOCK · NYSE'}).waitFor();
    const start=requests.length;
    await page.locator('#stock-search').fill('M'); await page.locator('#stock-search').fill('MO'); await page.locator('#stock-search').fill('MOCK');
    await page.waitForTimeout(650); assert.equal(requests.length,start+1,'debounced search');
    assert(requests.at(-1).search.includes('q=MOCK'));
    await page.getByRole('button',{name:'Next stocks',exact:true}).click(); await page.waitForTimeout(150);
    assert(requests.at(-1).search.includes('before=cursor+%2F+opaque'));
    assert(await page.getByRole('button',{name:'Next stocks',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Previous stocks'}).click();
    empty=true; await page.getByRole('button',{name:'Refresh stocks'}).click(); await page.getByText('No matching stocks.').waitFor();
    fail=true; await page.getByRole('button',{name:'Refresh stocks'}).click(); await page.getByRole('alert').waitFor(); fail=false;empty=false;
    await page.evaluate(()=>window.mount('detail')); await page.getByText(/USD 100.123456789012/).waitFor();
    assert((await page.locator('body').innerText()).includes('America/New_York'));
    assert((await page.locator('body').innerText()).includes('Quoted:'));
    assert((await page.locator('body').innerText()).includes('Fetched:'));
    await page.getByText('No daily prices available.').waitFor();
    missing=true; await page.getByRole('button',{name:'Refresh details'}).click(); await page.getByText('Missing quote — valuation unavailable').waitFor(); missing=false;
    const boundary = await page.evaluate(({quote,position})=>{
      const m=window.math; const q={...quote}; const p={...position,quote:q};
      const invalid=[{...q,freshness:'stale'},{...q,quotedAt:null},{...q,quotedAt:new Date(Date.now()+60000).toISOString()},{...q,currency:'CNY'},{...q,priceType:'adjusted'},{...q,price:'1.1234567890123'}];
      return {value:m.exactMoney(m.positionValue(p,'USD').value,'USD'),bad:invalid.map(quote=>m.positionValue({...p,quote},'USD').value),legacy:m.positionValue({quantity:1,avgCostCents:10},'USD').value};
    },{quote,position});
    assert.equal(boundary.value,'USD 300.37'); assert(boundary.bad.every(v=>v===null));assert.equal(boundary.legacy,null);
    await page.evaluate(()=>window.mount('portfolio')); await page.getByText('USD 400.37',{exact:true}).waitFor();
    await page.locator('#price').fill('42.55');await page.getByRole('button',{name:'MOCK',exact:true}).click();assert.equal(await page.locator('#price').inputValue(),'42.55');
    missing=true; await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Incomplete',{exact:true}).first().waitFor();
    user='two';missing=false; await page.evaluate(()=>window.mount('portfolio','two'));await page.waitForTimeout(250);
    assert.equal(await page.getByRole('button',{name:'MOCK',exact:true}).count(),0,'No previous-user portfolio cache');
    await page.evaluate(()=>window.mount('list','two'));await page.getByRole('link',{name:'MOCK · NYSE'}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS: read-only shared stocks, debounce, bounded cursor pagination, empty/error, quote provenance/timezone, missing history/quote, exact decimal valuation, stale/future/missing/currency/adjustment/precision rejection, manual-price preservation, user cache isolation. Mock isolation is not server authorization proof.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
