// Isolated schema and synthetic credentials. No model/provider calls.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from '../../apps/web/node_modules/dotenv';
import postgres from '../../apps/web/node_modules/postgres';
config({path:'.env'});
async function main() {
 const admin=postgres(process.env.POSTGRES_URL!,{max:1}),schema=`availability_test_${randomUUID().replaceAll('-','')}`;let client:ReturnType<typeof postgres>|undefined;
 try {
  await admin`create schema ${admin(schema)}`;await admin`create table ${admin(schema)}.llm_model_configs (like public.llm_model_configs including all)`;
  const url=new URL(process.env.POSTGRES_URL!);url.searchParams.set('search_path',schema);process.env.POSTGRES_URL=url.toString();
  const database=await import('../../apps/web/lib/db/drizzle');client=database.client;const {db}=database;
  assert.equal((await client`select current_schema() as name`)[0].name,schema);
  const {llmModelConfigs:models}=await import('../../apps/web/lib/db/schema');
  const {isQuotaExhausted,markModelQuotaUnavailable,recordQuotaFailures,unavailableJobModels}=await import('../../apps/web/lib/analysis/model-availability');
  const {and,eq,isNull}=await import('../../apps/web/node_modules/drizzle-orm');
  for(const msg of ['401008','insufficient_quota','HTTP 402: free trial quota for the service has been exhausted','余额不足','额度已耗尽','insufficient credits'])assert(isQuotaExhausted(msg));
  for(const msg of ['HTTP 429 rate_limit_exceeded','HTTP 500','timeout','HTTP 400 invalid request','quota per minute exceeded'])assert(!isQuotaExhausted(msg));
  const add=async(id:number,name:string)=>(await db.insert(models).values({id,name,provider:'fixture',modelName:name,baseUrl:'http://127.0.0.1:1',apiKey:'fixture-unused',isActive:true,isDefault:id===2}).returning())[0];
  const quick=await add(1,'quick'),deep=await add(2,'deep');
  const job={quickConfigSnapshot:JSON.stringify(quick),deepConfigSnapshot:JSON.stringify(deep)};
  const eventAt=new Date();
  await recordQuotaFailures(job,[{model:'deep',model_config_id:2,status:'failed',ended_at:eventAt.toISOString(),failure_reason:'quota_exhausted'},{model:'quick',model_config_id:1,status:'failed',ended_at:eventAt.toISOString()}]);
  assert.equal((await unavailableJobModels(job)).length,1);
  let rows=await db.select().from(models).orderBy(models.id);assert.equal(rows[0].unavailableReason,null);assert.equal(rows[1].unavailableReason,'quota_exhausted');assert.equal(rows[0].isDefault,true,'replacement becomes persisted default');assert.equal(rows[1].isDefault,false,'unavailable default is cleared');assert.equal(rows[1].isActive,true,'automatic state does not overwrite manual enable switch');
  assert.equal((await db.select().from(models).where(and(eq(models.isActive,true),isNull(models.retiredAt),isNull(models.unavailableReason)))).length,1);
  await db.update(models).set({unavailableReason:null,unavailableAt:null,availabilityCheckedAt:new Date(eventAt.getTime()+1000)}).where(eq(models.id,2));
  assert.equal(await markModelQuotaUnavailable(deep,eventAt),false,'old failure cannot undo a successful recovery');
  assert.equal(await markModelQuotaUnavailable(deep,new Date(eventAt.getTime()+2000)),true,'new failure blocks recovered config');
  await db.update(models).set({unavailableReason:null,unavailableAt:null,availabilityCheckedAt:null,updatedAt:new Date(deep.updatedAt.getTime()+10000),apiKey:'replacement-fixture'}).where(eq(models.id,2));
  assert.equal(await markModelQuotaUnavailable(deep),false,'failure from old config cannot disable edited credentials');
  const [current]=await db.select().from(models).where(eq(models.id,2));
  const legacyJob={quickConfigSnapshot:JSON.stringify(quick),deepConfigSnapshot:JSON.stringify(current)};
  await recordQuotaFailures(legacyJob,[{status:'failed',model:'quick',model_config_id:1,ended_at:new Date(eventAt.getTime()-1000).toISOString()},{status:'failed',model:'deep',model_config_id:2,ended_at:new Date().toISOString()}],'Analysis failed: HTTP 402 insufficient_quota');
  rows=await db.select().from(models).orderBy(models.id);assert.equal(rows[0].unavailableReason,null);assert.equal(rows[1].unavailableReason,'quota_exhausted','legacy terminal log attributed only to final failing model');
  console.log('PASS: quota classification, rate/network exclusions, exact model attribution, selection filtering, queued-job guard, config-version fencing, post-recovery stale-event fencing and legacy runner support. No model calls.');
 }finally{if(client)await client.end();await admin`drop schema if exists ${admin(schema)} cascade`;await admin.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
