// Isolated schema; admission only. No runner, provider request or user credit change.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from '../../apps/web/node_modules/dotenv';
import postgres from '../../apps/web/node_modules/postgres';
config({path:'.env'});
async function main() {
 const admin=postgres(process.env.POSTGRES_URL!,{max:1}), schema=`concurrency_test_${randomUUID().replaceAll('-','')}`;
 let client:ReturnType<typeof postgres>|undefined;
 try {
  await admin`create schema ${admin(schema)}`;
  await admin`create table ${admin(schema)}.analysis_jobs (like public.analysis_jobs including all)`;
  const url=new URL(process.env.POSTGRES_URL!);url.searchParams.set('search_path',schema);process.env.POSTGRES_URL=url.toString();
  process.env.ANALYSIS_PROVIDER_CONCURRENCY='1';process.env.ANALYSIS_WORKER_MAX_CONCURRENCY='1';
  const database=await import('../../apps/web/lib/db/drizzle');client=database.client;const {db}=database;
  assert.equal((await client`select current_schema() as name`)[0].name,schema);
  const {analysisJobs}=await import('../../apps/web/lib/db/schema');
  const {claimAnalysis,renewAnalysis,LostOwnershipError}=await import('../../apps/workers/src/analysis-ownership');
  const {eq,sql}=await import('../../apps/web/node_modules/drizzle-orm');
  let id=1;
  const snapshot=JSON.stringify({provider:'fixture',baseUrl:'http://127.0.0.1:1',modelOptions:{request_concurrency:1}});
  async function add(userId:number,status='queued') {return (await db.insert(analysisJobs).values({id:id++,userId,runId:randomUUID(),ticker:'MOCK',tradeDate:'2026-10-15',analysts:'[]',status,quickConfigSnapshot:snapshot,deepConfigSnapshot:snapshot}).returning())[0];}
  const clear=()=>db.delete(analysisJobs);
  const settings={systemConcurrency:10,userConcurrency:5};
  for(let i=0;i<6;i++)await add(1);
  const five=(await Promise.all(Array.from({length:8},()=>claimAnalysis(settings)))).filter(Boolean);
  assert.equal(five.length,5,'same endpoint admits five despite environment and model caps of one');assert.equal(new Set(five.map(j=>j!.id)).size,5);
  assert.equal(await claimAnalysis(settings),null,'sixth user task remains queued');
  assert.equal(await claimAnalysis({systemConcurrency:10,userConcurrency:2}),null,'decrease does not admit extra jobs');
  const sixth=await claimAnalysis({systemConcurrency:10,userConcurrency:6});assert(sixth,'increase applies to next claim');
  await clear();for(let i=0;i<7;i++)await add(1);for(let i=0;i<3;i++)await add(2);
  const six=(await Promise.all(Array.from({length:12},()=>claimAnalysis({systemConcurrency:6,userConcurrency:5})))).filter(Boolean);
  assert.equal(six.length,6,'atomic system limit across competing workers');assert.equal(six.filter(j=>j!.userId===1).length,5);assert.equal(six.filter(j=>j!.userId===2).length,1);
  await clear();const live=await add(1,'running');
  await db.update(analysisJobs).set({externalStatus:'running',externalPid:process.pid}).where(eq(analysisJobs.id,live.id));await add(1);
  const one={systemConcurrency:1,userConcurrency:1};
  assert.equal(await claimAnalysis(one),null,'existing runner consumes admission before monitoring recovery');
  const monitor=await claimAnalysis(one,true);assert.equal(monitor?.id,live.id);
  await db.update(analysisJobs).set({workerLeaseUntil:sql`now()-interval '1 second'`}).where(eq(analysisJobs.id,live.id));
  const recovered=await claimAnalysis(one,true);assert(recovered&&recovered.workerOwner!==monitor!.workerOwner);
  await assert.rejects(renewAnalysis(monitor!),LostOwnershipError);
  assert.equal(await claimAnalysis(one),null);
  console.log('PASS: admin-only task admission, five jobs on one endpoint, sixth queued, dynamic changes, multi-user/global limits, concurrent claims, live-runner recovery and stale-owner fencing. No model calls.');
 }finally{if(client)await client.end();await admin`drop schema if exists ${admin(schema)} cascade`;await admin.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
