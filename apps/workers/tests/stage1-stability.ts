import { createModelFixture, updateModelFixture } from '../../../scripts/tests/model-fixture';
import { pinModelVersions } from '@/lib/analysis/model-versions';
import { billingAccounts } from '@/lib/db/schema';
import { mutateCredits } from '@/lib/credits/ledger';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { readFile, readdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { and, eq, sql } from 'drizzle-orm';
import { db, client } from '@/lib/db/drizzle';
import { users, llmModelConfigs, analysisJobs, analysisReports, analysisModelCalls, paperPortfolios, paperAnalysisRuns, paperModelCalls, paperTradeDecisions, paperTrades } from '@/lib/db/schema';
import { encryptModelKey, readModelConfig } from '@/lib/security/model-key';
import { claimAnalysis, renewAnalysis, LostOwnershipError } from '../src/analysis-ownership';
import { syncUsage } from '../src/analysis-worker';
import { claimPaperRun, expireSubmittedRuns } from '../src/paper-ownership';
import { callDecisionModel, processRun } from '../src/paper-trader-worker';
import { ResourceMonitor } from '../src/resources';
import { isAnalysisRunner } from '@/lib/analysis/runner-process';
import { publicAnalysisJob } from '@/lib/analysis/public-job';

const results: string[] = [];
const check = (name: string) => { results.push(name); console.log(JSON.stringify({ test: name, status: 'passed' })); };
const timeout = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let mode = 'normal', requestCount = 0;
const auth: string[] = [];
const http = createServer((request, response) => {
  requestCount++;
  auth.push(String(request.headers.authorization || request.headers['x-api-key'] || request.headers['x-goog-api-key'] || ''));
  assert(!String(request.url).includes('fixture-account'), 'Key must not appear in URL');
  request.resume();
  if (mode === 'hang-headers') return;
  if (mode === 'hang-body') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{'); return; }
  response.setHeader('Content-Type', 'application/json');
  if (mode === '429' || mode === '500') { response.statusCode = Number(mode); response.end(JSON.stringify({ error: { message: 'fixture-account-a' } })); return; }
  const content = JSON.stringify({ action: 'hold', confidence: .8, reason: 'fixture' });
  if (request.url?.includes('generateContent')) response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: content }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, cachedContentTokenCount: 2 } }));
  else if (request.url?.endsWith('/messages')) response.end(JSON.stringify({ content: [{ type: 'text', text: content }], usage: { input_tokens: 8, output_tokens: 2, cache_read_input_tokens: 2 } }));
  else response.end(JSON.stringify({ choices: [{ message: { content } }], ...(mode === 'no-usage' ? {} : { usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 2 } } }) }));
});

