// Real AnalysisClient + SWR, synthetic HTTP responses; no jobs or model calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const runtime = require('./frontend-runtime.cjs');
const root = path.resolve(__dirname, '../..');
const job = id => ({id,ticker:`MOCK${id}`,tradeDate:'2026-10-15',language:'English',depth:1,status:'queued',createdAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z',reportCount:0});
(async () => {
  const {outputFiles} = await runtime.dependency('esbuild').build({
    stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Analysis from './app/(dashboard)/dashboard/analysis/analysis-client';import {DataCache} from './components/data-cache';createRoot(document.getElementById('root')).render(<DataCache fallback={{}}><Analysis initialPayload={${JSON.stringify({credits:100,models:[],jobs:[job(1),job(2)]})}}/></DataCache>);`,resolveDir:root+'/apps/web',loader:'tsx'},
    bundle:true,write:false,platform:'browser',jsx:'automatic',tsconfig:root+'/apps/web/tsconfig.json',define:{'process.env':'{}'},
    plugins:[{name:'next-dynamic',setup(build){build.onResolve({filter:/^next\/dynamic$/},()=>({path:'dynamic',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`import React,{lazy,Suspense} from 'react';export default loader=>{const C=lazy(()=>loader().then(defaultExport=>({default:defaultExport})));return props=><Suspense fallback={null}><C {...props}/></Suspense>}`,loader:'jsx',resolveDir:root+'/apps/web'}));}}]
  });
  let status='queued', listReads=0;
  const server=http.createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(outputFiles[0].text);}
    if(req.url.startsWith('/api/')){
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      const jobs=[job(1),job(2)].map(j=>({...j,status}));
      if(req.url==='/api/analysis/jobs'){listReads++;return res.end(JSON.stringify({credits:100,models:[],jobs}));}
      return res.end(JSON.stringify({job:jobs[0],reports:[],calls:[]}));
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
    page.on('console',message=>{if(message.type()==='error') console.error(message.text());});
    const row=id=>page.locator('button').filter({has:page.getByText(`MOCK${id}`,{exact:true})});
    await row(2).getByText('queued',{exact:true}).waitFor();
    // Change server state without clicking, focusing, remounting, or reloading.
    status='running';
    try { await row(2).getByText('running',{exact:true}).waitFor({timeout:11000}); } catch(e) { console.error({listReads,errors,visibility:await page.evaluate(()=>document.visibilityState),text:await row(2).innerText()}); throw e; }
    await row(1).getByText('running',{exact:true}).waitFor();
    assert(listReads>0,'SSR fallback must start list polling for unselected jobs too');
    status='complete';
    await row(2).getByText('complete',{exact:true}).waitFor({timeout:11000});
    await row(1).getByText('complete',{exact:true}).waitFor();
    const completedReads=listReads;
    await page.waitForTimeout(8000);
    assert.equal(listReads,completedReads,'Stop list polling after all jobs finish');
    assert.deepEqual(errors,[]);
    console.log('PASS: selected and unselected job labels queued → running → complete without refresh; polling stops after completion');
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
