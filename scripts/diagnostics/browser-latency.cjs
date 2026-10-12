// Optional dependency: npm install --prefix /tmp/stockdepth-performance-tools playwright
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(root+'/apps/web/node_modules/dotenv').config({path:root+'/.env'});
const { chromium } = require(process.env.STOCKDEPTH_PLAYWRIGHT_MODULE || '/tmp/stockdepth-performance-tools/node_modules/playwright');
const sql = require(root+'/apps/web/node_modules/postgres')(process.env.POSTGRES_URL,{max:1});
(async()=>{
 let browser;
 try {
  const [user]=await sql`select u.id from users u where u.status='active' and u.deleted_at is null and exists(select 1 from analysis_jobs j where j.user_id=u.id and j.hidden_at is null) order by (u.role='member') desc,u.id limit 1`;
  const jobs=await sql`select j.id,exists(select 1 from analysis_reports r where r.job_id=j.id) as has_reports
    from analysis_jobs j where j.user_id=${user.id} and j.hidden_at is null order by j.id desc limit 20`;
  const reportIndex=jobs.findIndex(job=>job.has_reports&&(!process.env.STOCKDEPTH_DIAGNOSTIC_JOB_ID||job.id===Number(process.env.STOCKDEPTH_DIAGNOSTIC_JOB_ID)));
  if(reportIndex<0)throw Error('No report-bearing job on the first page');
  const reportJobId=jobs[reportIndex].id;
  const {SignJWT}=await import(root+'/apps/web/node_modules/jose/dist/webapi/index.js');
  const token=await new SignJWT({user:{id:user.id},expires:new Date(Date.now()+600000).toISOString()}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const base=process.env.STOCKDEPTH_DIAGNOSTIC_URL||'http://127.0.0.1:3000';
  const context=await browser.newContext();
  await context.addCookies([{name:'session',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.name));
  await page.addInitScript(()=>{window.stockdepthLongTasks=[];new PerformanceObserver(list=>{for(const entry of list.getEntries())window.stockdepthLongTasks.push(entry.duration)}).observe({type:'longtask',buffered:true});});
  const start=performance.now();
  const detail=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/analysis/jobs/${reportJobId}`&&!new URL(response.url()).searchParams.has('report')&&response.status()===200,{timeout:90000});
  const report=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/analysis/jobs/${reportJobId}`&&new URL(response.url()).searchParams.has('report')&&response.status()===200,{timeout:90000});
  await page.goto(base+'/dashboard/analysis',{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByRole('button').filter({hasText:'创建于'}).first().waitFor({timeout:90000});
  const firstJobMs=Math.round(performance.now()-start);
  if(reportIndex>0)await page.getByRole('button').filter({hasText:'创建于'}).nth(reportIndex).click();
  await (await detail).finished();
  const detailMs=Math.round(performance.now()-start);
  await (await report).finished();
  await page.waitForFunction(() => (document.querySelector('article')?.textContent?.length || 0) > 20, { timeout: 90000 });
  const reportMs=Math.round(performance.now()-start);
  const metrics=await page.evaluate(()=>{
   const nav=performance.getEntriesByType('navigation')[0];
   const resources=performance.getEntriesByType('resource');
   return {ttfbMs:Math.round(nav.responseStart-nav.requestStart),domContentLoadedMs:Math.round(nav.domContentLoadedEventEnd),firstContentfulPaintMs:Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime||0),scriptTransferBytes:resources.filter(r=>r.initiatorType==='script').reduce((sum,r)=>sum+r.transferSize,0),longTaskCount:window.stockdepthLongTasks.length,longTaskTotalMs:Math.round(window.stockdepthLongTasks.reduce((sum,d)=>sum+d,0))};
  });
  console.log(JSON.stringify({name:'browser_analysis',firstJobMs,detailReadyMs:detailMs,reportReadyMs:reportMs,reportSelectionRequired:reportIndex>0,...metrics,pageErrorTypes:errors}));
 }finally{if(browser)await browser.close();await sql.end();}
})().catch(error=>{console.error('Browser diagnostic failed:',error.name,error.message.split('\n')[0]);process.exitCode=1;});
