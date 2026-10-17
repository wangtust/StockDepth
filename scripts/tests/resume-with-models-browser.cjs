// Real page; successful continuation POST intercepted. No real job is resumed.
const assert=require('node:assert/strict'),path=require('node:path');const modules=path.resolve(__dirname,'../../apps/web/node_modules');
require(modules+'/dotenv').config({path:path.resolve(__dirname,'../../.env'),quiet:true});
(async()=>{
 const sql=require(modules+'/postgres')(process.env.POSTGRES_URL,{max:1});let browser;
 try {
  const [user]=await sql`select id,(select b.analysis_credits from billing_accounts b where b.user_id=u.id) as analysis_credits from users u where status='active' and deleted_at is null and exists(select 1 from analysis_jobs j where j.user_id=u.id and j.status='failed' and j.hidden_at is null) order by id limit 1`;
  assert(user,'needs an account with a failed job');
  const {SignJWT}=await import(modules+'/jose/dist/webapi/index.js');const token=await new SignJWT({user:{id:user.id},expires:new Date(Date.now()+120000).toISOString()}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('2m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const base='http://127.0.0.1:3000',headers={cookie:`session=${token}`};
  const payload=await (await fetch(base+'/api/analysis/jobs',{headers})).json(),job=payload.jobs.find(j=>j.status==='failed');assert(job);
  assert(payload.models.some(m=>m.quickEnabled)&&payload.models.some(m=>m.deepEnabled));
  const rejected=await fetch(`${base}/api/analysis/jobs/${job.id}/retry`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({quickModelConfigId:2147483647,deepModelConfigId:2147483647})});assert.equal(rejected.status,400);
  const [before]=await sql`select count(*)::int as count from analysis_job_resumptions where job_id=${job.id}`;
  const {chromium}=require(modules+'/playwright');browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:'session',value:token,url:base}]);let posted;
  await page.route(`**/api/analysis/jobs/${job.id}/retry`,route=>{posted=route.request().postDataJSON();return route.fulfill({json:{job:{id:job.id,status:'queued'}}});});
  await page.route(new RegExp(`/api/analysis/jobs/${job.id}$`),async route=>{const res=await route.fetch();const data=await res.json();assert(!JSON.stringify(data).includes('sdkey:'));data.resumptions=[{id:999,previousQuickModel:'old-quick',previousDeepModel:'old-deep',nextQuickModel:'new-quick',nextDeepModel:'new-deep',createdAt:new Date().toISOString()}];return route.fulfill({json:data});});
  await page.goto(base+'/dashboard/analysis');await page.locator(`#job-menu-trigger-${job.id}`).waitFor();
  await page.locator(`#job-menu-trigger-${job.id}`).locator('..').locator('button[aria-pressed]').click();
  await page.getByText('Change models and continue',{exact:true}).click();
  const quick=page.getByLabel('Quick model for continuation',{exact:true}),deep=page.getByLabel('Deep model for continuation',{exact:true});await quick.waitFor();
  assert.equal(await quick.locator('option').count(),payload.models.filter(m=>m.quickEnabled).length);
  assert.equal(await deep.locator('option').count(),payload.models.filter(m=>m.deepEnabled).length);
  const selection={quickModelConfigId:Number(await quick.inputValue()),deepModelConfigId:Number(await deep.inputValue())};
  await page.getByRole('button',{name:'Confirm and continue',exact:true}).click();await page.waitForFunction(() => !Array.from(document.querySelectorAll('details')).find(el => el.querySelector('summary')?.textContent === 'Change models and continue')?.open);assert.deepEqual(posted,selection);assert.equal(await page.getByText('已更换模型并请求继续，历史报告和用量记录已保留。',{exact:true}).count(),0);
  await page.getByText('Model replacement history (1)',{exact:true}).click();await page.getByText(/Quick: old-quick → new-quick/).waitFor();assert.deepEqual(errors,[]);
  assert.equal((await sql`select status from analysis_jobs where id=${job.id}`)[0].status,'failed');assert.equal((await sql`select count(*)::int as count from analysis_job_resumptions where job_id=${job.id}`)[0].count,before.count);assert.equal((await sql`select analysis_credits from billing_accounts where user_id=${user.id}`)[0].analysis_credits,user.analysis_credits);
  console.log('PASS: live failed-job UI, available role selectors, replacement payload, confirmation, history rendering, server rejects invalid models. Real continuation intercepted; no model calls or account charges.');
 }finally{if(browser)await browser.close();await sql.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
