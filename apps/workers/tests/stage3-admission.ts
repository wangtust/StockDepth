import { createModelFixture } from '../../../scripts/tests/model-fixture';
import { pinModelVersions } from '@/lib/analysis/model-versions';
import { billingAccounts } from '@/lib/db/schema';
import { mutateCredits } from '@/lib/credits/ledger';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { eq, sql } from 'drizzle-orm';
import { db, client } from '@/lib/db/drizzle';
import { analysisJobs, users } from '@/lib/db/schema';
import { claimAnalysis, renewAnalysis, LostOwnershipError } from '../src/analysis-ownership';
async function main() {
 const [database] = await db.execute(sql`select current_database() as name`);
 assert(String(database.name).startsWith('stockdepth_stage3_worker_'));
 const [user] = await db.insert(users).values({email:'stage3@test.invalid',passwordHash:'unused'}).returning();
 await db.transaction(tx => mutateCredits(tx, {userId:user.id, amount:100, reason:'fixture_funding', operationKey:'fixture-funding:'+user.id}));
 const settings = {systemConcurrency:10,userConcurrency:10};
 const add = async (q:string,d:string,cap:number,status='queued',trailing=false) => {
   const model = (provider:string) => createModelFixture(db, {name:'Admission '+crypto.randomUUID(),provider,
     baseUrl:'http://127.0.0.1:1/'+provider+(trailing?'/':''),apiKey:'fixture-unused',modelOptions:{request_concurrency:cap}});
   const quick=await model(q),deep=await model(d);
   return db.transaction(async tx => {
     const pins=await pinModelVersions(tx,quick,deep);
     return (await tx.insert(analysisJobs).values({userId:user.id,runId:crypto.randomUUID(),ticker:'MOCK',tradeDate:'2026-10-13',analysts:'[]',status,...pins}).returning())[0];
   });
 };
 const clear = () => db.update(analysisJobs).set({status:'complete',workerOwner:null,workerLeaseUntil:null,externalStatus:null,externalPid:null});
 // Shared endpoints and model request limits must not override administrator job limits.
 await add('a','b',1); const first = await claimAnalysis(settings); assert(first);
 await add('c','b',4);
 const start=performance.now(); const second=await claimAnalysis(settings);
 console.log(JSON.stringify({scenario:'heterogeneous-shared-deep',secondAdmitted:!!second,claimMs:performance.now()-start}));
 assert(second,'Provider capacity must not cap administrator task concurrency');
 await clear();
 await add('a','b',2);await add('c','b',2,'queued',true);
 await add('d','b',2);await add('e','f',2);
 const claimed=(await Promise.all(Array.from({length:8},()=>claimAnalysis(settings)))).filter(Boolean);
 assert.equal(claimed.length,4);assert.equal(new Set(claimed.map(j=>j!.id)).size,4);
 await clear();
 await add('a','a',2);await add('a','a',2);await add('a','a',2);
 assert(await claimAnalysis(settings));assert(await claimAnalysis(settings));assert(await claimAnalysis(settings),'All three jobs fit administrator limits');
 await clear();
 const monitoringSettings={systemConcurrency:1,userConcurrency:1};
 const live=await add('a','b',1,'running');await db.update(analysisJobs).set({externalStatus:'running',externalPid:process.pid}).where(eq(analysisJobs.id,live.id));await add('c','b',4);
 assert.equal(await claimAnalysis(monitoringSettings),null);const monitor=await claimAnalysis(monitoringSettings,true);assert(monitor && monitor.id===live.id);
 await db.update(analysisJobs).set({externalStatus:null,externalPid:null,workerLeaseUntil:sql`now()-interval '1 second'`}).where(eq(analysisJobs.id,live.id));
 const recovered=await claimAnalysis(monitoringSettings,true);assert(recovered && recovered.workerOwner!==monitor.workerOwner);await assert.rejects(renewAnalysis(monitor),LostOwnershipError);
 assert.equal(await claimAnalysis(monitoringSettings),null);
 await clear();
 let active=0,peak=0,requests=0;
 const server=createServer((_req,res)=>{active++;requests++;peak=Math.max(peak,active);setTimeout(()=>{active--;res.end('mock');},40);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const endpoint=`http://127.0.0.1:${(server.address() as any).port}`;
  for(const branches of [1,2]) {
   await clear();await add('a','b',2);await add('c','b',2);await add('d','b',2);
   const jobs=(await Promise.all(Array.from({length:4},()=>claimAnalysis(settings)))).filter(Boolean);
   assert.equal(jobs.length,3);peak=0;requests=0;const started=performance.now();
   await Promise.all(jobs.flatMap(()=>Array.from({length:branches},async()=>{const res=await fetch(endpoint);assert.equal(await res.text(),'mock');})));
   assert.equal(requests,3*branches);assert.equal(peak,3*branches);
   console.log(JSON.stringify({scenario:'synthetic-composition-no-Python-graph',branches,admittedJobs:jobs.length,endpointRequestPeak:peak,requests,elapsedMs:performance.now()-started}));
  }
 } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 const [credits]=await db.select().from(billingAccounts);assert.equal(credits.analysisCredits,100);
 console.log('PASS administrator-only admission across shared endpoints, atomic competing claimers, external monitoring, expired lease fencing, unchanged credits');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>client.end());
