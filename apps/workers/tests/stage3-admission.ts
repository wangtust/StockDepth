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
 const [user] = await db.insert(users).values({email:'stage3@test.invalid',passwordHash:'unused',analysisCredits:100}).returning();
 const settings = {systemConcurrency:10,userConcurrency:10};
 const snapshot = (provider:string, capacity:number, trailing=false) => JSON.stringify({provider,baseUrl:'http://127.0.0.1:1/'+provider+(trailing?'/':''),apiKey:'fixture-unused',modelOptions:{request_concurrency:capacity}});
 const add = async (q:string,d:string,cap:number,status='queued',trailing=false) => (await db.insert(analysisJobs).values({userId:user.id,runId:crypto.randomUUID(),ticker:'MOCK',tradeDate:'2026-10-13',analysts:'[]',provider:q,status,quickConfigSnapshot:snapshot(q,cap,trailing),deepConfigSnapshot:snapshot(d,cap,trailing)}).returning())[0];
 const clear = () => db.update(analysisJobs).set({status:'complete',workerOwner:null,workerLeaseUntil:null,externalStatus:null,externalPid:null});
 // Same endpoint must honor the strictest capacity of already admitted jobs.
 await add('a','b',1); const first = await claimAnalysis(settings,10); assert(first);
 await add('c','b',4);
 const start=performance.now(); const second=await claimAnalysis(settings,10);
 console.log(JSON.stringify({scenario:'heterogeneous-shared-deep',secondAdmitted:!!second,claimMs:performance.now()-start}));
 assert.equal(second,null,'Active deep endpoint capacity=1 must constrain candidate capacity=4');
 await clear();
 await add('a','b',2);await add('c','b',2,'queued',true);
 await add('d','b',2);await add('e','f',2);
 const claimed=(await Promise.all(Array.from({length:8},()=>claimAnalysis(settings,10)))).filter(Boolean);
 assert.equal(claimed.length,3);assert.equal(new Set(claimed.map(j=>j!.id)).size,3);
 await clear();
 await add('a','a',2);await add('a','a',2);await add('a','a',2);
 assert(await claimAnalysis(settings,10));assert(await claimAnalysis(settings,10));assert.equal(await claimAnalysis(settings,10),null,'Same quick/deep bucket counted once per job');
 await clear();
 const live=await add('a','b',1,'running');await db.update(analysisJobs).set({externalStatus:'running',externalPid:process.pid}).where(eq(analysisJobs.id,live.id));await add('c','b',4);
 assert.equal(await claimAnalysis(settings,10),null);const monitor=await claimAnalysis(settings,10,true);assert(monitor && monitor.id===live.id);
 await db.update(analysisJobs).set({externalStatus:null,externalPid:null,workerLeaseUntil:sql`now()-interval '1 second'`}).where(eq(analysisJobs.id,live.id));
 const recovered=await claimAnalysis(settings,10,true);assert(recovered && recovered.workerOwner!==monitor.workerOwner);await assert.rejects(renewAnalysis(monitor),LostOwnershipError);
 assert.equal(await claimAnalysis(settings,10),null);
 await clear();
 let active=0,peak=0,requests=0;
 const server=createServer((_req,res)=>{active++;requests++;peak=Math.max(peak,active);setTimeout(()=>{active--;res.end('mock');},40);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const endpoint=`http://127.0.0.1:${(server.address() as any).port}`;
  for(const branches of [1,2]) {
   await clear();await add('a','b',2);await add('c','b',2);await add('d','b',2);
   const jobs=(await Promise.all(Array.from({length:4},()=>claimAnalysis(settings,10)))).filter(Boolean);
   assert.equal(jobs.length,2);peak=0;requests=0;const started=performance.now();
   await Promise.all(jobs.flatMap(()=>Array.from({length:branches},async()=>{const res=await fetch(endpoint);assert.equal(await res.text(),'mock');})));
   assert.equal(requests,2*branches);assert.equal(peak,2*branches);
   console.log(JSON.stringify({scenario:'synthetic-composition-no-Python-graph',branches,admittedJobs:jobs.length,endpointRequestPeak:peak,requests,elapsedMs:performance.now()-started}));
  }
 } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 const [credits]=await db.select().from(users);assert.equal(credits.analysisCredits,100);
 console.log('PASS heterogeneous shared deep capacity, slash normalization, atomic competing claimers, independent vendors, same-role bucket, external monitoring, expired lease fencing, unchanged credits');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>client.end());
