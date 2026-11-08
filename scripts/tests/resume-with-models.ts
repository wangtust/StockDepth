// Isolated schema; queues synthetic jobs only. No runner or model requests.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {config} from '../../apps/web/node_modules/dotenv';
import postgres from '../../apps/web/node_modules/postgres';
config({path:'.env'});
async function main() {
 const admin=postgres(process.env.POSTGRES_URL!,{max:1}),schema=`resume_test_${randomUUID().replaceAll('-','')}`;let client:ReturnType<typeof postgres>|undefined;let schemaCreated=false;
 try {
  const [database]=await admin`select current_database() as name`;
  assert(String(database.name).startsWith('stockdepth_regression_'),'Run through isolated-regressions.cjs; disposable database required');
  await admin`create schema ${admin(schema)}`;schemaCreated=true;
  for(const table of ['analysis_jobs','analysis_job_resumptions','llm_model_configs','llm_model_config_versions','analysis_model_calls','analysis_reports','analysis_decisions','users'])await admin`create table ${admin(schema)}.${admin(table)} (like public.${admin(table)} including all)`;
  await admin`create table ${admin(schema)}.analysis_job_legacy_configs (like public.analysis_job_legacy_configs including all)`;
  await admin`create table ${admin(schema)}.billing_accounts (like public.billing_accounts including all)`;
  // LIKE copies serial defaults referencing public sequences. Localize every ID.
  for(const table of ['analysis_jobs','analysis_job_resumptions','llm_model_configs','llm_model_config_versions','analysis_model_calls','analysis_reports','analysis_decisions','users']) {
    const sequence=`${table}_fixture_ids`;
    await admin.unsafe(`create sequence ${schema}.${sequence}; alter sequence ${schema}.${sequence} owned by ${schema}.${table}.id; alter table ${schema}.${table} alter column id set default nextval('${schema}.${sequence}')`);
  }
  const url=new URL(process.env.POSTGRES_URL!);url.searchParams.set('search_path',schema);process.env.POSTGRES_URL=url.toString();
  process.env.STOCKDEPTH_MODEL_KEY_ID='fixture';process.env.STOCKDEPTH_MODEL_KEYRING=JSON.stringify({fixture:randomBytes(32).toString('base64url')});
  const {db,client:connection}=await import('../../apps/web/lib/db/drizzle');client=connection;
  assert.equal((await client`select current_schema() as name`)[0].name,schema);
  const {analysisJobs:jobs,analysisJobResumptions:history,llmModelConfigs:models,analysisModelCalls:calls,analysisReports:reports,users,billingAccounts}=await import('../../apps/web/lib/db/schema');
  const {resumeAnalysisJob}=await import('../../apps/web/lib/analysis/resume-job');
  const {createModelFixture,updateModelFixture}=await import('./model-fixture');
  const {pinModelVersions,readModelVersion,readCurrentModelConfig}=await import('../../apps/web/lib/analysis/model-versions');
  const {decryptModelKey}=await import('../../apps/web/lib/security/model-key');
  const {publicAnalysisJob}=await import('../../apps/web/lib/analysis/public-job');
  const {resumptionHistory}=await import('../../apps/web/lib/analysis/resumption-history');
  const {eq}=await import('../../apps/web/node_modules/drizzle-orm');
  await db.insert(users).values({id:1,email:'fixture@example.test',passwordHash:'fixture'});
  await db.insert(billingAccounts).values({userId:1,analysisCredits:100,ledgerOpeningBalance:100});
  const addModel=async(id:number,options:object={})=>createModelFixture(db,{name:`Model ${id}`,provider:'fixture',baseUrl:'http://127.0.0.1:1',apiKey:`synthetic-key-${id}`,modelName:`fixture-${id}`,...options});
  const old=await addModel(1,{unavailableReason:'quota_exhausted'}),quick=await addModel(2),deep=await addModel(3),disabled=await addModel(4,{isActive:false}),wrongRole=await addModel(5,{deepEnabled:false}),retired=await addModel(6,{retiredAt:new Date()});
  let id=10;
  const addJob=async(status='failed',hidden=false)=> (await db.insert(jobs).values({id:id++,userId:1,runId:randomUUID(),ticker:'MOCK',tradeDate:'2026-10-15',analysts:'[]',status,hiddenAt:hidden?new Date():null,quickModelVersionId:old.currentVersionId,deepModelVersionId:old.currentVersionId,configurationState:'versioned',startedAt:new Date('2026-10-14T00:00:00Z'),totalTokens:123,inputTokens:100,outputTokens:23}).returning())[0];
  const job=await addJob();
  await db.insert(calls).values({jobId:job.id,callId:randomUUID(),agent:'Market',model:old.modelName,modelConfigId:1,startedAt:new Date(),status:'complete',totalTokens:123,estimatedCost:'0.5'});
  await db.insert(reports).values({jobId:job.id,userId:1,reportKey:'market',title:'Completed market report',content:'KEEP THIS REPORT'});
  assert.equal((await resumeAnalysisJob(1,job.id)).status,409,'original quota-blocked models cannot retry');
  assert.equal((await resumeAnalysisJob(2,job.id,{quickModelConfigId:2,deepModelConfigId:3})).status,409,'ownership enforced');
  for(const candidate of [old,disabled,wrongRole,retired])assert.equal((await resumeAnalysisJob(1,job.id,{quickModelConfigId:2,deepModelConfigId:candidate.id})).status,400);
  assert.equal((await db.select().from(history)).length,0);
  const selection={quickModelConfigId:2,deepModelConfigId:3};
  const concurrent=await Promise.all([resumeAnalysisJob(1,job.id,selection),resumeAnalysisJob(1,job.id,selection)]);
  assert.equal(concurrent.filter(r=>r.status===200).length,1,'single atomic continuation');
  const [resumed]=await db.select().from(jobs).where(eq(jobs.id,job.id));
  assert.equal(resumed.configurationState,'versioned');assert(resumed.quickModelVersionId);assert(resumed.deepModelVersionId);
  assert.equal(resumed.runId,job.runId,'checkpoint identity preserved');assert.equal(resumed.status,'queued');assert.equal(resumed.externalStatus,'resume-queued');
  assert.equal(resumed.startedAt?.getTime(),job.startedAt?.getTime());assert.equal(resumed.totalTokens,123);assert.equal((await readModelVersion(db,resumed.quickModelVersionId!)).id,2);assert.equal((await readModelVersion(db,resumed.deepModelVersionId!)).id,3);
  const resumedDeep=await readModelVersion(db,resumed.deepModelVersionId!);assert.equal(resumedDeep.modelName,deep.modelName);assert.equal(decryptModelKey(resumedDeep.apiKey),decryptModelKey(deep.apiKey));
  const [audit]=await db.select().from(history);
  assert.equal(audit.previousDeepVersionId,old.currentVersionId);assert.equal(audit.nextDeepVersionId,deep.currentVersionId);
  assert.equal(audit.legacyEvidence,null,'versioned history has no duplicate names or credentials');
  assert.equal((await readModelVersion(db,audit.previousDeepVersionId!)).modelName,old.modelName);
  assert.equal((await readModelVersion(db,audit.nextDeepVersionId!)).modelName,deep.modelName);
  const historyFor=async(userId:number,jobId:number)=>(await db.select({history:resumptionHistory(userId)}).from(jobs).where(eq(jobs.id,jobId)))[0].history as any[];
  const publicHistory=await historyFor(1,job.id);
  assert.equal(publicHistory[0].previousDeepModel,old.modelName);assert.equal(publicHistory[0].nextDeepModel,deep.modelName);
  assert(!JSON.stringify(publicHistory).includes('sdkey:'));assert.deepEqual(await historyFor(2,job.id),[],'history stays scoped to owner');
  await updateModelFixture(db,deep.id,{modelName:'changed-after-resume'});
  assert.equal((await historyFor(1,job.id))[0].nextDeepModel,deep.modelName,'history uses pinned version after configuration edits');
  assert.equal((await db.select().from(calls))[0].modelVersionId,null,'legacy calls do not gain invented version lineage');
  assert.equal((await db.select().from(calls))[0].estimatedCost,'0.500000000000');assert.equal((await db.select().from(calls))[0].modelConfigId,1);assert.equal((await db.select().from(reports))[0].content,'KEEP THIS REPORT');assert.equal((await db.select().from(billingAccounts))[0].analysisCredits,100);
  assert(!JSON.stringify(publicAnalysisJob(resumed)).includes('sdkey:'));
  const active=await addJob('running'),hidden=await addJob('failed',true);assert.equal((await resumeAnalysisJob(1,active.id,selection)).status,409);assert.equal((await resumeAnalysisJob(1,hidden.id,selection)).status,409);
  const legacy=await addJob();await db.update(jobs).set({quickModelVersionId:null,deepModelVersionId:null,configurationState:'legacy_unknown'}).where(eq(jobs.id,legacy.id));
  assert.equal((await resumeAnalysisJob(1,legacy.id)).status,409,'legacy jobs require explicit model selection');
  const rollback=await addJob();await client`create function fail_resume_fixture() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure'; end$$`;await client`create trigger fail_resume_fixture before insert on analysis_job_resumptions for each row execute function fail_resume_fixture()`;
  await assert.rejects(resumeAnalysisJob(1,rollback.id,selection));assert.equal((await db.select().from(history)).length,1);assert.equal((await db.select().from(jobs).where(eq(jobs.id,rollback.id)))[0].status,'failed','audit and version update roll back together');await client`drop trigger fail_resume_fixture on analysis_job_resumptions`;await client`drop function fail_resume_fixture()`;
  await db.insert((await import('../../apps/web/lib/db/schema')).analysisJobLegacyConfigs).values({jobId:legacy.id,evidence:{quickModel:'unknown-old-quick',deepModel:'unknown-old-deep'}});
  assert.equal((await resumeAnalysisJob(1,legacy.id,selection)).status,200);
  const legacyHistory=await historyFor(1,legacy.id);
  assert.equal(legacyHistory[0].previousQuickModel,'unknown-old-quick');assert.equal(legacyHistory[0].previousDeepModel,'unknown-old-deep');
  assert.equal(legacyHistory[0].nextQuickModel,quick.modelName);
  const scheduled=await addJob('running');
  await db.update(jobs).set({workerOwner:'scheduled-owner',workerLeaseUntil:new Date(Date.now()+60000)}).where(eq(jobs.id,scheduled.id));
  for(let i=0;i<3;i++)await db.insert(history).values({jobId:scheduled.id,userId:1,previousQuickVersionId:old.currentVersionId,previousDeepVersionId:old.currentVersionId,nextQuickVersionId:old.currentVersionId,nextDeepVersionId:old.currentVersionId,configurationState:'versioned',initiator:'automatic'});
  assert.equal((await resumeAnalysisJob(1,scheduled.id,undefined,'scheduled-owner')).status,200,'same-model scheduled histories do not consume replacement budget');
  const automatic=await addJob('running');
  await db.update(jobs).set({workerOwner:'automatic-owner',workerLeaseUntil:new Date(Date.now()+60000)}).where(eq(jobs.id,automatic.id));
  assert.equal((await resumeAnalysisJob(1,automatic.id,undefined,'wrong-owner')).status,409);
  const retried=await resumeAnalysisJob(1,automatic.id,undefined,'automatic-owner');
  assert.equal(retried.status,200);
  if('job' in retried){assert.equal(retried.job.runId,automatic.runId);assert.equal(retried.job.status,'queued');assert.equal((await readModelVersion(db,retried.job.quickModelVersionId!)).id,2);assert.equal((await readModelVersion(db,retried.job.deepModelVersionId!)).id,2);assert.equal(retried.job.totalTokens,123);}
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
  const currentQuick=(await readCurrentModelConfig(db,2))!;
  const currentDeep=(await readCurrentModelConfig(db,3))!;
  const live=await addJob('running');
  const [owned]=await db.update(jobs).set({workerOwner:'live-owner',workerLeaseUntil:new Date(Date.now()+60000),...await db.transaction(tx=>pinModelVersions(tx,currentQuick,currentDeep))}).where(eq(jobs.id,live.id)).returning();
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
    assert.equal(result.status,'queued');assert.equal(result.externalStatus,'resume-queued');assert.equal((await readModelVersion(db,result.quickModelVersionId!)).id,3);assert.equal((await readModelVersion(db,result.deepModelVersionId!)).id,3);assert.equal(result.runId,live.runId);
    const [disabledQuick]=await db.select().from(models).where(eq(models.id,2));const [newDefault]=await db.select().from(models).where(eq(models.id,3));
    assert.equal(disabledQuick.unavailableReason,'quota_exhausted');assert.equal(disabledQuick.isDefault,false);assert.equal(newDefault.isDefault,true);
    assert.equal((await db.select().from(reports).where(eq(reports.jobId,live.id)))[0].content,'KEEP AUTOMATIC REPORT');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  await db.update(models).set({isActive:false}).where(eq(models.isActive,true));
  const none=await addJob('running');await db.update(jobs).set({workerOwner:'none-owner',workerLeaseUntil:new Date(Date.now()+60000)}).where(eq(jobs.id,none.id));
  assert.equal((await resumeAnalysisJob(1,none.id,undefined,'none-owner')).status,503,'no candidates stops instead of looping');
  assert.equal((await db.select().from(billingAccounts).where(eq(billingAccounts.userId,1)))[0].analysisCredits,100,'automatic retry never charges analysis credits again');
  console.log('PASS: atomic model replacement, checkpoint identity, original reports/tokens/costs/credits, pinned audit history and legacy fallback, ownership, role/disabled/quota/retired rejection, duplicate submissions, rollback and public credential filtering. No model calls.');
 }finally{if(client)await client.end();if(schemaCreated)await admin`drop schema if exists ${admin(schema)} cascade`;await admin.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
