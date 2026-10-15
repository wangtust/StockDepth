// Synthetic fixtures only. Local ephemeral HTTP server; no application or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
// Explicit after mode validates current code without private historical snapshots.
const comparisonModes = process.argv[2] === 'after' ? [false] : [true, false];
const esbuild = require('./frontend-runtime.cjs').dependency('esbuild');
const dir = process.env.FRONTEND_TEST_OUTPUT || root+'/var/codex-frontend-team/stage4-experience-pages-evidence';
fs.mkdirSync(dir,{recursive:true});
const raw = 'Traceback (most recent call last):\n File "/srv/private/worker.py"\nSECRET_TOKEN=synthetic-secret\nunknown failure';
const job = {id:84,ticker:'MOCK',tradeDate:'2026-10-14',language:'Chinese',depth:1,status:'failed',errorMessage:raw,createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z',reportCount:0};
async function build(before){
  return (await esbuild.build({stdin:{contents:`import React from 'react';import Portfolio from './app/(dashboard)/dashboard/portfolio/page';import {StocksClient,StockDetailClient} from './app/(dashboard)/dashboard/stocks/stocks-client';import {MarkdownRenderer} from './components/markdown-renderer';import {createRoot} from 'react-dom/client';import AnalysisClient from './app/(dashboard)/dashboard/analysis/analysis-client';import {ErrorPresentation} from './components/error-presentation';import {AnalysisUsage} from './components/analysis-usage';import {AnalysisProgress} from './components/analysis-progress';import {RecentlyDeletedJobs} from './components/recently-deleted-jobs';import {parseProgress,toolLabel,resultSummary} from './lib/analysis/progress-events';import {presentError} from './lib/analysis/error-presentation';window.presentError=presentError;window.parseProgress=parseProgress;window.toolLabel=toolLabel;window.resultSummary=resultSummary;window.fixture=${JSON.stringify(job)};const r=createRoot(document.getElementById('root'));window.showPortfolio=()=>r.render(<Portfolio/>);window.showStocks=()=>r.render(<StocksClient/>);window.showStockDetail=()=>r.render(<StockDetailClient id='1'/>);window.showMarkdown=(content)=>r.render(<MarkdownRenderer content={content}/>);window.showAnalysis=()=>r.render(<AnalysisClient initialPayload={{credits:100,models:[],jobs:[window.fixture]}}/>);window.showProgress=(props)=>r.render(<AnalysisProgress {...props}/>);window.showDeleted=()=>r.render(<RecentlyDeletedJobs/>);window.showUsage=(props)=>r.render(<AnalysisUsage {...props}/>);window.showErrors=(values)=>r.render(<div>{values.map((error,i)=><ErrorPresentation key={i} error={error} jobId={84}/>)}</div>);r.render(<AnalysisClient initialPayload={{credits:100,models:[],jobs:[window.fixture]}}/>);`,resolveDir:root+'/apps/web',loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',tsconfig:root+'/apps/web/tsconfig.json',define:{'process.env':'{}'},plugins:[{name:'baseline-and-dynamic',setup(b){b.onLoad({filter:/(portfolio\/page|stocks-client)\.tsx$/},args=>before?{contents:fs.readFileSync(root+'/var/codex-frontend-team/stage4-experience-before/'+path.relative(root,args.path),'utf8'),loader:'tsx'}:undefined);b.onLoad({filter:/analysis-client\.tsx$/},args=>before?{contents:fs.readFileSync(root+'/var/codex-frontend-team/stage4-experience-before/apps/web/app/(dashboard)/dashboard/analysis/analysis-client.tsx','utf8'),loader:'tsx'}:undefined);b.onLoad({filter:/(analysis-progress|recently-deleted-jobs)\.(tsx|ts)$/},args=>before?{contents:fs.readFileSync(root+'/var/codex-frontend-team/stage4-experience-before/'+path.relative(root,args.path),'utf8'),loader:args.path.endsWith('.tsx')?'tsx':'ts'}:undefined);b.onLoad({filter:/analysis-usage\.tsx$/},()=>before?{contents:fs.readFileSync(root+'/var/codex-frontend-team/stage4-experience-before/apps/web/components/analysis-usage.tsx','utf8'),loader:'tsx'}:undefined);b.onResolve({filter:/^next\/dynamic$/},()=>({path:'dynamic',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`import React,{lazy,Suspense} from 'react';export default loader=>{const C=lazy(()=>loader().then(defaultExport=>({default:defaultExport})));return props=>React.createElement(Suspense,{fallback:null},React.createElement(C,props));}`,loader:'js',resolveDir:root+'/apps/web'}));}}]})).outputFiles[0].text;
}
(async()=>{
  const postcss=require('./frontend-runtime.cjs').dependency('postcss');
  const tw=require('./frontend-runtime.cjs').dependency('@tailwindcss/postcss');
  const css=(await postcss([tw({base:root+'/apps/web'})]).process(fs.readFileSync(root+'/apps/web/app/globals.css','utf8')+'\n@source "'+root+'/var/codex-frontend-team/stage4-experience-before";\n',{from:root+'/apps/web/app/globals.css'})).css;
  let bundle=await build(comparisonModes[0]), fail=false, restoreFail=false, reportMode=false;
  const long='SyntheticLongText'.repeat(100);
  const report={id:1,reportKey:'final',title:'Synthetic report',content:'# Synthetic report\n\n'+long+'\n\n```json\n'+long+'\n```\n\n| A | B |\n| --- | --- |\n| '+long+' | value |',updatedAt:'2026-10-14T00:00:00Z'};
  const server=http.createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(bundle);}
    else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
    else if(req.url==='/api/paper'){assert.equal(req.method,'GET');res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({credits:100,portfolio:{id:1,name:'Synthetic',initialCashCents:10000000,cashCents:9990000,currency:'USD',status:'active',autoTradeEnabled:false},watchlist:[{id:1,ticker:'MOCK'}],positions:[{id:1,ticker:'MOCK',quantity:1,avgCostCents:10000,lastPriceCents:10000,realizedPnlCents:0}],trades:[],analysisRuns:[],defaultModel:null}));}
    if(req.url.includes('/decisions?')){assert.equal(req.method,'GET');res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({prices:[],decisions:[],source:'Synthetic',currency:'USD',timezone:'UTC'}));}
    if(req.url.startsWith('/api/market/')){assert.equal(req.method,'GET');res.setHeader('Content-Type','application/json');if(fail){res.statusCode=503;return res.end(JSON.stringify({error:raw}));}const instrument={id:1,symbol:'MOCK',exchange:'Synthetic',name:long,currency:'USD',timezone:'UTC',status:'active'};return res.end(JSON.stringify(req.url.includes('/1?')?{instrument,latestQuote:null,dailyPrices:[{tradingDate:'2026-10-14',open:'100',high:'101',low:'99',close:'100',volume:'100',source:'Synthetic',adjusted:false,fetchedAt:'2026-10-14T00:00:00Z'}],sync:[]}:{instruments:[instrument],nextCursor:null}));}
    if(req.url.startsWith('/api/')){if(req.method==='POST'){assert.equal(req.url,'/api/analysis/jobs/84/restore');res.setHeader('Content-Type','application/json');res.statusCode=restoreFail?503:200;res.end(JSON.stringify(restoreFail?{error:raw}:{ok:true}));return;}assert.equal(req.method,'GET');res.setHeader('Content-Type','application/json');if(fail){res.statusCode=503;res.end(JSON.stringify({error:raw}));return;}res.end(JSON.stringify(req.url==='/api/analysis/jobs/deleted'?{jobs:[{id:84,ticker:'MOCK',tradeDate:'2026-10-14',status:'completed',hiddenAt:'2026-10-14T00:00:00Z'}]}:req.url==='/api/analysis/jobs'?{credits:100,models:[],jobs:[job]}:{job,reports:reportMode?[report]:[],report:reportMode?report:undefined,calls:[]}));}
    else res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=spawn(require('./frontend-runtime.cjs').chromium(),['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+fs.mkdtempSync(dir+'/browser-profile-'),'about:blank'],{stdio:['ignore','ignore','pipe']});
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
    const results=[];
    for(const before of comparisonModes){
      bundle=await build(before);
      for(const [width,height] of [[390,844],[768,1024],[1440,900],[1920,1080],[2560,1440]]){
        await c('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});
        await c('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await pause();
        for(const [name,render] of [['portfolio','showPortfolio'],['stocks','showStocks'],['stock-detail','showStockDetail']]){
          await evaluate(`window.${render}()`);await pause();
          const text=await evaluate('document.body.innerText');assert(text.includes(name==='portfolio'?'Paper Portfolio':name==='stocks'?'Stock':'Stock details'),JSON.stringify({name,width,text,errors}));
          const dimensions=await evaluate('({pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,tableScroll:!!Array.from(document.querySelectorAll("table")).find(t=>t.parentElement.scrollWidth>t.parentElement.clientWidth)})');
          if(!before)assert(dimensions.pageWidth<=width+1,JSON.stringify({name,width,...dimensions}));
          const shot=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(`${dir}/${before?'before':'after'}-${name}-${width}.png`,Buffer.from(shot.data,'base64'));results.push({name,before,width,height,...dimensions});
        }
      }
    }
    fail=true;await evaluate('window.showStocks()');await pause();await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Refresh stocks').click()`);await pause();assert(await evaluate(`document.body.innerText.includes('Retry')`));assert(!/Traceback|synthetic-secret/.test(await evaluate('document.body.innerText')));
    const shot=await c('Page.captureScreenshot',{format:'png'});fs.writeFileSync(dir+'/after-stocks-retry.png',Buffer.from(shot.data,'base64'));
    fail=false;await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry').click()`);await pause();assert(!await evaluate(`document.body.innerText.includes('Unable to Complete Request')`));
    assert.deepEqual(errors,[]);fs.writeFileSync(dir+'/browser-results.json',JSON.stringify({status:'passed',results,consoleErrors:errors,mockGETOnly:true,safeStockFailureRetry:true},null,2));console.log('PASS Phase4 portfolio, stocks, stock details five viewports; synthetic GET only; no page overflow or console errors.');
  }finally{if(socket)socket.close();browser.kill();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
