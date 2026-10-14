// Synthetic fixtures only. Local ephemeral HTTP server; no application or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const esbuild = require(root+'/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild');
const dir = root+'/var/codex-frontend-team/stage1-experience-evidence';
fs.mkdirSync(dir,{recursive:true});
const raw = 'Traceback (most recent call last):\n File "/srv/private/worker.py"\nSECRET_TOKEN=synthetic-secret\nunknown failure';
const job = {id:84,ticker:'MOCK',tradeDate:'2026-10-14',language:'Chinese',depth:1,status:'failed',errorMessage:raw,createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z',reportCount:0};
async function build(before){
  return (await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import AnalysisClient from './app/(dashboard)/dashboard/analysis/analysis-client';import {ErrorPresentation} from './components/error-presentation';import {AnalysisUsage} from './components/analysis-usage';import {presentError} from './lib/analysis/error-presentation';window.presentError=presentError;window.fixture=${JSON.stringify(job)};const r=createRoot(document.getElementById('root'));window.showUsage=(props)=>r.render(<AnalysisUsage {...props}/>);window.showErrors=(values)=>r.render(<div>{values.map((error,i)=><ErrorPresentation key={i} error={error} jobId={84}/>)}</div>);r.render(<AnalysisClient initialPayload={{credits:100,models:[],jobs:[window.fixture]}}/>);`,resolveDir:root+'/apps/web',loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',tsconfig:root+'/apps/web/tsconfig.json',define:{'process.env':'{}'},plugins:[{name:'baseline-and-dynamic',setup(b){b.onLoad({filter:/analysis-client\.tsx$/},args=>before?{contents:fs.readFileSync(root+'/var/codex-frontend-team/stage1-experience-before/apps/web/app/(dashboard)/dashboard/analysis/analysis-client.tsx','utf8'),loader:'tsx'}:undefined);b.onLoad({filter:/analysis-usage\.tsx$/},()=>before?{contents:fs.readFileSync(root+'/var/codex-frontend-team/stage1-experience-repair-before/apps/web/components/analysis-usage.tsx','utf8'),loader:'tsx'}:undefined);b.onResolve({filter:/^next\/dynamic$/},()=>({path:'dynamic',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export default ()=>()=>null',loader:'js'}));}}]})).outputFiles[0].text;
}
(async()=>{
  const postcss=require(root+'/node_modules/.pnpm/postcss@8.5.29/node_modules/postcss');
  const tw=require(root+'/node_modules/.pnpm/@tailwindcss+postcss@4.1.7/node_modules/@tailwindcss/postcss/dist/index.js');
  const css=(await postcss([tw({base:root+'/apps/web'})]).process(fs.readFileSync(root+'/apps/web/app/globals.css','utf8'),{from:root+'/apps/web/app/globals.css'})).css;
  let bundle=await build(true), fail=false;
  const server=http.createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);}
    else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}
    else if(req.url.startsWith('/api/')){assert.equal(req.method,'GET');res.setHeader('Content-Type','application/json');if(fail){res.statusCode=503;res.end(JSON.stringify({error:raw}));return;}res.end(JSON.stringify(req.url==='/api/analysis/jobs'?{credits:100,models:[],jobs:[job]}:{job,reports:[],calls:[]}));}
    else res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=spawn(process.env.FRONTEND_CHROMIUM || '/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+dir+'/browser-profile','about:blank'],{stdio:['ignore','ignore','pipe']});
  let socket;
  try{
    const wsURL=await new Promise((resolve,reject)=>{let stderr='';browser.stderr.on('data',x=>{stderr+=x;const m=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});browser.on('exit',()=>reject(new Error('Chromium exited')));});
    socket=new WebSocket(wsURL);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
    let id=0;const pending=new Map(),errors=[];
    socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(JSON.stringify(m.params.args));});
    const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
    const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    const c=(m,p)=>call(m,p,sessionId);await c('Runtime.enable');await c('Page.enable');
    const evaluate=async expression=>(await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
    const pause=()=>new Promise(r=>setTimeout(r,900));
    for(const before of [true,false]){
      if(!before)bundle=await build(false);
      for(const width of [1440,390]){
        await c('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:width===390});
        await c('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await pause();
        const text=await evaluate('document.body.innerText');
        assert(text.includes('MOCK'));if(before)assert(text.includes('synthetic-secret'));else{assert(text.includes('Analysis Failed'));assert(text.includes('Job #84'));assert(!/Traceback|synthetic-secret|\/srv\/private/.test(text));assert.equal(await evaluate('document.querySelectorAll("[role=alert]").length'),2);}
        const metrics=await c('Page.getLayoutMetrics');const shot=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:metrics.cssContentSize.height,scale:1}});fs.writeFileSync(`${dir}/${before?'before':'after'}-analysis-${width}.png`,Buffer.from(shot.data,'base64'));
      }
    }
    const usageFixture={job:{status:'completed',tokenUsageComplete:false,totalTokens:12},calls:[{callId:'synthetic-retry',agent:'Analyst',role:'quick',model:'Synthetic Model',provider:'PRIVATE_PROVIDER_FIXTURE',modelConfigId:987654,status:'failed',startedAt:'2026-10-14T00:00:00Z',endedAt:'2026-10-14T00:00:01Z',inputTokens:null,outputTokens:null,totalTokens:null,cachedInputTokens:null,usageAvailable:false,isRetry:true,requestKind:'PRIVATE_REQUEST_FIXTURE'},{callId:'synthetic-first',agent:'Analyst',role:'deep',model:'Synthetic Model',provider:'PRIVATE_PROVIDER_FIXTURE',modelConfigId:987654,status:'completed',startedAt:'2026-10-14T00:00:00Z',endedAt:'2026-10-14T00:00:01Z',inputTokens:6,outputTokens:6,totalTokens:12,usageAvailable:true,isRetry:false,requestKind:'PRIVATE_REQUEST_FIXTURE'}]};
    const retryResults=[];
    for(const before of [true,false]){
      bundle=await build(before);
      for(const width of [1440,390]){
        await c('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:width===390});
        await c('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await pause();
        await evaluate(`window.showUsage(${JSON.stringify(usageFixture)})`);await pause();await evaluate('document.querySelector("details").open=true');
        const usageText=await evaluate('document.body.innerText');
        assert.equal(usageText.includes('Retry'),!before);
        assert(!/PRIVATE_PROVIDER_FIXTURE|PRIVATE_REQUEST_FIXTURE|987654|legacy|统计不完整/.test(usageText));
        if(before)assert(usageText.includes('Quick')&&usageText.includes('Deep'));else assert(!Array.from(usageText.matchAll(/\b(?:Quick|Deep)\b/g)).length);
        const rows=await evaluate('Array.from(document.querySelectorAll("tbody tr")).map(r=>r.innerText)');
        assert.equal(rows[0].includes('Retry'),!before);assert(!rows[1].includes('Retry'));assert(rows[0].includes('—'));
        const metrics=await c('Page.getLayoutMetrics');const shot=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:metrics.cssContentSize.height,scale:1}});fs.writeFileSync(`${dir}/repair-${before?'before':'after'}-usage-${width}.png`,Buffer.from(shot.data,'base64'));
        retryResults.push({before,width,retryVisible:usageText.includes('Retry'),privateFieldsHidden:true});
      }
    }
    await evaluate(`window.showUsage(${JSON.stringify({...usageFixture,showDiagnostics:true})})`);await pause();await evaluate('document.querySelector("details").open=true');
    const diagnostics=await evaluate('document.body.innerText');assert(/PRIVATE_PROVIDER_FIXTURE/.test(diagnostics));assert(/PRIVATE_REQUEST_FIXTURE/.test(diagnostics));assert(/987654/.test(diagnostics));assert(/Retry/.test(diagnostics));assert(/Statistics incomplete/.test(diagnostics));
    fs.writeFileSync(dir+'/repair-retry-results.json',JSON.stringify({status:'passed',retryResults,adminDiagnosticsPreserved:true,rawFixtureUnchanged:usageFixture.calls[0].isRetry===true},null,2));
    await c('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await pause();
    fail=true;await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Refresh').click()`);await pause();const failedText=await evaluate('document.body.innerText');assert(failedText.includes('Unable to Complete Request'));assert(!/Traceback|synthetic-secret|\/srv\/private/.test(failedText));fail=false;
    const cases=[['HTTP 429','rate-limit'],['status_code: 429','rate-limit'],['openai.APITimeoutError','timeout'],['ECONNREFUSED','connection'],['openai.APIStatusError','provider'],['timeout might happen','unknown'],['provider broke','unknown'],['429 shares','unknown'],[raw,'unknown'],[null,'unknown'],[{message:'HTTP 429'},'unknown']];
    for(const [input,kind] of cases)assert.equal(await evaluate(`window.presentError(${JSON.stringify(input)}).kind`),kind);
    await evaluate(`window.showErrors(${JSON.stringify(cases.map(c=>c[0]))})`);await pause();const text=await evaluate('document.body.innerText');assert(!/Traceback|synthetic-secret|\/srv\/private|provider broke/.test(text));assert.deepEqual(errors,[]);
    fs.writeFileSync(dir+'/browser-results.json',JSON.stringify({status:'passed',cases:cases.length,analysisSurfaces:2,requestFailureVerified:true,viewports:[1440,390],consoleErrors:errors,limitations:['Dynamic report/progress modules are stubbed; Phase1 failure UI only.','Synthetic fixture screenshots do not exercise server authorization.']},null,2));
    console.log('PASS: 11 deterministic classification cases, 2 analysis failure surfaces, desktop/mobile before/after screenshots; no raw errors or console errors; user Retry/privacy and preserved admin diagnostics passed.');
  }finally{if(socket)socket.close();browser.kill();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
