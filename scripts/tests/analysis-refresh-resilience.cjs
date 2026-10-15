// Real AnalysisClient + SWR, synthetic HTTP responses; no jobs or model calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const runtime = require('./frontend-runtime.cjs');
const root = path.resolve(__dirname, '../..');
const job = id => ({id,ticker:`MOCK${id}`,tradeDate:'2026-10-15',language:'English',depth:1,status:'running',createdAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z',reportCount:0});
(async () => {
  const {outputFiles} = await runtime.dependency('esbuild').build({
    stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Analysis from './app/(dashboard)/dashboard/analysis/analysis-client';import {DataCache} from './components/data-cache';createRoot(document.getElementById('root')).render(<DataCache fallback={{}}><Analysis initialPayload={${JSON.stringify({credits:100,models:[],jobs:[job(1),job(2)]})}}/></DataCache>);`,resolveDir:root+'/apps/web',loader:'tsx'},
    bundle:true,write:false,platform:'browser',jsx:'automatic',tsconfig:root+'/apps/web/tsconfig.json',define:{'process.env':'{}'},
    plugins:[{name:'next-dynamic',setup(build){build.onResolve({filter:/^next\/dynamic$/},()=>({path:'dynamic',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`import React,{lazy,Suspense} from 'react';export default loader=>{const C=lazy(()=>loader().then(defaultExport=>({default:defaultExport})));return props=><Suspense fallback={null}><C {...props}/></Suspense>}`,loader:'jsx',resolveDir:root+'/apps/web'}));}}]
  });
  let mode='ok', failedReads=0; const transient = new Map();
  const server=http.createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(outputFiles[0].text);}
    if(req.url.startsWith('/api/')){
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      const jobs=[job(1),job(2)];
      if (mode==='denied' && req.url.startsWith('/api/analysis/jobs/')) {failedReads++;res.statusCode=401;return res.end(JSON.stringify({error:'Unauthorized'}));}
      if (mode==='outage' || (mode==='blip' && !transient.has(req.url))) {
        transient.set(req.url,true);failedReads++;res.statusCode=503;return res.end('<html>Gateway unavailable</html>');
      }
      if(req.url==='/api/analysis/jobs') return res.end(JSON.stringify({credits:100,models:[],jobs}));
      const report={id:1,reportKey:'market',title:'Market report',content:'Preserved research evidence'};
      return res.end(JSON.stringify(req.url.includes('?report=')?{report}:{job:jobs[0],reports:[report],calls:[]}));
    }
    res.end('<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try{
    browser=await runtime.dependency('playwright').chromium.launch({executablePath:runtime.chromium(),args:['--no-sandbox']});
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.bringToFront();
    await page.getByText('Preserved research evidence',{exact:true}).waitFor();
    await page.evaluate(()=>{
      window.refreshObservations={alerts:0,missing:false};
      new MutationObserver(()=>{
        if(document.querySelector('[role=alert]'))window.refreshObservations.alerts++;
        if(!document.body.innerText.includes('Preserved research evidence'))window.refreshObservations.missing=true;
      }).observe(document.body,{subtree:true,childList:true});
    });
    mode='blip';
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.waitForTimeout(2500);
    assert(failedReads>=3,'Inject failures into list, detail and report reads');
    assert.deepEqual(await page.evaluate(()=>window.refreshObservations),{alerts:0,missing:false},'Recovered requests must not flash errors or clear reports');
    mode='outage';
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.getByRole('alert').first().waitFor({timeout:10000});
    assert(await page.getByText('Preserved research evidence',{exact:true}).isVisible(),'Keep saved research during a persistent connection failure');
    mode='ok';
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[role=alert]'));
    mode='denied';failedReads=0;
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.getByRole('alert').first().waitFor();
    assert.equal(await page.getByText('Preserved research evidence',{exact:true}).count(),0,'Never retain reports after authorization failure');
    await page.waitForTimeout(5500);
    assert(failedReads<=2,'Authorization errors must not be automatically retried');
    assert.deepEqual(errors,[]);
    console.log('PASS: temporary 503s recover without alert/report flicker; persistent failures stay visible with saved research; recovery and authorization invalidation');
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
