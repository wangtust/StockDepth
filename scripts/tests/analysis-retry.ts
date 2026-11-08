// Disposable database only. Requeues synthetic jobs; never starts a runner.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {db,client} from '../../apps/web/lib/db/drizzle';
import {analysisJobs,users,billingAccounts,analysisJobResumptions,analysisReports,analysisModelCalls} from '../../apps/web/lib/db/schema';
import {createModelFixture} from './model-fixture';
import {retryRecentFailedAnalysisJobs,nextRetryTime} from '../../apps/workers/src/analysis-retry';
import {eq} from '../../apps/web/node_modules/drizzle-orm';
async function main() {
  const [identity]=await client`select current_database() as name`;
  assert(String(identity.name).startsWith('stockdepth_regression_'));
  assert.equal(nextRetryTime(new Date('2026-11-08T00:00:00Z')).toISOString(),'2026-11-08T08:00:00.000Z');
  assert.equal(nextRetryTime(new Date('2026-11-07T23:59:59Z')).toISOString(),'2026-11-08T00:00:00.000Z');
  const [owner]=await db.insert(users).values({email:'retry@example.test',passwordHash:'fixture'}).returning();
  const [inactive]=await db.insert(users).values({email:'inactive@example.test',passwordHash:'fixture',status:'inactive'}).returning();
  const [deleted]=await db.insert(users).values({email:'deleted@example.test',passwordHash:'fixture',deletedAt:new Date()}).returning();
  await db.update(billingAccounts).set({analysisCredits:77,ledgerOpeningBalance:77}).where(eq(billingAccounts.userId,owner.id));
  const model=await createModelFixture(db,{name:'Retry fixture',provider:'fixture',modelName:'mock',apiKey:'synthetic-key',baseUrl:'http://127.0.0.1:1'});
  const unavailable=await createModelFixture(db,{name:'Blocked fixture',provider:'fixture',modelName:'blocked',apiKey:'synthetic-key',baseUrl:'http://127.0.0.1:1',unavailableReason:'quota_exhausted'});
  const add=async(options:Partial<typeof analysisJobs.$inferInsert>={})=>(await db.insert(analysisJobs).values({userId:owner.id,runId:randomUUID(),ticker:'MOCK',tradeDate:'2026-11-08',analysts:'[]',status:'failed',configurationState:'versioned',quickModelVersionId:model.currentVersionId,deepModelVersionId:model.currentVersionId,completedAt:new Date(Date.now()-3600000),...options}).returning())[0];
  const savedKeyring=process.env.STOCKDEPTH_MODEL_KEYRING!,savedKeyId=process.env.STOCKDEPTH_MODEL_KEY_ID!;
  process.env.STOCKDEPTH_MODEL_KEY_ID='archived';process.env.STOCKDEPTH_MODEL_KEYRING=JSON.stringify({...JSON.parse(savedKeyring),archived:randomBytes(32).toString('base64url')});
  const archived=await createModelFixture(db,{name:'Archived fixture',provider:'fixture',modelName:'archived',apiKey:'synthetic-key'});
  process.env.STOCKDEPTH_MODEL_KEY_ID=savedKeyId;process.env.STOCKDEPTH_MODEL_KEYRING=savedKeyring;
  const recent=await add({createdAt:new Date(Date.now()-7*86400000),totalTokens:123});
  const edge=await add({completedAt:new Date(Date.now()-86400000+60000)});
  const fallback=await add({completedAt:null,updatedAt:new Date(Date.now()-3600000)});
  const excluded=await Promise.all([
    add({completedAt:new Date(Date.now()-86400000-60000)}),add({hiddenAt:new Date()}),
    add({status:'running'}),add({status:'queued'}),add({status:'complete'}),
    add({userId:inactive.id}),add({userId:deleted.id}),add({completedAt:new Date(Date.now()+3600000)}),
    add({quickModelVersionId:null,deepModelVersionId:null,configurationState:'legacy_unknown'}),add({deepModelVersionId:unavailable.currentVersionId}),add({deepModelVersionId:archived.currentVersionId})]);
  await db.insert(analysisReports).values({jobId:recent.id,userId:owner.id,reportKey:'market',title:'Saved',content:'preserve'});
  await db.insert(analysisModelCalls).values({jobId:recent.id,callId:'saved',agent:'market',model:'mock',status:'complete',startedAt:new Date(),totalTokens:123});
  assert.equal(await retryRecentFailedAnalysisJobs(),null,'first start waits for next boundary');
  const forceDue=()=>client`update analysis_retry_schedule set next_run_at=now()-interval '1 minute'`;
  await forceDue();
  const results=await Promise.all([retryRecentFailedAnalysisJobs(),retryRecentFailedAnalysisJobs()]);
  assert.equal(results.filter(Boolean).length,1,'one sweep across competing workers');
  assert.equal(results.find(Boolean)!.queued,3);assert.equal(results.find(Boolean)!.skipped,3);
  for(const job of [recent,edge,fallback]) {
    const [saved]=await db.select().from(analysisJobs).where(eq(analysisJobs.id,job.id));
    assert.equal(saved.status,'queued');assert.equal(saved.runId,job.runId);assert.equal(saved.completedAt,null);
  }
  for(const job of excluded)assert.equal((await db.select().from(analysisJobs).where(eq(analysisJobs.id,job.id)))[0].status,job.status);
  const history=await db.select().from(analysisJobResumptions);
  assert.equal(history.length,3);assert(history.every(h=>h.initiator==='automatic'&&h.nextQuickVersionId===model.currentVersionId));
  assert.equal((await db.select().from(analysisReports))[0].content,'preserve');
  assert.equal((await db.select().from(analysisModelCalls))[0].totalTokens,123);
  assert.equal((await db.select().from(billingAccounts).where(eq(billingAccounts.userId,owner.id)))[0].analysisCredits,77);
  assert.equal(await retryRecentFailedAnalysisJobs(),null,'persisted schedule suppresses repeat checks');
  const rollback=await add();await forceDue();
  await client`create function fail_retry_fixture() returns trigger language plpgsql as $$begin raise exception 'fixture rollback'; end$$`;
  await client`create trigger fail_retry_fixture before insert on analysis_job_resumptions for each row execute function fail_retry_fixture()`;
  await assert.rejects(retryRecentFailedAnalysisJobs());
  assert.equal((await db.select().from(analysisJobs).where(eq(analysisJobs.id,rollback.id)))[0].status,'failed');
  assert.equal((await client`select next_run_at < now() as due from analysis_retry_schedule`)[0].due,true,'failed sweep remains due');
  await client`drop trigger fail_retry_fixture on analysis_job_resumptions`;
  assert.equal((await retryRecentFailedAnalysisJobs())!.queued,1,'retry after rollback');
  // An overdue schedule does one current-window sweep and advances to the next boundary.
  await client`update analysis_retry_schedule set next_run_at=now()-interval '3 days'`;
  assert.equal((await retryRecentFailedAnalysisJobs())!.queued,0);
  assert.equal((await client`select next_run_at > now() as future from analysis_retry_schedule`)[0].future,true);
  console.log('PASS scheduled retry: window, failure time, exclusions, checkpoint/audit/usage/credits, concurrent workers, persisted clock, rollback and overdue recovery');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>client.end());
