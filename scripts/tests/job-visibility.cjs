const path = require('node:path');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const base = path.resolve(__dirname, '../../apps/web/node_modules');
require(path.join(base, 'dotenv')).config({path:path.resolve(__dirname,'../../.env')});
const postgres = require(path.join(base,'postgres'));
(async () => {
 const {SignJWT}=await import(path.join(base,'jose/dist/webapi/index.js'));
 const db=postgres(process.env.POSTGRES_URL);
 let id;
 try {
  const actors=await db`select id,role from users where status='active' and deleted_at is null`;
  const regular=actors.filter(u=>!['admin','super_admin'].includes(u.role));
  const admin=actors.find(u=>['admin','super_admin'].includes(u.role));
  assert(regular.length>=2 && admin,'Need two existing users and one admin');
  async function token(user){return new SignJWT({user:{id:user.id},expires:new Date(Date.now()+3600000).toISOString()}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.AUTH_SECRET));}
  const [ownerCookie,otherCookie,adminCookie]=await Promise.all([token(regular[0]),token(regular[1]),token(admin)]);
  const [job]=await db`insert into analysis_jobs(user_id,run_id,ticker,trade_date,analysts,status) values(${regular[0].id},${'visibility-test-'+randomUUID()},'VISIBILITYTEST','2026-10-12','[]','failed') returning id`;
  id=job.id;
  await db`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${id},${regular[0].id},'market','Visibility test','preserved-test-report')`;
  async function request(url,cookie,method='GET'){return fetch('http://127.0.0.1:3000'+url,{method,headers:cookie?{Cookie:'session='+cookie}:{},redirect:'manual'});}
  assert.equal((await request('/api/analysis/jobs/'+id,otherCookie,'DELETE')).status,404);
  assert.equal((await request('/api/analysis/jobs/'+id,ownerCookie)).status,200);
  assert.equal((await request('/api/analysis/jobs/'+id,ownerCookie,'DELETE')).status,200);
  assert.equal((await request('/api/analysis/jobs/'+id,ownerCookie,'DELETE')).status,200);
  const jobs=await (await request('/api/analysis/jobs',ownerCookie)).json();
  assert(!jobs.jobs.some(j=>j.id===id));
  assert.equal((await request('/api/analysis/jobs/'+id,ownerCookie)).status,404);
  assert.equal((await request('/api/analysis/jobs/'+id+'/retry',ownerCookie,'POST')).status,409);
  const [saved]=await db`select hidden_at,status from analysis_jobs where id=${id}`;
  assert(saved.hidden_at);assert.equal(saved.status,'failed');
  const reports=await db`select content from analysis_reports where job_id=${id}`;
  assert.equal(reports[0].content,'preserved-test-report');
  const list=await request('/admin/jobs?q=VISIBILITYTEST',adminCookie);
  assert.equal(list.status,200);assert((await list.text()).includes('用户已删除'));
  const detail=await request('/admin/jobs/'+id,adminCookie);
  assert.equal(detail.status,200);assert(!(await detail.text()).includes('preserved-test-report'));
  const adminReport=await request(`/api/admin/jobs/${id}/details?report=market`,adminCookie);
  assert.equal(adminReport.status,200);assert.equal((await adminReport.json()).report.content,'preserved-test-report');
  assert.equal((await request(`/api/admin/jobs/${id}/details`,ownerCookie)).status,403);
  assert.equal((await request(`/api/analysis/jobs/${id}?report=market`,ownerCookie)).status,404);
  assert.equal((await request(`/api/analysis/jobs/${id}?report=market`,otherCookie)).status,404);
  const deleted=await (await request('/api/analysis/jobs/deleted',ownerCookie)).json();
  assert(deleted.jobs.some(j=>j.id===id));
  const others=await (await request('/api/analysis/jobs/deleted',otherCookie)).json();
  assert(!others.jobs.some(j=>j.id===id));
  assert.equal((await request('/api/analysis/jobs/'+id+'/restore',otherCookie,'POST')).status,404);
  assert.equal((await request('/api/analysis/jobs/'+id+'/restore',ownerCookie,'POST')).status,200);
  assert.equal((await request('/api/analysis/jobs/'+id+'/restore',ownerCookie,'POST')).status,200);
  const restored=await (await request('/api/analysis/jobs/'+id,ownerCookie)).json();
  assert.equal(restored.job.status,'failed');
  assert.equal(restored.job.hiddenAt,null);
  assert.equal(restored.reports[0].content,undefined);
  const restoredReport=await request(`/api/analysis/jobs/${id}?report=market`,ownerCookie);
  assert.equal(restoredReport.status,200);assert.equal((await restoredReport.json()).report.content,'preserved-test-report');
  assert.equal((await request(`/api/analysis/jobs/${id}?report=market`,otherCookie)).status,404);
  assert.equal((await request('/api/analysis/jobs?before=bad',ownerCookie)).status,400);
  const remaining=await (await request('/api/analysis/jobs/deleted',ownerCookie)).json();
  assert(!remaining.jobs.some(j=>j.id===id));
  const visible=await (await request('/api/analysis/jobs',ownerCookie)).json();
  assert(visible.jobs.some(j=>j.id===id));
  console.log('PASS: ownership, idempotent soft delete, hidden list/detail/retry, retained reports, admin list/detail, deleted list, restore ownership/idempotency/state');
 } finally {
  if(id){await db`delete from analysis_reports where job_id=${id}`;await db`delete from analysis_jobs where id=${id}`;}
  await db.end();
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
