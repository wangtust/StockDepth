// Isolated schema and synthetic credentials. No model/provider calls.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {config} from '../../apps/web/node_modules/dotenv';
import postgres from '../../apps/web/node_modules/postgres';
config({path:'.env'});
async function main() {
 const admin=postgres(process.env.POSTGRES_URL!,{max:1}),schema=`availability_test_${randomUUID().replaceAll('-','')}`;let client:ReturnType<typeof postgres>|undefined;
 try {
  await admin`create schema ${admin(schema)}`;
  for(const table of ['llm_model_configs','llm_model_config_versions'])await admin`create table ${admin(schema)}.${admin(table)} (like public.${admin(table)} including all)`;
  const url=new URL(process.env.POSTGRES_URL!);url.searchParams.set('search_path',schema);process.env.POSTGRES_URL=url.toString();
  Object.assign(process.env,{STOCKDEPTH_MODEL_KEY_ID:'fixture',STOCKDEPTH_MODEL_KEYRING:JSON.stringify({fixture:randomBytes(32).toString('base64url')})});
  const database=await import('../../apps/web/lib/db/drizzle');client=database.client;const {db}=database;
  assert.equal((await client`select current_schema() as name`)[0].name,schema);
  const {llmModelConfigs:models}=await import('../../apps/web/lib/db/schema');
  const {createModelFixture,updateModelFixture}=await import('./model-fixture');
  const {isQuotaExhausted,markModelQuotaUnavailable,recordQuotaFailures,unavailableJobModels}=await import('../../apps/web/lib/analysis/model-availability');
  const {and,eq,isNull}=await import('../../apps/web/node_modules/drizzle-orm');
  for(const msg of ['401008','insufficient_quota','HTTP 402: free trial quota for the service has been exhausted','余额不足','额度已耗尽','insufficient credits'])assert(isQuotaExhausted(msg));
  for(const msg of ['HTTP 429 rate_limit_exceeded','HTTP 500','timeout','HTTP 400 invalid request','quota per minute exceeded'])assert(!isQuotaExhausted(msg));
  const quick=await createModelFixture(db,{name:'quick'}),deep=await createModelFixture(db,{name:'deep',isDefault:true});
  const job={quickModelVersionId:quick.modelVersionId,deepModelVersionId:deep.modelVersionId};
  const eventAt=new Date();
  await recordQuotaFailures(job,[{model:'deep',model_config_id:deep.id,model_version_id:deep.modelVersionId,status:'failed',ended_at:eventAt.toISOString(),failure_reason:'quota_exhausted'},{model:'quick',model_config_id:quick.id,status:'failed',ended_at:eventAt.toISOString()}]);
  assert.equal((await unavailableJobModels(job)).length,1);
  let rows=await db.select().from(models).orderBy(models.id);assert.equal(rows[0].unavailableReason,null);assert.equal(rows[1].unavailableReason,'quota_exhausted');assert.equal(rows[0].isDefault,true);assert.equal(rows[1].isDefault,false);assert.equal(rows[1].isActive,true);
  assert.equal((await db.select().from(models).where(and(eq(models.isActive,true),isNull(models.retiredAt),isNull(models.unavailableReason)))).length,1);
  await db.update(models).set({unavailableReason:null,unavailableAt:null,availabilityCheckedAt:new Date(eventAt.getTime()+1000)}).where(eq(models.id,deep.id));
  assert.equal(await markModelQuotaUnavailable(deep,eventAt),false);
  assert.equal(await markModelQuotaUnavailable(deep,new Date(eventAt.getTime()+2000)),true);
  const current=await updateModelFixture(db,deep.id,{unavailableReason:null,unavailableAt:null,availabilityCheckedAt:null,apiKey:'replacement-fixture'});
  assert.equal(await markModelQuotaUnavailable(deep),false,'failure from old credentials cannot disable rotated credentials');
  const activeJob={quickModelVersionId:quick.modelVersionId,deepModelVersionId:current.modelVersionId};
  await recordQuotaFailures(activeJob,[{status:'failed',model:'quick',model_config_id:quick.id,ended_at:new Date(eventAt.getTime()-1000).toISOString()},{status:'failed',model:'deep',model_config_id:deep.id,ended_at:new Date().toISOString()}],'Analysis failed: HTTP 402 insufficient_quota');
  rows=await db.select().from(models).orderBy(models.id);assert.equal(rows[0].unavailableReason,null);assert.equal(rows[1].unavailableReason,'quota_exhausted','terminal log attributed only to final failing model');
  console.log('PASS: quota classification, exact attribution, default selection, version and recovery fencing. No model calls.');
 }finally{if(client)await client.end();await admin`drop schema if exists ${admin(schema)} cascade`;await admin.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
