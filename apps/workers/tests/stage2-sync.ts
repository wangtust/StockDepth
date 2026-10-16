import { billingAccounts } from '@/lib/db/schema';
import { mutateCredits } from '@/lib/credits/ledger';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { db, client } from '@/lib/db/drizzle';
import { analysisJobs, analysisReports, analysisModelCalls, users } from '@/lib/db/schema';
import { claimAnalysis, LostOwnershipError } from '../src/analysis-ownership';
import { createServer } from 'node:http';
async function main() {
 let polls = 0, bodies = 0, scenario = 'complete';
 const server = createServer((req, res) => {
   const light = req.url?.startsWith('/api/run/status'); if (light) polls++; else bodies++;
   const version = polls >= 3 ? 'v2' : 'v1';
   const status = scenario === 'partial' ? 'partial' : polls >= 4 ? scenario : 'running';
   res.setHeader('Content-Type', 'application/json');
   res.end(JSON.stringify({ status, report_version: version, runner_log: status === 'failed' ? 'mock runner error' : '',
     reports: light ? [{ key: 'decision', title: 'Decision', version }] : [{ key: 'decision', title: 'Decision', content: version }],
     usage: { calls: [], history_complete: polls >= 2 } }));
 });
 await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
 process.env.STOCKDEPTH_API_URL = `http://127.0.0.1:${(server.address() as any).port}`;
 process.env.ANALYSIS_WORKER_POLL_MS = '1';
 process.env.ANALYSIS_WORKER_MOCK = 'false';
 const { saveReports, syncUsage, processJob } = await import('../src/analysis-worker');
 try {
 const [database] = await db.execute(sql`select current_database() as name`);
 assert(String(database.name).startsWith('stockdepth_stage2_worker_'));
 const [user] = await db.insert(users).values({ email: 'worker-stage2@test.invalid', passwordHash: 'unused', role: 'super_admin' }).returning();
 await db.transaction(tx => mutateCredits(tx, {userId:user.id, amount:100, reason:'fixture_funding', operationKey:'fixture-funding:'+user.id}));
 await db.insert(analysisJobs).values({ userId: user.id, runId: 'stage2-fixture', ticker: 'MOCK', tradeDate: '2026-10-13', analysts: '[]' });
 const job = await claimAnalysis({ systemConcurrency: 2, userConcurrency: 2 }); assert(job);
 const reports = [{ key: 'market', title: 'Market', content: 'a'.repeat(100000) }, { key: 'news', title: 'News', content: 'b'.repeat(100000) }];
 await saveReports(job, reports);
 const before = await db.select().from(analysisReports);
 await saveReports(job, reports);
 assert.deepEqual(await db.select().from(analysisReports), before, 'Unchanged reports must not write');
 await saveReports(job, [{ ...reports[0], content: 'c'.repeat(100000) }, reports[1]]);
 const after = await db.select().from(analysisReports); assert.equal(after.length, 2);
 assert.deepEqual(after.find(r => r.reportKey === 'news'), before.find(r => r.reportKey === 'news'));
 assert.equal(after.find(r => r.reportKey === 'market')!.id, before.find(r => r.reportKey === 'market')!.id);
 await saveReports(job, [reports[1], { key: 'decision', title: 'Decision', content: 'hold' }]);
 assert.deepEqual((await db.select().from(analysisReports)).map(r => r.reportKey).sort(), ['decision', 'news']);
 const calls = [{ call_id: 'fixture', agent: 'Market', model: 'mock', role: 'quick', model_config_id: null, provider: 'mock', started_at: new Date().toISOString(), ended_at: null, status: 'running', input_tokens: 10, output_tokens: 2, total_tokens: 12, usage_available: true, is_retry: false, request_kind: 'standard', pricing_snapshot: { input: '2.000000000000' }, estimated_cost: '0.000026000000', cost_complete: true }];
 const cache = new Map<string, string>();
 await syncUsage(job, { status: 'running', usage: { calls, history_complete: false } }, cache);
 await syncUsage(job, { status: 'complete', usage: { calls, history_complete: true } }, cache);
 const [fresh] = await db.select().from(analysisJobs).where(eq(analysisJobs.id, job.id)); assert(fresh.tokenUsageComplete); assert.equal(fresh.totalTokens, 12);
 const [call] = await db.select().from(analysisModelCalls); assert.equal(call.estimatedCost, '0.000026000000'); assert.equal(call.role, 'quick'); assert.equal(call.provider, 'mock');
 // First terminal transition captures final usage; subsequent payloads cannot change it.
 calls[0].status = 'complete'; calls[0].ended_at = new Date().toISOString() as any;
 await syncUsage(job, { status: 'complete', usage: { calls, history_complete: true } }, cache);
 const [sealed] = await db.select().from(analysisModelCalls);
 const replay = [{ ...calls[0], status: 'running', input_tokens: 999, estimated_cost: '99' }];
 await syncUsage(job, { status: 'running', usage: { calls: replay, history_complete: true } }, new Map());
 assert.deepEqual((await db.select().from(analysisModelCalls))[0], sealed, 'late usage cannot reopen or reprice terminal call');
 await assert.rejects(db.update(analysisModelCalls).set({ estimatedCost: '100' }).where(eq(analysisModelCalls.id, sealed.id)), 'database freezes terminal usage');
 await assert.rejects(db.update(analysisModelCalls).set({ status: 'running' }).where(eq(analysisModelCalls.id, sealed.id)), 'terminal call cannot reopen');
 await db.execute(sql`select correct_model_call_usage('analysis_model_calls',${sealed.id},${user.id},'Provider invoice reconciliation',${JSON.stringify({ input_tokens:20,total_tokens:22,estimated_cost:'0.000046000000' })}::jsonb)`);
 const [corrected] = await db.select().from(analysisModelCalls); assert.equal(corrected.inputTokens,20); assert.equal(corrected.estimatedCost,'0.000046000000');
 const [correctedJob] = await db.select().from(analysisJobs).where(eq(analysisJobs.id,job.id)); assert.equal(correctedJob.totalTokens,22);
 const [audit] = await db.execute(sql`select count(*)::int n from admin_audit_logs where action='model_call.usage_corrected' and target_id=${sealed.id}`); assert.equal(audit.n,1);
 await assert.rejects(db.execute(sql`select correct_model_call_usage('analysis_model_calls',${sealed.id},${user.id},'Provider invoice reconciliation','{"status":"running"}'::jsonb)`));
 await assert.rejects(db.execute(sql`select correct_model_call_usage('analysis_model_calls',${sealed.id},${user.id},'Provider invoice reconciliation','{"input_tokens":-1}'::jsonb)`));
 const [permit] = await db.execute(sql`select count(*)::int n from stockdepth_internal.call_correction_permits`); assert.equal(permit.n,0);
 const [publicGrant] = await db.execute(sql`select count(*)::int n from pg_proc p,aclexplode(p.proacl) a where p.proname='correct_model_call_usage' and a.grantee=0 and a.privilege_type='EXECUTE'`); assert.equal(publicGrant.n,0);
 await db.update(analysisJobs).set({ workerLeaseUntil: sql`now() - interval '1 second'` }).where(eq(analysisJobs.id, job.id));
 const recovered = await claimAnalysis({ systemConcurrency: 2, userConcurrency: 2 }, true); assert(recovered);
 await assert.rejects(saveReports(job, []), LostOwnershipError); await assert.rejects(syncUsage(job, { status: 'running', usage: { calls, history_complete: true } }, cache), LostOwnershipError);
 await saveReports(recovered, [reports[1]]);
 const [credits] = await db.select().from(billingAccounts); assert.equal(credits.analysisCredits, 100);
 for (const end of ['complete', 'failed', 'partial']) {
   scenario = end; polls = 0; bodies = 0;
   await db.update(analysisJobs).set({ status: 'complete', workerOwner: null, workerLeaseUntil: null }).where(eq(analysisJobs.id, job.id));
   const [fixture] = await db.insert(analysisJobs).values({ userId: user.id, runId: `loop-${end}`, ticker: 'MOCK', tradeDate: '2026-10-13', analysts: '[]' }).returning();
   const owned = await claimAnalysis({ systemConcurrency: 2, userConcurrency: 2 }); assert(owned && owned.id === fixture.id);
   await processJob(owned, { startRun: false });
   const [result] = await db.select().from(analysisJobs).where(eq(analysisJobs.id, fixture.id));
   if (end === 'partial') { assert.equal(result.externalStatus, 'recovery_waiting'); assert.equal(result.workerOwner, null); }
   else { assert.equal(result.status, end); if (end === 'failed') assert.equal(result.errorMessage, 'mock runner error'); assert.equal(polls, 4); assert.equal(bodies, 2); assert.equal(result.workerOwner, null);
     const [report] = await db.select().from(analysisReports).where(eq(analysisReports.jobId, fixture.id)); assert.equal(report.content, 'v2'); }
   await db.update(analysisJobs).set({ status: 'complete', workerOwner: null, workerLeaseUntil: null }).where(eq(analysisJobs.id, fixture.id));
 }
 console.log('processJob isolated Mock: complete/failed/partial recovery paths, 4 status/2 body requests, final reports, lease release passed');
 console.log('isolated DB: unchanged row, one row update, removal/addition, recovered reconciliation, usage completeness, Decimal/identity, lease fencing, credits preserved passed');
 } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => client.end());
