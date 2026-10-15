// Local smoke test against an already unavailable config. Never invokes a model.
const assert=require('node:assert/strict'),path=require('node:path');
const modules=path.resolve(__dirname,'../../apps/web/node_modules');
require(modules+'/dotenv').config({path:path.resolve(__dirname,'../../.env'),quiet:true});
(async()=>{
 const sql=require(modules+'/postgres')(process.env.POSTGRES_URL,{max:1});let browser;
 try {
  const [model]=await sql`select id from llm_model_configs where unavailable_reason='quota_exhausted' and retired_at is null order by id limit 1`;
  assert(model,'Smoke test needs an unavailable model');
  const [user]=await sql`select id,analysis_credits from users where role in ('admin','super_admin') and deleted_at is null and status='active' order by id limit 1`;
  const {SignJWT}=await import(modules+'/jose/dist/webapi/index.js');
  const token=await new SignJWT({user:{id:user.id},expires:new Date(Date.now()+120000).toISOString()}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('2m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const base='http://127.0.0.1:3000',headers={cookie:`session=${token}`};
  const list=await (await fetch(base+'/api/analysis/jobs',{headers})).json();assert(!list.models.some(m=>m.id===model.id));
  const [before]=await sql`select count(*)::int as count from analysis_jobs`;
  const blocked=await fetch(base+'/api/analysis/jobs',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({ticker:'ORCL',depth:1,modelConfigId:model.id})});
  assert.equal(blocked.status,400);
  assert.equal((await sql`select count(*)::int as count from analysis_jobs`)[0].count,before.count);
  assert.equal((await sql`select analysis_credits from users where id=${user.id}`)[0].analysis_credits,user.analysis_credits);
  const {chromium}=require(modules+'/playwright');
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.context().addCookies([{name:'session',value:token,url:base}]);
  await page.goto(base+'/admin/models');
  await page.getByText('额度不足 · 不可用',{exact:true}).first().waitFor();
  await page.locator(`button[aria-controls="model-config-content-${model.id}"]`).click();
  await page.locator(`#model-config-content-${model.id}`).getByRole('button',{name:'测试并恢复',exact:true}).waitFor();
  await page.goto(base+'/dashboard/analysis');await page.locator('#analysis-deep-model').waitFor();
  assert.equal(await page.locator(`#analysis-deep-model option[value="${model.id}"]`).count(),0);
  assert.equal(await page.locator(`#analysis-quick-model option[value="${model.id}"]`).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: live admin quota badge and recovery entry, model excluded from API and selectors, blocked submissions create no job or charge. No model calls.');
 }finally{if(browser)await browser.close();await sql.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
