// coordinator Phase4 independent extension of admin-layout fixture: real report component, synthetic browser states, no API calls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),web=root+'/apps/web',out=root+'/var/codex-frontend-team/stage4-coordinator-evidence';
const mode=process.argv[2]||'after';
const {execFileSync}=require('node:child_process');
const actionPath='apps/web/app/admin/actions.ts';
execFileSync('git',['merge-base','--is-ancestor','7ae2378','HEAD'],{cwd:root});
const committed=execFileSync('git',['show','HEAD:'+actionPath],{cwd:root,encoding:'utf8'});
assert.equal(fs.readFileSync(root+'/'+actionPath,'utf8'),committed,'Frozen action must match HEAD');
const update=committed.split('export async function updateModelConfig(')[1].split('export async function deleteModelConfig(')[0];
assert(!/revalidateAdmin\s*\(|revalidatePath\s*\(|redirect\s*\(/.test(update));
assert(update.includes("return { success: 'Model config updated.' }"));
console.log('PASS committed dependency: HEAD contains 7ae2378; frozen action equals HEAD; updateModelConfig has no navigation/revalidation');
const esbuild=require(root+'/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild');
const http=require('node:http'),{spawn}=require('node:child_process');
(async()=>{fs.mkdirSync(out,{recursive:true});
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminReportViewer} from './app/admin/jobs/[id]/admin-report-viewer';window.fixture={state:'ready',jobId:84};const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<section className="admin-workspace"><main><AdminReportViewer jobId={window.fixture.jobId} version="fixture" reports={[{id:1,reportKey:'summary',title:'Synthetic report',content:'',relativePath:null,updatedAtLabel:'Oct 14'}]} title="Synthetic report" subtitle="Mock only" facts={[["Ticker","SYNTHETIC"]]}/></main></section>);window.render();`;
const bundle=(await esbuild.build({stdin:{contents:source,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',tsconfig:web+'/tsconfig.json',plugins:[{name:'navigation-fixtures',setup(b){if(mode==='before')b.onLoad({filter:/admin-report-viewer\.tsx$/},()=>({contents:fs.readFileSync(root+'/var/codex-frontend-team/stage4-admin-layout-before/apps/web/app/admin/jobs/[id]/admin-report-viewer.tsx','utf8'),loader:'tsx',resolveDir:web+'/app/admin/jobs/[id]'}));b.onResolve({filter:/^(next\/(link|navigation|dynamic)|swr|@\/components\/analysis-progress)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='swr'?`export default ()=>({isLoading:window.fixture.state==='loading',isValidating:window.fixture.state==='retrying',error:window.fixture.state==='error'||window.fixture.state==='retrying'?new Error('Traceback /srv/private secret'):undefined,data:window.fixture.state==='loading'?undefined:{report:{reportKey:'summary',content:window.fixture.state==='empty'?'':'# Synthetic report\\n\\n'+ ('longword'.repeat(200)+'\\n\\n'+ 'Synthetic scroll paragraph.\\n\\n'.repeat(100))+'\\n\\n\\x60\\x60\\x60text\\n'+'codeword'.repeat(300)+'\\n\\x60\\x60\\x60\\n\\n| A | B |\\n| --- | --- |\\n| '+ 'cell'.repeat(200)+' | synthetic |'}},mutate:()=>{window.fixture.state='retrying';window.render();}});`:a.path==='next/dynamic'?`import React from 'react';export default function dynamic(load){const C=React.lazy(()=>load().then(defaultExport=>({default:defaultExport})));return props=><React.Suspense fallback={<p>Loading fixture</p>}><C {...props}/></React.Suspense>;}`:a.path==='@/components/analysis-progress'?`export const AnalysisProgress=()=>null;`:`export const usePathname=()=>'/admin/jobs';`,loader:'tsx',resolveDir:web}));}}]})).outputFiles[0].text;

const postcss=require(web+'/node_modules/postcss'),tailwind=require(web+'/node_modules/@tailwindcss/postcss/dist/index.js');const css=(await postcss([tailwind({base:web})]).process(fs.readFileSync(web+'/app/globals.css','utf8'),{from:web+'/app/globals.css'})).css;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/html');res.end(req.url.endsWith('.js')?bundle:'<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style><div id="root" ></div><script src="/bundle.js"></script>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=fs.mkdtempSync(out+'/chrome-');const browser=spawn('/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',['--headless','--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});let ws;
try{const endpoint=await new Promise(resolve=>{let log='';browser.stderr.on('data',x=>{log+=x;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1])})});ws=new WebSocket(endpoint);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map(),errors=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown'||m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,sessionId}))});const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});const c=(m,p)=>call(m,p,sessionId);await c('Runtime.enable');await c('Page.enable');const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value};const pause=()=>new Promise(r=>setTimeout(r,400));await c('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});await pause();
const checks=[];
for(const [width,height] of [[390,844],[768,1024],[1440,900],[1920,1080],[2560,1440]]){
await c('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause();
const metrics=await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,report:document.querySelector('article > div').getBoundingClientRect().width,font:parseFloat(getComputedStyle(document.querySelector('article > div')).fontSize),codeScroll:document.querySelector('pre').scrollWidth,codeWidth:document.querySelector('pre').clientWidth})`);assert(metrics.scroll<=width+1,JSON.stringify(metrics));assert(metrics.report<850,JSON.stringify(metrics));assert(metrics.codeScroll>metrics.codeWidth,JSON.stringify(metrics));
const shot=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(out+'/'+mode+'-report-'+width+'.png',Buffer.from(shot.data,'base64'));checks.push({width,height,...metrics});}

const state=async name=>{await evaluate(`window.fixture.state='${name}';window.render()`);await pause();};
await state('loading');const loading=await evaluate('document.body.innerText');
await state('error');const failure=await evaluate('document.body.innerText');
const failureShot=await c('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+'/'+mode+'-failure.png',Buffer.from(failureShot.data,'base64'));
let interaction={loading,failure};
if(mode==='after'){
 assert(loading.includes('Loading report'));assert(!failure.includes('/srv/private'));assert(failure.includes('Retry'));
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry').click()`);await pause();assert(await evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Retrying')&&b.disabled)`));
 const shot=await c('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+'/'+mode+'-retry.png',Buffer.from(shot.data,'base64'));
 await state('empty');assert((await evaluate('document.body.innerText')).includes('This report has no content'));
 await state('ready');
 await evaluate(`document.body.style.minHeight='3000px';window.scrollTo(0,150);document.querySelector('article').scrollTop=100`);
 const previousArticleScroll=await evaluate('document.querySelector("article").scrollTop');assert.equal(previousArticleScroll,100);
 const previousScroll=await evaluate('window.scrollY');
 await evaluate(`const b=document.querySelector('[aria-label="Enter report fullscreen"]');b.focus({preventScroll:true});b.click()`);await pause();
 assert(await evaluate(`document.querySelector('[role="dialog"][aria-modal="true"]')!==null && document.body.style.overflow==='hidden'`));
 const fullShot=await c('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+'/after-fullscreen.png',Buffer.from(fullShot.data,'base64'));
 await evaluate(`const bs=document.querySelector('[role="dialog"]').querySelectorAll('button');bs[bs.length-1].focus();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))`);
 assert(await evaluate(`document.activeElement===document.querySelector('[aria-label="Exit report fullscreen"]:not(.fixed)')`));
 await evaluate(`document.querySelector('article').scrollTop=250;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);await pause();
 assert.equal(await evaluate('window.scrollY'),previousScroll);
 const actualArticleScroll=await evaluate('document.querySelector("article").scrollTop');fs.writeFileSync(out+'/scroll-restoration.json',JSON.stringify({expected:previousArticleScroll,actual:actualArticleScroll},null,2));const exitShot=await c('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+'/after-escape-scroll-defect.png',Buffer.from(exitShot.data,'base64'));assert.equal(actualArticleScroll,previousArticleScroll,'Report article scroll must restore after fullscreen Escape');
 assert(await evaluate(`!document.querySelector('[role="dialog"]') && document.body.style.overflow==='' && document.activeElement===document.querySelector('[aria-label="Enter report fullscreen"]')`));
 await evaluate(`window.fixture.jobId=85;window.fixture.state='loading';window.render()`);await pause();assert(!(await evaluate('document.body.innerText')).includes('longword'));
 interaction.keyboard='PASS focus trap / Escape / focus restoration / overflow restoration';interaction.switch='PASS job switch loading does not retain prior report';
}
fs.writeFileSync(out+'/'+mode+'-interactions.json',JSON.stringify(interaction,null,2));
assert.deepEqual(errors,[]);fs.writeFileSync(out+'/'+mode+'-report.json',JSON.stringify({checks,errors,scope:'Actual AdminReportViewer + dynamic MarkdownRenderer with mock SWR data, long words/code/table; no business API'},null,2));console.log('PASS five viewport real admin report/Markdown reading width, long text/code/table and zero console errors');

}finally{ws?.close();browser.kill();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