async function main() {
  const [database] = await db.execute(sql`select current_database() as name`);
  assert(String(database.name).startsWith('stockdepth_stage1_'), 'Explicit isolated database required');
  const publicJob = publicAnalysisJob({ id: 1, quickModelConfigId: 12, deepModelConfigId: 25,
    quickConfigSnapshot: 'encrypted-fixture-key', deepConfigSnapshot: 'encrypted-fixture-key', workerOwner: 'private-owner', workerLeaseUntil: new Date() });
  assert(!JSON.stringify(publicJob).includes('encrypted-fixture-key') && !JSON.stringify(publicJob).includes('private-owner'));
  assert.equal(publicJob.quickModelConfigId, 12);
  check('browser-job-dto-excludes-credential-snapshots-and-owner');
  const processDirectory = await mkdtemp(resolve(tmpdir(), 'stage1-runner-'));
  const tracked = new ResourceMonitor(); await tracked.snapshot();
  const runnerPath = processDirectory+'/analysis_runner.py';
  await writeFile(runnerPath, 'import time\ntime.sleep(60)\n');
  const child = spawn(process.env.STOCKDEPTH_RUNTIME_BIN+'/python', [runnerPath, '--run-id', 'mock-run-id'], { stdio: 'ignore' });
  try {
    await timeout(100);
    assert(await isAnalysisRunner(child.pid!, 'mock-run-id'));
    assert.equal(await isAnalysisRunner(child.pid!, 'wrong-run-id'), false);
    assert.equal(await isAnalysisRunner(process.pid, 'mock-run-id'), false);
    await tracked.track(child.pid!);
    assert((await tracked.snapshot()).runnerRssMb > 0); assert.equal(tracked.scans, 1);
  } finally {
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('close', resolve)); child.kill(); await exited; }
    await rm(processDirectory, { recursive: true });
  }
  check('runner-identity-and-new-pid-tracking-without-rescan');
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  const endpoint = `http://127.0.0.1:${port}`;
  const [user] = await db.insert(users).values({ email: `stage1-${randomUUID()}@test.invalid`, passwordHash: 'unused' }).returning();
 await db.transaction(tx => mutateCredits(tx, {userId:user.id, amount:100, reason:'fixture_funding', operationKey:'fixture-funding:'+user.id}));
  const config = await createModelFixture(db, { name: 'Mock only', provider: 'openai-compatible', modelName: 'same-name', baseUrl: endpoint,
    apiKey: encryptModelKey('fixture-account-a'), inputPrice: '2', cachePrice: '1', outputPrice: '4' });
  const model = readModelConfig(config);
  const fixtureJob = async (status = 'queued', snapshots?: { quick: any; deep: any }) => {
    const fromSnapshot = async (snapshot: any) => createModelFixture(db, {
      name: `Snapshot ${randomUUID()}`, provider: snapshot.provider, baseUrl: snapshot.baseUrl,
      modelName: snapshot.modelName, modelOptions: snapshot.modelOptions, apiKey: snapshot.apiKey,
      inputPrice: snapshot.inputPrice, cachePrice: snapshot.cachePrice, outputPrice: snapshot.outputPrice,
    });
    const quick = snapshots ? await fromSnapshot(snapshots.quick) : config;
    const deep = snapshots ? await fromSnapshot(snapshots.deep) : config;
    return db.transaction(async tx => {
      const pins = await pinModelVersions(tx, quick, deep);
      const [job] = await tx.insert(analysisJobs).values({ userId: user.id, runId: `stage1-${randomUUID()}`, ticker: 'MOCK', tradeDate: '2026-10-13', analysts: '[]', status, ...pins }).returning();
      return job;
    });
  };
  for (let index = 0; index < 5; index++) await fixtureJob();
  const settings = { systemConcurrency: 2, userConcurrency: 10 };
  const claimed = (await Promise.all(Array.from({ length: 5 }, () => claimAnalysis(settings)))).filter(job => job != null);
  assert.equal(claimed.length, 2, 'Global admission must be atomic across claimers');
  assert.equal(new Set(claimed.map(job => job.id)).size, 2);
  assert.equal(await claimAnalysis({ systemConcurrency: 10, userConcurrency: 2 }), null);
  check('atomic-global-and-user-admission');
  const old = claimed[0];
  await db.update(analysisJobs).set({ workerLeaseUntil: sql`now() - interval '1 second'` }).where(eq(analysisJobs.id, old.id));
  const recovered = await claimAnalysis(settings, true);
  assert(recovered && recovered.id === old.id && recovered.workerOwner !== old.workerOwner);
  await assert.rejects(renewAnalysis(old), LostOwnershipError);
  const usage = { status: 'running', usage: { history_complete: true, calls: [{ call_id: randomUUID(), agent: 'Market Analyst', model: 'same-name', role: 'quick', model_config_id: config.id,
    provider: 'qwen', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), status: 'complete', input_tokens: 10, output_tokens: 2, total_tokens: 12,
    cached_input_tokens: 2, usage_available: true, is_retry: false, request_kind: 'standard', pricing_snapshot: { input: '2', cache: '1', output: '4', currency: 'CNY' }, estimated_cost: '0.000026000000', cost_complete: true }] } };
  await assert.rejects(syncUsage(old, usage, new Map()), LostOwnershipError);
  await syncUsage(recovered, usage, new Map());
  await updateModelFixture(db, config.id, { inputPrice: '999' });
  await syncUsage(recovered, usage, new Map());
  const rows = await db.select().from(analysisModelCalls).where(eq(analysisModelCalls.jobId, recovered.id));
  assert.equal(rows.length, 1); assert.equal(rows[0].role, 'quick'); assert.equal(rows[0].provider, 'qwen'); assert.equal(rows[0].modelConfigId, config.id);
  assert.equal(rows[0].estimatedCost, '0.000026000000');
  check('expired-owner-fenced-dual-identity-and-immutable-cost');
  await db.update(analysisJobs).set({ status: 'complete', workerOwner: null, workerLeaseUntil: null });
  const snapshot = (provider: string, url: string, capacity: number) => ({ ...config, provider, baseUrl: url, modelOptions: { request_concurrency: capacity } });
  await fixtureJob('queued', { quick: snapshot('qwen', endpoint+'/qwen', 1), deep: snapshot('openai', endpoint+'/deep', 2) });
  await fixtureJob('queued', { quick: snapshot('other', endpoint+'/other', 1), deep: snapshot('openai', endpoint+'/deep', 2) });
  await fixtureJob('queued', { quick: snapshot('qwen', endpoint+'/qwen', 1), deep: snapshot('other', endpoint+'/different', 2) });
  assert(await claimAnalysis({ systemConcurrency: 10, userConcurrency: 10 }));
  assert(await claimAnalysis({ systemConcurrency: 10, userConcurrency: 10 }));
  assert(await claimAnalysis({ systemConcurrency: 10, userConcurrency: 10 }));
  check('provider-options-do-not-override-admin-job-limits');
  await db.update(analysisJobs).set({ status: 'complete', workerOwner: null, workerLeaseUntil: null });
  const liveOne = await fixtureJob('running'), liveTwo = await fixtureJob('running');
  await db.update(analysisJobs).set({ externalStatus: 'running', externalPid: process.pid }).where(sql`id in (${liveOne.id}, ${liveTwo.id})`);
  await fixtureJob();
  assert.equal(await claimAnalysis(settings), null, 'Already live runners consume admission even before ownership recovery');
  assert(await claimAnalysis(settings, true), 'A live runner can be monitored without starting a new one');
  assert(await claimAnalysis(settings, true));
  assert.equal(await claimAnalysis(settings), null);
  check('existing-runner-monitoring-does-not-admit-extra-starts');
  await db.update(analysisJobs).set({ status: 'complete', workerOwner: null, workerLeaseUntil: null });
  // Paper pins authoritative configuration rows, not the caller's stale adapter.
  await updateModelFixture(db, config.id, { inputPrice: '2' });
  const [portfolio] = await db.insert(paperPortfolios).values({ userId: user.id, initialCashCents: 10000, cashCents: 10000, autoTradeEnabled: false }).returning();
  const paperFixture = async () => {
    const job = await fixtureJob('complete');
    await db.insert(analysisReports).values({ jobId: job.id, userId: user.id, reportKey: 'decision', title: 'Mock', content: 'Mock research' });
    const [run] = await db.insert(paperAnalysisRuns).values({ userId: user.id, portfolioId: portfolio.id, analysisJobId: job.id, ticker: 'MOCK' }).returning();
    return run;
  };
  await paperFixture();
  const paperClaims = (await Promise.all([claimPaperRun(), claimPaperRun()])).filter(run => run != null);
  assert.equal(paperClaims.length, 1);
  const before = requestCount;
  await processRun(paperClaims[0], model);
  assert.equal(requestCount-before, 1);
  assert.equal((await db.select().from(paperTradeDecisions)).length, 1);
  assert.equal((await db.select().from(paperTrades)).length, 0);
  const [paperCall] = await db.select().from(paperModelCalls).where(eq(paperModelCalls.paperRunId, paperClaims[0].id));
  assert.equal(paperCall.estimatedCost, '0.000026000000'); assert(paperCall.endedAt);
  await assert.rejects(db.update(paperModelCalls).set({ estimatedCost:'999' }).where(eq(paperModelCalls.id,paperCall.id)), 'completed paper usage is immutable');
  check('paper-claim-once-one-mock-request-no-trade');
  const preSubmit = await paperFixture();
  const firstOwner = await claimPaperRun(); assert(firstOwner && firstOwner.id === preSubmit.id);
  await db.update(paperAnalysisRuns).set({ workerLeaseUntil: sql`now() - interval '1 second'` }).where(eq(paperAnalysisRuns.id, preSubmit.id));
  const secondOwner = await claimPaperRun(); assert(secondOwner && secondOwner.workerOwner !== firstOwner.workerOwner);
  const requestBefore = requestCount;
  await assert.rejects(processRun(firstOwner, model), LostOwnershipError);
  assert.equal(requestCount, requestBefore);
  await processRun(secondOwner, model);
  check('pre-submit-reclaim-fences-old-paper-owner');
  const [pinnedRun] = await db.select().from(paperAnalysisRuns).where(eq(paperAnalysisRuns.id,secondOwner.id));
  assert(pinnedRun.traderModelVersionId,'paper submission records an immutable model pin');
  const recovery = await paperFixture();
  await db.update(paperAnalysisRuns).set({traderModelVersionId:pinnedRun.traderModelVersionId}).where(eq(paperAnalysisRuns.id,recovery.id));
  const recoveryOwner = await claimPaperRun(); assert(recoveryOwner && recoveryOwner.id===recovery.id);
  await updateModelFixture(db, config.id, {modelName:'changed-after-pin',inputPrice:'999'});
  await processRun(recoveryOwner,model);
  const [recoveryCall] = await db.select().from(paperModelCalls).where(eq(paperModelCalls.paperRunId,recovery.id));
  assert.equal(recoveryCall.modelVersionId,pinnedRun.traderModelVersionId);
  assert.equal(recoveryCall.model,config.modelName);
  assert.equal(recoveryCall.estimatedCost,'0.000026000000','recovery uses pinned prices after configuration edits');
  const blocked = await paperFixture();
  await db.update(paperAnalysisRuns).set({traderModelVersionId:pinnedRun.traderModelVersionId}).where(eq(paperAnalysisRuns.id,blocked.id));
  const blockedOwner=await claimPaperRun(); assert(blockedOwner && blockedOwner.id===blocked.id);
  await updateModelFixture(db, config.id, {isActive:false,retiredAt:new Date(),unavailableReason:'quota_exhausted'});
  const beforeBlocked=requestCount;
  await assert.rejects(processRun(blockedOwner,model),/Pinned trading model is unavailable/);
  assert.equal(requestCount,beforeBlocked,'disabled identity rejects pinned execution before sending requests');
  assert.equal((await db.select().from(paperModelCalls).where(eq(paperModelCalls.paperRunId,blocked.id))).length,0);
  await updateModelFixture(db, config.id, {isActive:true,retiredAt:null,unavailableReason:null,modelName:config.modelName,inputPrice:'2'});
  check('paper-pinned-recovery-preserves-version-and-enforces-identity-availability');
  const uncertain = await paperFixture();
  const uncertainClaim = await claimPaperRun(); assert(uncertainClaim && uncertainClaim.id === uncertain.id);
  const callId = randomUUID();
  await db.update(paperAnalysisRuns).set({ processingState: 'submitted', modelSubmittedAt: new Date(), modelCallId: callId, workerLeaseUntil: sql`now() - interval '1 second'` }).where(eq(paperAnalysisRuns.id, uncertain.id));
  await db.insert(paperModelCalls).values({ paperRunId: uncertain.id, callId, provider: config.provider, model: config.modelName, status: 'running' });
  assert.equal(await expireSubmittedRuns(), 1);
  assert.equal(await claimPaperRun(), null);
  const [unknown] = await db.select().from(paperAnalysisRuns).where(eq(paperAnalysisRuns.id, uncertain.id)); assert.equal(unknown.processingState, 'unknown');
  const [interrupted] = await db.select().from(paperModelCalls).where(eq(paperModelCalls.paperRunId, uncertain.id)); assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.estimatedCost, null);
  const [unknownDecision] = await db.select().from(paperTradeDecisions).where(eq(paperTradeDecisions.paperAnalysisRunId, uncertain.id));
  assert.equal(unknownDecision.status, 'failed'); assert(unknownDecision.errorMessage?.includes('outcome is unknown'));
  check('submitted-crash-is-unknown-not-auto-rebilled');
  mode = 'no-usage'; await paperFixture(); const missing = await claimPaperRun(); assert(missing);
  await updateModelFixture(db, config.id, {inputPrice:null,cachePrice:null,outputPrice:null});
  await processRun(missing, { ...model, inputPrice: null, cachePrice: null, outputPrice: null });
  await updateModelFixture(db, config.id, {inputPrice:'2',cachePrice:'1',outputPrice:'4'});
  const [missingCall] = await db.select().from(paperModelCalls).where(eq(paperModelCalls.paperRunId, missing.id));
  assert.equal(missingCall.estimatedCost, null); assert.equal(missingCall.costComplete, false);
  check('paper-missing-usage-and-price-are-unknown');
  mode = 'normal';
  await callDecisionModel(model, 'mock'); await callDecisionModel({ ...model, apiKey: 'fixture-account-b' }, 'mock');
  assert.equal(auth.at(-2), 'Bearer fixture-account-a'); assert.equal(auth.at(-1), 'Bearer fixture-account-b');
  await callDecisionModel({ ...model, provider: 'anthropic' }, 'mock'); assert.equal(auth.at(-1), 'fixture-account-a');
  await callDecisionModel({ ...model, provider: 'google' }, 'mock'); assert.equal(auth.at(-1), 'fixture-account-a');
  check('mock-provider-credential-isolation-and-no-key-in-url');
  for (const failure of ['hang-headers', 'hang-body', '429', '500']) {
    mode = failure;
    const start = performance.now();
    await assert.rejects(callDecisionModel(model, 'mock'), error => !String(error).includes('fixture-account-a'));
    assert(performance.now()-start < 3000, 'Timeout must include body read');
  }
  check('paper-header-body-timeout-and-error-redaction');
  mode = 'normal';
  await db.update(llmModelConfigs).set({ isActive: false, isDefault: false });
  await updateModelFixture(db, config.id, { isActive: true, isDefault: true, inputPrice: '2' });
  const competing = await paperFixture();
  const beforeCompetition = requestCount;
  const children = Array.from({ length: 2 }, () => spawn(process.env.STOCKDEPTH_RUNTIME_BIN+'/tsx', ['src/paper-trader-worker.ts'], {
    cwd: resolve('.'), detached: true, env: { ...process.env, PAPER_TRADER_WORKER_POLL_MS: '50', PAPER_TRADER_MODEL_TIMEOUT_MS: '1000', PAPER_TRADER_AUTO_EXECUTE: 'false' },
    stdio: ['ignore','pipe','pipe'],
  }));
  for (const child of children) { child.stdout.resume(); child.stderr.resume(); }
  try {
    let complete = false;
    const began = performance.now();
    while (performance.now()-began < 6000) {
      const [run] = await db.select().from(paperAnalysisRuns).where(eq(paperAnalysisRuns.id, competing.id));
      if (run.processingState === 'complete') { complete = true; break; }
      assert(children.every(child => child.exitCode === null), 'Competing worker exited');
      await timeout(50);
    }
    assert(complete, 'Competing workers must complete the fixture');
    await timeout(150);
    assert.equal(requestCount-beforeCompetition, 1, 'Two processes must make one mock model request');
  } finally {
    await Promise.all(children.map(async child => {
      if (child.exitCode === null && child.signalCode === null) {
        process.kill(-child.pid, 'SIGTERM');
        await new Promise(resolve => child.once('close', resolve));
      }
    }));
  }
  check('two-paper-worker-processes-make-one-request');
  const monitor = new ResourceMonitor(60000);
  const oldTimes: number[] = [], newTimes: number[] = [];
  const originalScan = async () => {
    await readFile('/proc/meminfo', 'utf8');
    for (const pid of (await readdir('/proc')).filter(value => /^\d+$/.test(value))) {
      try {
        const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
        if (args.some(arg => arg.endsWith('/analysis_runner.py'))) await readFile(`/proc/${pid}/status`, 'utf8');
      } catch {}
    }
  };
  for (let i=0;i<10;i++) { const start=performance.now(); await originalScan(); oldTimes.push(performance.now()-start); }
  for (let i=0;i<10;i++) { const start=performance.now(); await monitor.snapshot(); newTimes.push(performance.now()-start); }
  assert.equal(monitor.scans, 1);
  const total = (values: number[]) => values.reduce((a,b)=>a+b,0);
  const metrics = { samples: 10, beforeMs: oldTimes, afterMs: newTimes, beforeScans: 10, afterScans: monitor.scans,
    totalBeforeMs: total(oldTimes), totalAfterMs: total(newTimes), coldAfterMs: newTimes[0] };
  check('resource-discovery-cached-low-memory-sampling-retained');
  const [credits] = await db.select({ credits: billingAccounts.analysisCredits }).from(billingAccounts).where(eq(billingAccounts.userId, user.id));
  assert.equal(credits.credits, 100); assert.equal((await db.select().from(paperTrades)).length, 0);
  check('fixture-credits-preserved-no-trades');
  await writeFile(process.env.STAGE1_TEST_OUTPUT!, JSON.stringify({ tests: results, resources: metrics }, null, 2));
  await timeout(10);
}
main().catch(error => { console.error('Isolated stability test failed:', error.name, error.code || error.message, String(error.stack).split('\n').filter(line=>/^\s+at /.test(line)).join('\n')); process.exitCode=1; })
  .finally(async () => { http.closeAllConnections(); await new Promise<void>(resolve=>http.close(()=>resolve())); await client.end(); });
