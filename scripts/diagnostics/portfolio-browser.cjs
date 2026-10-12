// Read-only deployed browser/permission regression. No model or trade actions.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(root+'/apps/web/node_modules/dotenv').config({path:root+'/.env'});
const { chromium } = require('/tmp/stockdepth-performance-tools/node_modules/playwright');
const db = require(root+'/apps/web/node_modules/postgres')(process.env.POSTGRES_URL,{max:1});
(async()=>{
 let browser;
 try {
  const actors=await db`select id,role from users where status='active' and deleted_at is null order by id`;
  const member=actors.find(u=>u.role==='member');
  const admin=actors.find(u=>['admin','super_admin'].includes(u.role));
  assert(member&&admin);
  const {SignJWT}=await import(root+'/apps/web/node_modules/jose/dist/webapi/index.js');
  async function token(user){return new SignJWT({user:{id:user.id},expires:new Date(Date.now()+600000).toISOString()}).setProtectedHeader({alg:'HS256'}).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));}
  const base='http://127.0.0.1:3000';
  const memberToken=await token(member);
  assert.equal((await fetch(base+'/api/paper')).status,401);
  const forbidden=await fetch(base+'/admin/jobs',{headers:{cookie:'session='+memberToken},redirect:'manual'});
  assert([303,307].includes(forbidden.status)); assert(!forbidden.headers.get('location')?.startsWith('/admin/jobs'));
  browser=await chromium.launch({args:['--no-sandbox']});
  const samples=[];
  for(let i=0;i<4;i++){
   const context=await browser.newContext();
   await context.addCookies([{name:'session',value:memberToken,url:base,httpOnly:true,sameSite:'Lax'}]);
   const page=await context.newPage(); let reads=0;const errors=[];
   page.on('pageerror',e=>errors.push(e.name));
   page.on('request',r=>{assert.equal(r.method(),'GET','Only read requests allowed');if(new URL(r.url()).pathname==='/api/paper')reads++;});
   const paperResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/paper' && r.status()===200);
   const start=performance.now(); await page.goto(base+'/dashboard/portfolio',{waitUntil:'domcontentloaded'});
   const payload=await (await paperResponse).json();
   if(payload.portfolio) {
    const money=new Intl.NumberFormat('en-US',{style:'currency',currency:payload.portfolio.currency}).format(payload.portfolio.cashCents/100);
    await page.getByText(money,{exact:true}).first().waitFor();
   } else await page.waitForFunction(()=>document.body.textContent.includes('Create Portfolio') && !document.body.textContent.includes('Loading'));
   await page.getByRole('button',{name:'Refresh',exact:true}).waitFor();
   const readyMs=Math.round(performance.now()-start);
   const nav=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return {ttfbMs:Math.round(n.responseStart-n.requestStart),scriptTransferBytes:performance.getEntriesByType('resource').filter(r=>r.initiatorType==='script').reduce((s,r)=>s+r.transferSize,0)};});
   assert.equal(errors.length,0); if(i)samples.push({readyMs,reads,...nav,pageErrors:errors.length});await context.close();
  }
  const context=await browser.newContext();await context.addCookies([{name:'session',value:await token(admin),url:base,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();
  page.on('request',r=>assert.equal(r.method(),'GET'));
  await page.goto(base+'/admin/jobs?status=all&q=',{waitUntil:'domcontentloaded'});
  const older=page.getByRole('link',{name:'Older jobs',exact:true});
  if(await older.count()) {
   assert((await older.getAttribute('href')).includes('before='));await older.click();await page.waitForURL(u=>u.searchParams.has('before'));
   await page.getByRole('link',{name:'Newest',exact:true}).waitFor();
   assert(new URL(page.url()).searchParams.has('before'));
   await page.getByRole('link',{name:'Newest',exact:true}).click();await page.waitForURL(u=>!u.searchParams.has('before'));assert(!new URL(page.url()).searchParams.has('before'));
  } else assert(process.argv.includes('--baseline'),'Expected second admin page fixture');
  await page.goto(base+'/admin/jobs?status=complete&q=A',{waitUntil:'domcontentloaded'});
  for(const link of await page.getByRole('link',{name:'Older jobs',exact:true}).all()){
   const url=new URL(await link.getAttribute('href'),base);assert.equal(url.searchParams.get('status'),'complete');assert.equal(url.searchParams.get('q'),'A');
  }
  console.log(JSON.stringify({name:'portfolio_deployed_browser',samples,checks:'anonymous 401/member admin denial/GET only/no pageerror/admin Older-Newest/filter links'}));
 }finally{if(browser)await browser.close();await db.end();}
})().catch(e=>{console.error('Portfolio browser failed:',e.name,e.message.split('\n')[0],e.stack?.split('\n').find(line=>line.includes('portfolio-browser.cjs'))?.trim());process.exitCode=1;});
