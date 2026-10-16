// Isolated schema; queues synthetic jobs only. No runner or model requests.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {config} from '../../apps/web/node_modules/dotenv';
import postgres from '../../apps/web/node_modules/postgres';
config({path:'.env'});
async function main() {
 const admin=postgres(process.env.POSTGRES_URL!,{max:1}),schema=`resume_test_${randomUUID().replaceAll('-','')}`;let client:ReturnType<typeof postgres>|undefined;
 try {
  await admin`create schema ${admin(schema)}`;
  for(const table of ['analysis_jobs','analysis_job_resumptions','llm_model_configs','analysis_model_calls','analysis_reports','analysis_decisions','users'])await admin`create table ${admin(schema)}.${admin(table)} (like public.${admin(table)} including all)`;
  await admin.unsafe(`create sequence ${schema}.resume_ids; alter table ${schema}.analysis_job_resumptions alter column id set default nextval('${schema}.resume_ids')`);
  const url=new URL(process.env.POSTGRES_URL!);url.searchParams.set('search_path',schema);process.env.POSTGRES_URL=url.toString();
  process.env.STOCKDEPTH_MODEL_KEY_ID='fixture';process.env.STOCKDEPTH_MODEL_KEYRING=JSON.stringify({fixture:randomBytes(32).toString('base64url')});
  const {db,client:connection}=await import('../../apps/web/lib/db/drizzle');client=connection;
  assert.equal((await client`select current_schema() as name`)[0].name,schema);
  const {analysisJobs:jobs,analysisJobResumptions:history,llmModelConfigs:models,analysisModelCalls:calls,analysisReports:reports,users}=await import('../../apps/web/lib/db/schema');
  const {resumeAnalysisJob}=await import('../../apps/web/lib/analysis/resume-job');
  const {immutableModelSnapshot}=await import('../../apps/web/lib/analysis/model-snapshot');
  const {decryptModelKey}=await import('../../apps/web/lib/security/model-key');
  const {publicAnalysisJob}=await import('../../apps/web/lib/analysis/public-job');
  const {eq}=await import('../../apps/web/node_modules/drizzle-orm');
  await db.insert(users).values({id:1,email:'fixture@example.test',passwordHash:'fixture',analysisCredits:100});
  const addModel=async(id:number,options:object={})=>(await db.insert(models).values({id,name:`Model ${id}`,provider:'fixture',baseUrl:'http://127.0.0.1:1',apiKey:`synthetic-key-${id}`,modelName:`fixture-${id}`,...options}).returning())[0];
  const old=await addModel(1,{unavailableReason:'quota_exhausted'}),quick=await addModel(2),deep=await addModel(3),disabled=await addModel(4,{isActive:false}),wrongRole=await addModel(5,{deepEnabled:false}),retired=await addModel(6,{retiredAt:new Date()});
  let id=10;
  const addJob=async(status='failed',hidden=false)=> (await db.insert(jobs).values({id:id++,userId:1,runId:randomUUID(),ticker:'MOCK',tradeDate:'2026-10-15',analysts:'[]',status,hiddenAt:hidden?new Date():null,quickModel:old.modelName,deepModel:old.modelName,quickConfigSnapshot:immutableModelSnapshot(old),deepConfigSnapshot:immutableModelSnapshot(old),startedAt:new Date('2026-10-14T00:00:00Z'),totalTokens:123,inputTokens:100,outputTokens:23}).returning())[0];
  const job=await addJob();
  await db.insert(calls).values({id:1,jobId:job.id,callId:randomUUID(),agent:'Market',model:old.modelName,modelConfigId:1,startedAt:new Date(),status:'complete',totalTokens:123,estimatedCost:'0.5'});
  await db.insert(reports).values({id:1,jobId:job.id,userId:1,reportKey:'market',title:'Completed market report',content:'KEEP THIS REPORT'});
  assert.equal((await resumeAnalysisJob(1,job.id)).status,409,'original quota-blocked models cannot retry');
  assert.equal((await resumeAnalysisJob(2,job.id,{quickModelConfigId:2,deepModelConfigId:3})).status,409,'ownership enforced');
  for(const candidate of [old,disabled,wrongRole,retired])assert.equal((await resumeAnalysisJob(1,job.id,{quickModelConfigId:2,deepModelConfigId:candidate.id})).status,400);
  assert.equal((await db.select().from(history)).length,0);
  const selection={quickModelConfigId:2,deepModelConfigId:3};
  const concurrent=await Promise.all([resumeAnalysisJob(1,job.id,selection),resumeAnalysisJob(1,job.id,selection)]);
  assert.equal(concurrent.filter(r=>r.status===200).length,1,'single atomic continuation');
  const [resumed]=await db.select().from(jobs).where(eq(jobs.id,job.id));
  assert.equal(resumed.runId,job.runId,'checkpoint identity preserved');assert.equal(resumed.status,'queued');assert.equal(resumed.externalStatus,'resume-queued');
  assert.equal(resumed.startedAt?.getTime(),job.startedAt?.getTime());assert.equal(resumed.totalTokens,123);assert.equal(resumed.quickModelConfigId,2);assert.equal(resumed.deepModelConfigId,3);
  assert.equal(JSON.parse(resumed.deepConfigSnapshot!).modelName,deep.modelName);assert.equal(decryptModelKey(JSON.parse(resumed.deepConfigSnapshot!).apiKey),deep.apiKey);
  const [audit]=await db.select().from(history);assert.equal(audit.previousDeepModel,old.modelName);assert.equal(audit.nextDeepModel,deep.modelName);
  assert(JSON.parse(audit.previousDeepConfigSnapshot!).apiKey.startsWith('sdkey:'));assert(JSON.parse(audit.nextDeepConfigSnapshot).apiKey.startsWith('sdkey:'));
  assert.equal((await db.select().from(calls))[0].estimatedCost,'0.500000000000');assert.equal((await db.select().from(calls))[0].modelConfigId,1);assert.equal((await db.select().from(reports))[0].content,'KEEP THIS REPORT');assert.equal((await db.select().from(users))[0].analysisCredits,100);
  assert(!JSON.stringify(publicAnalysisJob(resumed)).includes('sdkey:'));
  const active=await addJob('running'),hidden=await addJob('failed',true);assert.equal((await resumeAnalysisJob(1,active.id,selection)).status,409);assert.equal((await resumeAnalysisJob(1,hidden.id,selection)).status,409);
  const rollback=await addJob();await db.update(jobs).set({quickConfigSnapshot:'invalid-json'}).where(eq(jobs.id,rollback.id));
  await assert.rejects(resumeAnalysisJob(1,rollback.id,selection));assert.equal((await db.select().from(history)).length,1);assert.equal((await db.select().from(jobs).where(eq(jobs.id,rollback.id)))[0].status,'failed','audit and snapshot update roll back together');
  const automatic=await addJob('running');
  await db.update(jobs).set({workerOwner:'automatic-owner',workerLeaseUntil:new Date(Date.now()+60000)}).where(eq(jobs.id,automatic.id));
  assert.equal((await resumeAnalysisJob(1,automatic.id,undefined,'wrong-owner')).status,409);
  const retried=await resumeAnalysisJob(1,automatic.id,undefined,'automatic-owner');
  assert.equal(retried.status,200);
  if('job' in retried){assert.equal(retried.job.runId,automatic.runId);assert.equal(retried.job.status,'queued');assert.equal(retried.job.quickModelConfigId,2);assert.equal(retried.job.deepModelConfigId,2);assert.equal(retried.job.totalTokens,123);}
  assert.equal((await db.select().from(models).where(eq(models.id,2)))[0].isDefault,true);
  // Duplicate worker callbacks cannot enqueue two retries or duplicate history.
  assert.equal((await resumeAnalysisJob(1,automatic.id,undefined,'automatic-owner')).status,409);
  const blocked=await addJob('running');
  await db.update(jobs).set({workerOwner:'budget-owner',workerLeaseUntil:new Date(Date.now()+60000)}).where(eq(jobs.id,blocked.id));
  const [sample]=await db.select().from(history).where(eq(history.jobId,automatic.id));
  for(let i=0;i<3;i++){const {id,...copy}=sample;await db.insert(history).values({...copy,jobId:blocked.id});}
  assert.equal((await resumeAnalysisJob(1,blocked.id,undefined,'budget-owner')).status,422,'replacement history bounds retries');
  // Exercise the real Worker loop: quota evidence must trigger replacement
  // even while the runner says running and report versions disagree.
  const {createServer}=await import('node:http');
  const [currentQuick]=await db.select().from(models).where(eq(models.id,2));
  const [currentDeep]=await db.select().from(models).where(eq(models.id,3));
  const live=await addJob('running');
  const [owned]=await db.update(jobs).set({workerOwner:'live-owner',workerLeaseUntil:new Date(Date.now()+60000),quickModelConfigId:2,deepModelConfigId:3,quickModel:currentQuick.modelName,deepModel:currentDeep.modelName,quickConfigSnapshot:immutableModelSnapshot(currentQuick),deepConfigSnapshot:immutableModelSnapshot(currentDeep)}).where(eq(jobs.id,live.id)).returning();
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({status:'running',report_version:req.url?.startsWith('/api/run/status')?'v1':'v2',reports:[{key:'market',title:'Saved research',content:'KEEP AUTOMATIC REPORT'}],usage:{history_complete:true,calls:[{call_id:'quota-fixture',agent:'Bull Researcher',model:currentQuick.modelName,model_config_id:2,role:'quick',status:'failed',failure_reason:'quota_exhausted',started_at:new Date().toISOString(),ended_at:new Date().toISOString()}]}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.STOCKDEPTH_API_URL=`http://127.0.0.1:${(server.address() as any).port}`;
  process.env.ANALYSIS_WORKER_MOCK='false';
  try {
    const {processJob}=await import('../../apps/workers/src/analysis-worker');
    await processJob(owned,{startRun:false});
    const [result]=await db.select().from(jobs).where(eq(jobs.id,live.id));
    assert.equal(result.status,'queued');assert.equal(result.externalStatus,'resume-queued');assert.equal(result.quickModelConfigId,3);assert.equal(result.deepModelConfigId,3);assert.equal(result.runId,live.runId);
    const [disabledQuick]=await db.select().from(models).where(eq(models.id,2));const [newDefault]=await db.select().from(models).where(eq(models.id,3));
    assert.equal(disabledQuick.unavailableReason,'quota_exhausted');assert.equal(disabledQuick.isDefault,false);assert.equal(newDefault.isDefault,true);
    assert.equal((await db.select().from(reports).where(eq(reports.jobId,live.id)))[0].content,'KEEP AUTOMATIC REPORT');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  await db.update(models).set({isActive:false}).where(eq(models.isActive,true));
  const none=await addJob('running');await db.update(jobs).set({workerOwner:'none-owner',workerLeaseUntil:new Date(Date.now()+60000)}).where(eq(jobs.id,none.id));
  assert.equal((await resumeAnalysisJob(1,none.id,undefined,'none-owner')).status,503,'no candidates stops instead of looping');
  assert.equal((await db.select().from(users).where(eq(users.id,1)))[0].analysisCredits,100,'automatic retry never charges analysis credits again');
  console.log('PASS: atomic model replacement, checkpoint identity, original reports/tokens/costs/credits, encrypted audit history, ownership, role/disabled/quota/retired rejection, duplicate submissions, rollback and public credential filtering. No model calls.');
 }finally{if(client)await client.end();await admin`drop schema if exists ${admin(schema)} cascade`;await admin.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
