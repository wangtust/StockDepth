// Real AnalysisClient + SWR, synthetic HTTP responses; no jobs or model calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const runtime = require('./frontend-runtime.cjs');
const root = path.resolve(__dirname, '../..');
const job = id => ({id,ticker:`MOCK${id}`,tradeDate:'2026-10-15',language:'English',depth:1,status:'complete',createdAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z',reportCount:0});
(async () => {
  const {outputFiles} = await runtime.dependency('esbuild').build({
    stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Analysis from './app/(dashboard)/dashboard/analysis/analysis-client';import {DataCache} from './components/data-cache';createRoot(document.getElementById('root')).render(<DataCache fallback={{}}><Analysis initialPayload={${JSON.stringify({credits:100,models:[{id:1,name:'Fixture',modelName:'fixture',isDefault:true,quickEnabled:true,deepEnabled:true}],jobs:[job(1),job(2)]})}}/></DataCache>);`,resolveDir:root+'/apps/web',loader:'tsx'},
    bundle:true,write:false,platform:'browser',jsx:'automatic',tsconfig:root+'/apps/web/tsconfig.json',define:{'process.env':'{}'},
    plugins:[{name:'next-dynamic',setup(build){build.onResolve({filter:/^next\/dynamic$/},()=>({path:'dynamic',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`import React,{lazy,Suspense} from 'react';export default loader=>{const C=lazy(()=>loader().then(defaultExport=>({default:defaultExport})));return props=><Suspense fallback={null}><C {...props}/></Suspense>}`,loader:'jsx',resolveDir:root+'/apps/web'}));}}]
  });
  let mode='ok', posts=0, deleted=false, resumed=false; const models=[{id:1,name:'Fixture',modelName:'fixture',isDefault:true,quickEnabled:true,deepEnabled:true}];
  const server=http.createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(outputFiles[0].text);}
    if(req.url.startsWith('/api/')){
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      const jobs=[...(posts?[{...job(3),status:resumed?'queued':'failed'}]:[]),...(!deleted?[job(1),job(2)]:[job(2)])];
      if(req.method==='POST') {
        if(mode==='reject'){res.statusCode=400;return res.end(JSON.stringify({error:'所选模型不可用，请选择其他已启用模型。'}));}
        mode='list-outage';
        if(req.url.endsWith('/retry')) {resumed=true;return res.end(JSON.stringify({ok:true}));}
        posts++;res.statusCode=201;return res.end(JSON.stringify({job:{...job(3),status:'queued',remainingCredits:99}}));
      }
      if(req.method==='DELETE') {deleted=true;mode='list-outage';return res.end(JSON.stringify({success:true}));}
      if(req.url==='/api/analysis/jobs') {
        if(mode==='list-outage'){res.statusCode=503;return res.end(JSON.stringify({error:'Synthetic list failure'}));}
        return res.end(JSON.stringify({credits:posts?99:100,models,jobs}));
      }
      const id=Number(req.url.split('/')[4]?.split('?')[0]);
      const report={id:1,reportKey:'market',title:'Market report',content:'Preserved research evidence'};
      return res.end(JSON.stringify(req.url.includes('?report=')?{report}:{job:jobs.find(j=>j.id===id)||job(id),reports:[report],calls:[]}));
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try{
    browser=await runtime.dependency('playwright').chromium.launch({executablePath:runtime.chromium(),args:['--no-sandbox']});
    const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.bringToFront();
    try {await page.getByText('Preserved research evidence',{exact:true}).waitFor({timeout:10000});} catch(e) {console.error({errors,body:await page.locator('body').innerText()});throw e;}
    mode='reject';
    await page.getByRole('button',{name:'Queue Analysis'}).click();
    await page.getByText('Could not queue analysis',{exact:true}).waitFor();
    assert((await page.locator('body').innerText()).includes('HTTP 400'));
    assert((await page.locator('body').innerText()).includes('selected Quick or Deep model is unavailable'),await page.getByRole('alert').first().innerText());
    assert.equal(posts,0);
    await page.getByRole('button',{name:'Dismiss',exact:true}).click();
    assert.equal(await page.getByText('Could not queue analysis',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Queue Analysis'}).click();
    await page.getByText('Could not queue analysis',{exact:true}).waitFor();
    mode='ok';
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.waitForFunction(()=>!document.body.innerText.includes('Could not queue analysis'));
    // Confirmed writes must retain their success notice when follow-up reads fail.
    await page.getByRole('button',{name:'Queue Analysis'}).click();
    await page.getByText('Analysis queued.',{exact:true}).waitFor({timeout:10000});
    assert.equal(posts,1,'Never resubmit a successful create after refresh failure');
    mode='ok';
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.waitForFunction(()=>!document.body.innerText.includes('Unable to Complete Request'));
    assert.equal(posts,1);
    await page.getByRole('button',{name:/MOCK3/}).filter({has:page.getByText('MOCK3',{exact:true})}).click();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByText('Analysis continuation requested.',{exact:true}).waitFor({timeout:10000});
    assert.equal(resumed,true);
    mode='ok';
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.waitForFunction(()=>!document.body.innerText.includes('Unable to Complete Request'));
    page.on('dialog',d=>d.accept());
    await page.getByRole('button',{name:'MOCK1 job actions'}).click();
    await page.getByRole('menuitem',{name:'Delete',exact:true}).click();
    await page.getByText('Job deleted.',{exact:true}).waitFor({timeout:10000});
    assert.equal(deleted,true);
    mode='ok';
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.waitForFunction(()=>!document.body.innerText.includes('Unable to Complete Request'));
    assert.deepEqual(errors,[]);
    console.log('PASS: actionable model rejection with HTTP status, dismiss and refresh clearing; create, resume and delete remain successful when follow-up reads fail; no repeated writes or sticky failure after read recovery');
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
