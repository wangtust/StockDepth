import {spawn} from 'node:child_process';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {db,client} from '../../apps/web/lib/db/drizzle';
import {users,analysisJobs,analysisReports,activityLogs} from '../../apps/web/lib/db/schema';
import {setJobVisibility,listSharedJobs,getSharedJob,sanitizeSharedReport} from '../../apps/web/lib/analysis/shared-jobs';
import {eq} from '../../apps/web/node_modules/drizzle-orm';
async function main(){
 assert(String((await client`select current_database() name`)[0].name).startsWith('stockdepth_regression_'));
 assert.equal(sanitizeSharedReport('api_key=supersecret /home/ubuntu/private Bearer abcdef'), 'api_key=[redacted] [internal path] Bearer [redacted]');
 const [a,b]=await db.insert(users).values([{email:'secret-a@example.test',passwordHash:'secret'},{email:'secret-b@example.test',passwordHash:'secret'}]).returning();
 const add=async(status='complete')=>(await db.insert(analysisJobs).values({runId:randomUUID(),userId:a.id,ticker:'MOCK',tradeDate:'2026-11-08',analysts:'[]',status,errorMessage:'secret error',externalPid:123,workerOwner:'secret owner'}).returning())[0];
 const first=await add(),second=await add(),failed=await add('failed');
 assert.equal(first.visibility,'private');assert.notEqual(first.publicId,second.publicId);
 assert.equal(await getSharedJob(first.publicId),null);
 assert.equal((await setJobVisibility(b.id,first.id,'public')).status,404);
 assert.equal((await setJobVisibility(a.id,failed.id,'public')).status,409);
 await db.insert(analysisReports).values(['market','decision','execution','progress','unknown'].map(reportKey=>({jobId:first.id,userId:a.id,reportKey,title:reportKey,content:reportKey==='market'?'Saved final research':'fixture'})));
 await setJobVisibility(a.id,first.id,'public');await setJobVisibility(a.id,first.id,'public');
 assert.equal((await db.select().from(activityLogs)).length,1,'idempotent audit');
 const shared=(await getSharedJob(first.publicId))!;assert.deepEqual(shared.reports.map(r=>r.reportKey),['market','decision']);
 assert.deepEqual(Object.keys(shared.job).sort(),['publicId','ticker','tradeDate','language','depth','completedAt','publishedAt'].sort());
 assert(!JSON.stringify(shared).includes('secret'));assert.equal(shared.reports[0].content,'Saved final research');
 await setJobVisibility(a.id,second.id,'public');
 const page=await listSharedJobs({limit:1});assert.equal(page.jobs.length,1);assert(page.nextCursor);
 const next=await listSharedJobs({limit:1,before:page.nextCursor!});assert.equal(next.jobs.length,1);assert.notEqual(next.jobs[0].publicId,page.jobs[0].publicId);
 assert.equal((await listSharedJobs({limit:20,ticker:'OTHER'})).jobs.length,0);
 await setJobVisibility(a.id,first.id,'private');assert.equal(await getSharedJob(first.publicId),null);
 await setJobVisibility(a.id,first.id,'public');await db.update(analysisJobs).set({hiddenAt:new Date(),visibility:'private',publishedAt:null}).where(eq(analysisJobs.id,first.id));
 assert.equal(await getSharedJob(first.publicId),null);await db.update(analysisJobs).set({hiddenAt:null}).where(eq(analysisJobs.id,first.id));assert.equal(await getSharedJob(first.publicId),null,'restoring does not republish');
 await db.update(users).set({status:'inactive'}).where(eq(users.id,a.id));assert.equal(await getSharedJob(second.publicId),null);assert.equal((await listSharedJobs({limit:20})).jobs.length,0);
 // Exercise real Next handlers and browser against this disposable database.
 await db.update(users).set({status:'active'}).where(eq(users.id,a.id));
 const web=path.resolve('apps/web');
 const productionDist=process.env.SHARING_TEST_DIST||process.env.STOCKDEPTH_NEXT_DIST_DIR||'.next-sharing-release';
 const production=existsSync(path.join(web,productionDist,'BUILD_ID'));
 const server=spawn(process.execPath,[path.join(web,'node_modules/next/dist/bin/next'),production?'start':'dev','--port','3108','--hostname','127.0.0.1'],{cwd:web,env:{...process.env,AUTH_SECRET:'sharing-test-secret-only',BASE_URL:'http://127.0.0.1:3108',STOCKDEPTH_NEXT_DIST_DIR:production?productionDist:'.next-sharing-test'},stdio:'ignore',detached:true});
 const base='http://127.0.0.1:3108';
 try {
   let ready=false;for(let i=0;i<90;i++){try{await fetch(base+'/api/public/jobs',{signal:AbortSignal.timeout(2000)});ready=true;break;}catch{}await new Promise(r=>setTimeout(r,1000));}assert(ready,'isolated Next server ready');
   const {SignJWT}=await import('../../apps/web/node_modules/jose/dist/webapi/index.js');
   const token=async(id:number)=>new SignJWT({user:{id},expires:new Date(Date.now()+3600000).toISOString()}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode('sharing-test-secret-only'));
   const owner=await token(a.id),other=await token(b.id);
   const change=(id:number,visibility:string,cookie?:string)=>fetch(`${base}/api/analysis/jobs/${id}/visibility`,{method:'PATCH',headers:{'Content-Type':'application/json',...cookie?{Cookie:'session='+cookie}:{}},body:JSON.stringify({visibility})});
   assert.equal((await change(first.id,'public')).status,401);
   assert.equal((await change(first.id,'public',other)).status,404);
   assert.equal((await change(failed.id,'public',owner)).status,409);
   assert.equal((await change(first.id,'invalid',owner)).status,400);
   // Next reconstructs its internal URL as localhost even when users access an IP or domain.
   const {request:rawRequest}=await import('node:http');
   const ipResult=await new Promise<number>((resolve,reject)=>{const req=rawRequest(`${base}/api/analysis/jobs/${first.id}/visibility`,{method:'PATCH',headers:{Cookie:'session='+owner,'Content-Type':'application/json',Host:'192.0.2.42:3000',Origin:'http://192.0.2.42:3000'}},res=>{res.resume();resolve(res.statusCode!)});req.on('error',reject);req.end(JSON.stringify({visibility:'public'}));});
   assert.equal(ipResult,200,'same incoming host works without matching BASE_URL');
   assert.equal((await fetch(`${base}/api/analysis/jobs/${first.id}/visibility`,{method:'PATCH',headers:{Cookie:'session='+owner,'Content-Type':'application/json',Origin:'https://untrusted.example'},body:JSON.stringify({visibility:'public'})})).status,403);
   assert.equal((await change(first.id,'public',owner)).status,200);
   assert.equal((await fetch(base+'/api/public/jobs?limit=999')).status,400);
   assert.equal((await fetch(base+'/api/public/jobs/not-a-uuid')).status,404);
   let response=await fetch(`${base}/api/public/jobs/${first.publicId}`);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert(!JSON.stringify(await response.json()).includes('secret'));
   const {chromium}=await import('../../apps/web/node_modules/playwright/index.mjs');
   const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
   try {const page=await browser.newPage();page.setDefaultNavigationTimeout(90000);await page.goto(base+'/public/jobs');await page.getByRole('heading',{name:'Public analyses',exact:true}).waitFor();await page.goto(`${base}/public/jobs/${first.publicId}`);await page.getByText('Saved final research',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'execution',exact:true}).count(),0);
   await page.context().addCookies([{name:'session',value:owner,url:base}]);
   let dialogs=0;page.on('dialog',dialog=>{dialogs++;void dialog.dismiss();});
   await page.goto(base+'/dashboard/analysis');
   const card=page.locator('button[aria-pressed]').nth(1);
   await card.getByText('Public',{exact:true}).waitFor();
   await page.getByRole('button',{name:'MOCK job actions',exact:true}).nth(0).click();
   assert.equal(await page.getByRole('menuitem',{name:'Make public',exact:true}).getAttribute('aria-disabled'),'true','incomplete jobs cannot publish');
   await page.keyboard.press('Escape');
   // Change an unselected card from its own menu; no confirmation dialogs.
   await page.getByRole('button',{name:'MOCK job actions',exact:true}).nth(1).click();
   await page.getByRole('menuitem',{name:'Make private',exact:true}).click();
   await card.getByText('Private',{exact:true}).waitFor();
   await page.getByRole('button',{name:'MOCK job actions',exact:true}).nth(1).click();
   await page.getByRole('menuitem',{name:'Make public',exact:true}).click();
   await card.getByText('Public',{exact:true}).waitFor();
   assert.equal(dialogs,0,'visibility changes never ask for confirmation');
   await page.getByRole('button',{name:'MOCK job actions',exact:true}).nth(1).click();
   await page.getByRole('menuitem',{name:'View public page',exact:true}).waitFor();
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
   await page.getByRole('menuitem',{name:'Copy link',exact:true}).click();
   await page.getByText('Clipboard unavailable. Use View public page to open and copy the sharing URL.',{exact:true}).waitFor();
   await page.reload();await page.locator('button[aria-pressed]').nth(1).getByText('Public',{exact:true}).waitFor();

   }finally{await browser.close();}
   assert.equal((await change(first.id,'private',owner)).status,200);assert.equal((await fetch(`${base}/api/public/jobs/${first.publicId}`)).status,404);
   assert.equal((await change(first.id,'public',owner)).status,200);
   assert.equal((await fetch(`${base}/api/analysis/jobs/${first.id}`,{method:'DELETE',headers:{Cookie:'session='+owner}})).status,200);
   await fetch(`${base}/api/analysis/jobs/${first.id}/restore`,{method:'POST',headers:{Cookie:'session='+owner}});assert.equal((await fetch(`${base}/api/public/jobs/${first.publicId}`)).status,404);
   console.log('PASS isolated HTTP and browser: anonymous gallery/detail, owner UI, auth, ownership, validation, no-store, withdrawal and delete/restore');
 } finally {if(server.pid)process.kill(-server.pid,'SIGTERM');}
 console.log('PASS public sharing: private defaults, ownership, completed-only, audit, DTO allowlist, report allowlist, pagination, filters, withdrawal, hide/restore, inactive owners');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>client.end());
