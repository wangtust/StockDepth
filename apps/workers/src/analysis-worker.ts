import '../env';
import { extractDecision } from '@/lib/analysis/decision-extraction';
import { resumeAnalysisJob } from '@/lib/analysis/resume-job';
import { recordQuotaFailures, unavailableJobModels } from '@/lib/analysis/model-availability';
import { decryptModelKey } from '@/lib/security/model-key';
import { isAnalysisRunner } from '@/lib/analysis/runner-process';
import { basename } from 'node:path';
import { RunPoller, reportValues, reportMatches } from './analysis-polling';
import { ResourceMonitor } from './resources';
import { claimAnalysis, ownedAnalysis, assertAnalysisOwner, renewAnalysis, LostOwnershipError, analysisLeaseMs } from './analysis-ownership';
import { fetchWithBackoff } from './request';
import { eq, sql, desc } from 'drizzle-orm';
import { getAnalysisConcurrencySettings } from '@/lib/analysis/concurrency-settings';
import { db } from '@/lib/db/drizzle';
import { analysisJobs, analysisReports, analysisDecisions, analysisModelCalls, llmModelConfigs, analysisJobResumptions } from '@/lib/db/schema';

type ClaimedJob = typeof analysisJobs.$inferSelect;

type StockDepthReport = {
  key: string;
  title: string;
  relative_path?: string;
  mtime?: number;
  size?: number;
  content: string;
};

type ModelCall = {
  call_id: string; agent: string; model: string;
  failure_reason?: string | null;
  role?: string; model_config_id?: number | null; provider?: string | null;
  started_at: string; ended_at: string | null; status: string;
  input_tokens: number | null; output_tokens: number | null; total_tokens: number | null;
  cached_input_tokens?: number | null; raw_usage?: object | null;
  pricing_snapshot?: object | null; estimated_cost?: string | null; cost_complete?: boolean;
  usage_available: boolean; is_retry: boolean; request_kind: string;
};

type StockDepthRun = {
  status: string;
  report_version?: string;
  reports?: StockDepthReport[];
  runner_log?: string;
  usage?: { calls: ModelCall[]; history_complete: boolean };
};

const tradingAgentsUrl =
  process.env.STOCKDEPTH_API_URL || 'http://127.0.0.1:8008';
const tradingAgentsUsername =
  process.env.STOCKDEPTH_API_USERNAME ||
  process.env.STOCKDEPTH_WEB_USERNAME ||
  'admin';
const tradingAgentsPassword =
  process.env.STOCKDEPTH_API_PASSWORD ||
  process.env.STOCKDEPTH_WEB_PASSWORD ||
  '';
const pollIntervalMs = Number(process.env.ANALYSIS_WORKER_POLL_MS || 5000);
const runTimeoutMs = Number(process.env.ANALYSIS_WORKER_RUN_TIMEOUT_MS || 45 * 60 * 1000);
const runStallTimeoutMs = positiveIntegerFromEnv(
  'ANALYSIS_WORKER_STALL_TIMEOUT_MS',
  20 * 60 * 1000
);
const runHardTimeoutMs = positiveIntegerFromEnv(
  'ANALYSIS_WORKER_HARD_TIMEOUT_MS',
  Math.max(runTimeoutMs * 2, runTimeoutMs + runStallTimeoutMs)
);
const mockMode = process.env.ANALYSIS_WORKER_MOCK === 'true';
const minAvailableMemoryMb = positiveIntegerFromEnv('ANALYSIS_WORKER_MIN_AVAILABLE_MB', 256);
let cachedRuntimeConfig: Awaited<ReturnType<typeof readRuntimeConfig>> | null = null;
let configReadAt = 0;

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

async function readRuntimeConfig() {
  const settings = await getAnalysisConcurrencySettings();

  return {
    workerConcurrency: settings.systemConcurrency,
    systemConcurrency: settings.systemConcurrency,
    userConcurrency: settings.userConcurrency
  };
}

async function loadWorkerRuntimeConfig() {
  if (!cachedRuntimeConfig || Date.now() - configReadAt >= 30000) {
    cachedRuntimeConfig = await readRuntimeConfig();
    configReadAt = Date.now();
  }
  return cachedRuntimeConfig;
}

const resourceMonitor = new ResourceMonitor();
const memorySnapshot = () => resourceMonitor.snapshot();

function authHeader(): Record<string, string> {
  if (!tradingAgentsPassword) {
    return {};
  }
  const token = Buffer.from(
    `${tradingAgentsUsername}:${tradingAgentsPassword}`
  ).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const pidMatchesRun = isAnalysisRunner;

async function terminateExternalRun(job: ClaimedJob) {
  const [freshJob] = await db
    .select()
    .from(analysisJobs)
    .where(ownedAnalysis(job))
    .limit(1);
  const pid = freshJob?.externalPid;
  const runId = runIdFor(job);

  if (!pid || !(await pidMatchesRun(pid, runId))) {
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    await sleep(5000);
    try {
      if (await pidMatchesRun(pid, runId)) process.kill(pid, 'SIGKILL');
    } catch {
      // Process exited after SIGTERM.
    }
    console.log(`Terminated external StockDepth run for analysis job #${job.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to terminate external run for analysis job #${job.id}: ${message}`);
  }
}

function parseAnalysts(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length
      ? parsed
      : ['market', 'news', 'fundamentals'];
  } catch {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function runIdFor(job: ClaimedJob) {
  return job.runId || `legacy-job-${job.id}`;
}

function shouldRestartRecoveredJob(job: ClaimedJob) {
  return (
    !job.externalPid &&
    !['running', 'started', 'already-running'].includes(job.externalStatus || '')
  );
}

async function startStockDepth(job: ClaimedJob) {
  async function configFor(role: 'quick' | 'deep') {
    const snapshot = role === 'quick' ? job.quickConfigSnapshot : job.deepConfigSnapshot;
    if (snapshot) return JSON.parse(snapshot) as typeof llmModelConfigs.$inferSelect;
    const configId = role === 'quick' ? (job.quickModelConfigId || job.modelConfigId) : (job.deepModelConfigId || job.modelConfigId);
    return configId
    ? (
        await db
          .select()
          .from(llmModelConfigs)
          .where(eq(llmModelConfigs.id, configId))
          .limit(1)
      )[0]
    : null;
  }
  const [quickConfig, deepConfig] = await Promise.all([configFor('quick'), configFor('deep')]);

  if (!quickConfig || !deepConfig) {
    throw new Error('任务缺少模型配置快照，无法安全恢复；请重新提交分析。');
  }
  if (!job.quickConfigSnapshot || !job.deepConfigSnapshot) {
    const changedLegacyConfig = [quickConfig, deepConfig].some(config =>
      !config.isActive || !!config.retiredAt || config.updatedAt > job.createdAt ||
      config.provider !== job.provider || config.baseUrl !== job.baseUrl ||
      (config.id === quickConfig.id && job.quickModel && config.modelName !== job.quickModel) ||
      (config.id === deepConfig.id && job.deepModel && config.modelName !== job.deepModel));
    if (changedLegacyConfig) {
      throw new Error('旧任务的模型配置在排队后已变更或停用，系统为避免切换供应商而停止恢复；请重新提交分析。');
    }
  }
  function payloadConfig(config: typeof quickConfig, role: 'quick' | 'deep') {
    if (!config) throw new Error(`${role} model config unavailable`);
    return { id: config.id, provider: config.provider, base_url: config.baseUrl || undefined,
      model: role === 'quick' ? job.quickModel || config.modelName : job.deepModel || config.modelName,
      options: config.modelOptions || {},
      api_key: decryptModelKey(config.apiKey), prices: config.inputPrice == null ? null : {
        currency: 'CNY', unit: 'million_tokens', input: config.inputPrice,
        cache: config.cachePrice, output: config.outputPrice,
      } };
  }

  // Start is sent once; transient read requests use bounded backoff below.
  const response = await fetchWithBackoff(`${tradingAgentsUrl}/api/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader()
    },
    body: JSON.stringify({
      run_id: runIdFor(job),
      job_id: job.id,
      memory_owner: job.userId,
      analyst_concurrency: Number(process.env.STOCKDEPTH_ANALYST_CONCURRENCY || 4),
      max_tool_rounds: Number(process.env.STOCKDEPTH_MAX_TOOL_ROUNDS || 5),
      ticker: job.ticker,
      date: job.tradeDate,
      realtime_data: job.realtimeData,
      language: job.language,
      depth: job.depth,
      analysts: parseAnalysts(job.analysts),
      models: { quick: payloadConfig(quickConfig, 'quick'), deep: payloadConfig(deepConfig, 'deep') },
    })
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `StockDepth start failed: ${response.status}`);
  }
  if (payload.pid) await resourceMonitor.track(payload.pid);

  await db
    .update(analysisJobs)
    .set({
      externalStatus: payload.status,
      externalPid: payload.pid || null,
      updatedAt: new Date()
    })
    .where(ownedAnalysis(job));
}

export async function saveReports(job: ClaimedJob, reports: StockDepthReport[]) {
  await db.transaction(async (tx) => {
    await assertAnalysisOwner(tx, job);
    const decision = reports.find(report => report.key === 'decision');
    if (decision) {
      const values = { ...extractDecision(decision.content), updatedAt: new Date(), extractedAt: new Date() };
      await tx.insert(analysisDecisions).values({ jobId: job.id, ...values }).onConflictDoUpdate({ target: analysisDecisions.jobId, set: values });
    } else {
      await tx.delete(analysisDecisions).where(eq(analysisDecisions.jobId, job.id));
    }
    const existing = await tx.select().from(analysisReports).where(eq(analysisReports.jobId, job.id));
    const remaining = new Map(reports.map(report => [report.key, report]));
    for (const row of existing) {
      const report = remaining.get(row.reportKey);
      if (!report) {
        await tx.delete(analysisReports).where(eq(analysisReports.id, row.id));
        continue;
      }
      remaining.delete(row.reportKey);
      if (!reportMatches(row, report)) {
        await tx.update(analysisReports).set({ ...reportValues(report), updatedAt: new Date() })
          .where(eq(analysisReports.id, row.id));
      }
    }
    if (remaining.size) await tx.insert(analysisReports).values([...remaining.values()].map(report => ({
      jobId: job.id, userId: job.userId, ...reportValues(report)
    })));
  });
}

export async function syncUsage(job: ClaimedJob, run: StockDepthRun, previousCalls: Map<string, string>) {
  if (!run.usage) return;
  await db.transaction(async (tx) => {
    await assertAnalysisOwner(tx, job);
    for (const call of run.usage!.calls) {
      if (previousCalls.get(call.call_id) === JSON.stringify(call)) continue;
      const values = {
        jobId: job.id, callId: call.call_id, agent: call.agent, model: call.model,
        role: call.role || 'legacy', modelConfigId: call.model_config_id ?? null, provider: call.provider ?? null,
        startedAt: new Date(call.started_at), endedAt: call.ended_at ? new Date(call.ended_at) : null,
        status: call.status, inputTokens: call.input_tokens, outputTokens: call.output_tokens,
        totalTokens: call.total_tokens, usageAvailable: call.usage_available,
        isRetry: call.is_retry, requestKind: call.request_kind,
        cachedInputTokens: call.cached_input_tokens ?? null,
        rawUsage: call.raw_usage ? JSON.stringify(call.raw_usage) : null,
        pricingSnapshot: call.pricing_snapshot ? JSON.stringify(call.pricing_snapshot) : null,
        estimatedCost: call.estimated_cost ?? null, costComplete: call.cost_complete ?? false,
      };
      await tx.insert(analysisModelCalls).values(values).onConflictDoUpdate({
        target: [analysisModelCalls.jobId, analysisModelCalls.callId], set: values,
      });
    }
    const [totals] = await tx.select({
      input: sql<number>`coalesce(sum(${analysisModelCalls.inputTokens}), 0)::bigint`,
      output: sql<number>`coalesce(sum(${analysisModelCalls.outputTokens}), 0)::bigint`,
      total: sql<number>`coalesce(sum(${analysisModelCalls.totalTokens}), 0)::bigint`,
      complete: sql<boolean>`coalesce(bool_and(${analysisModelCalls.usageAvailable}), false)`,
    }).from(analysisModelCalls).where(eq(analysisModelCalls.jobId, job.id));
    await tx.update(analysisJobs).set({
      inputTokens: Number(totals.input), outputTokens: Number(totals.output), totalTokens: Number(totals.total),
      tokenUsageComplete: totals.complete && run.usage!.history_complete,
    }).where(ownedAnalysis(job));
  });
  await recordQuotaFailures(job,run.usage.calls,run.status==='failed'?run.runner_log:undefined);
  for (const call of run.usage.calls) previousCalls.set(call.call_id, JSON.stringify(call));
}

function hasFinalDecisionReport(reports: StockDepthReport[]) {
  const reportKeys = new Set(reports.map((report) => report.key));
  return reportKeys.has('decision');
}

function progressSignature(run: StockDepthRun) {
  const reports = run.reports || [];
  return JSON.stringify({
    status: run.status,
    calls: run.usage?.calls,
    historyComplete: run.usage?.history_complete,
    reportVersion: run.report_version,
    reports: reports.map((report) => ({
      key: report.key,
      relativePath: report.relative_path,
      size: report.size ?? report.content?.length ?? 0,
      mtime: report.mtime ?? null
    }))
  });
}

async function finishJob(job: ClaimedJob, status: 'complete' | 'failed', errorMessage?: string) {
  await db
    .update(analysisJobs)
    .set({
      status,
      errorMessage: errorMessage || null,
      completedAt: new Date(),
      workerOwner: null, workerLeaseUntil: null,
      updatedAt: new Date()
    })
    .where(ownedAnalysis(job));
}

function mockReports(job: ClaimedJob): StockDepthReport[] {
  const generatedAt = new Date().toISOString();
  return [
    {
      key: 'market',
      title: 'Market Analyst',
      relative_path: 'mock/market.md',
      content: `# Market Analyst\n\nMock report for ${job.ticker} on ${job.tradeDate}.\n\n- Price trend: sample momentum is neutral.\n- Volume: sample liquidity is normal.\n- This report was generated without calling any LLM or market data API.\n\nGenerated at: ${generatedAt}\n`
    },
    {
      key: 'news',
      title: 'News Analyst',
      relative_path: 'mock/news.md',
      content: `# News Analyst\n\nMock news scan for ${job.ticker}.\n\n- No live news was fetched.\n- Catalyst status: sample watchlist item.\n- Purpose: verify SaaS queue, credit debit, user isolation, and report storage.\n`
    },
    {
      key: 'decision',
      title: 'Portfolio Decision',
      relative_path: 'mock/decision.md',
      content: `# Portfolio Decision\n\nFinal mock decision for ${job.ticker}: Hold.\n\nThis is a dry-run result. It does not represent investment advice and did not consume model quota.\n`
    }
  ];
}

async function processMockJob(job: ClaimedJob) {
  console.log(JSON.stringify({ event: 'mock_execution_start', jobId: job.id }));
  await sleep(positiveIntegerFromEnv('ANALYSIS_WORKER_MOCK_DELAY_MS', 1));
  console.log(`Mock-completing analysis job #${job.id}: ${job.ticker} ${job.tradeDate}`);
  await db
    .update(analysisJobs)
    .set({
      externalStatus: 'mock',
      tokenUsageComplete: true,
      externalPid: null,
      updatedAt: new Date()
    })
    .where(ownedAnalysis(job));
  await saveReports(job, mockReports(job));
  await finishJob(job, 'complete');
  console.log(`Mock completed analysis job #${job.id}`);
  console.log(JSON.stringify({ event: 'mock_execution_end', jobId: job.id }));
}

async function retryUnavailableModels(job: ClaimedJob) {
  if (!(await unavailableJobModels(job)).length) return false;
  // Stop the old runner before publishing the next attempt; its saved siblings
  // remain in the same checkpoint, reports and usage history.
  await terminateExternalRun(job);
  const result = await resumeAnalysisJob(job.userId, job.id, undefined, job.workerOwner || undefined);
  if ('error' in result) {
    if(result.status===409) throw new LostOwnershipError();
    await db.update(analysisJobs).set({externalStatus:'model-unavailable',externalPid:null}).where(ownedAnalysis(job));
    throw new Error(result.error);
  }
  console.log(`Analysis job #${job.id}: unavailable model replaced; queued checkpoint retry`);
  return true;
}

export async function processJob(job: ClaimedJob, options: { startRun?: boolean } = {}) {
  const startRun = options.startRun ?? true;
  console.log(
    `${startRun ? 'Starting' : 'Monitoring'} analysis job #${job.id}: ${job.ticker} ${job.tradeDate}`
  );
  if (mockMode) {
    await processMockJob(job);
    return;
  }

  if (startRun) {
    if (await retryUnavailableModels(job)) return;
    await startStockDepth(job);
  }

  const [resumption] = await db.select({createdAt:analysisJobResumptions.createdAt}).from(analysisJobResumptions).where(eq(analysisJobResumptions.jobId,job.id)).orderBy(desc(analysisJobResumptions.createdAt)).limit(1);
  const startedAt = Math.max(job.startedAt?.getTime() || Date.now(), resumption?.createdAt.getTime() || 0);
  let lastProgressAt = startedAt;
  let lastSignature = '';
  let lastReportsSignature = '';
  let lastUsageSignature = '';
  const previousCalls = new Map<string, string>();
  const query = new URLSearchParams({ run_id: runIdFor(job), ticker: job.ticker, date: job.tradeDate });
  const poller = new RunPoller<NonNullable<StockDepthRun['usage']>>(`${tradingAgentsUrl}/api/run?${query}`, authHeader());

  while (true) {
    await renewAnalysis(job);
    const run = await poller.poll();
    if (!startRun && ['partial', 'empty'].includes(run.status) &&
        (!job.externalPid || !(await pidMatchesRun(job.externalPid, runIdFor(job))))) {
      await db.update(analysisJobs).set({ externalPid: null, externalStatus: 'recovery_waiting',
        workerOwner: null, workerLeaseUntil: null, updatedAt: new Date() }).where(ownedAnalysis(job));
      return; // Re-admit checkpoint restart through all capacity gates.
    }
    if (!startRun && job.externalPid && await pidMatchesRun(job.externalPid, runIdFor(job))) run.status = 'running';
    const reports = run.reports || [];
    const reportsSignature = run.report_version ?? JSON.stringify(reports);
    if (reportsSignature !== lastReportsSignature) {
      await saveReports(job, reports);
      lastReportsSignature = reportsSignature;
    }
    const usageSignature = JSON.stringify(run.usage);
    if (usageSignature !== lastUsageSignature) {
      await syncUsage(job, run, previousCalls);
      lastUsageSignature = usageSignature;
    }

    if (await retryUnavailableModels(job)) return;

    const signature = progressSignature(run);
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastProgressAt = Date.now();
      await db.update(analysisJobs).set({
        externalStatus: run.status,
        updatedAt: new Date()
      }).where(ownedAnalysis(job));
    }

    if (
      run.reportsConsistent && (run.status === 'complete' ||
      (run.status !== 'failed' && !['running', 'started', 'already-running'].includes(run.status) &&
        hasFinalDecisionReport(reports)))
    ) {
      await finishJob(job, 'complete');
      console.log(`Completed analysis job #${job.id}`);
      return;
    }

    if (run.status === 'failed' && run.reportsConsistent) {
      await finishJob(job, 'failed', run.runner_log?.slice(-4000) || 'StockDepth failed');
      console.log(`Failed analysis job #${job.id}`);
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const stalledMs = Date.now() - lastProgressAt;

    if (elapsedMs >= runHardTimeoutMs) {
      await terminateExternalRun(job);
      await db
        .update(analysisJobs)
        .set({
          externalStatus: 'timeout',
          externalPid: null,
          updatedAt: new Date()
        })
        .where(ownedAnalysis(job));
      throw new Error(
        `Analysis job hard timed out after ${Math.round(runHardTimeoutMs / 1000)} seconds`
      );
    }

    if (elapsedMs >= runTimeoutMs && stalledMs >= runStallTimeoutMs) {
      await terminateExternalRun(job);
      await db
        .update(analysisJobs)
        .set({
          externalStatus: 'timeout',
          externalPid: null,
          updatedAt: new Date()
        })
        .where(ownedAnalysis(job));
      throw new Error(
        `Analysis job timed out after ${Math.round(elapsedMs / 1000)} seconds ` +
          `with no progress for ${Math.round(stalledMs / 1000)} seconds`
      );
    }

    await sleep(pollIntervalMs);
  }
}

async function runClaimedJob(job: ClaimedJob, options: { startRun?: boolean } = {}) {
  let lost = false, renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try { await renewAnalysis(job); } catch { lost = true; }
    finally { renewing = false; }
  }, Math.floor(analysisLeaseMs / 3));
  try {
    if (lost) throw new LostOwnershipError();
    await processJob(job, options);
  } catch (error) {
    if (lost || error instanceof LostOwnershipError) {
      console.log(`Stopped monitoring analysis job #${job.id}: ownership changed`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      await finishJob(job, 'failed', message);
      console.error(`Analysis job #${job.id} failed: ${message}`);
    }
  } finally {
    clearInterval(heartbeat);
    await db.update(analysisJobs).set({ workerOwner: null, workerLeaseUntil: null }).where(ownedAnalysis(job));
  }
}

async function main() {
  const runtimeConfig = await loadWorkerRuntimeConfig();
  console.log(
    `Analysis worker started${mockMode ? ' in mock mode' : ''} with concurrency ${runtimeConfig.workerConcurrency}, user concurrency ${runtimeConfig.userConcurrency || 'unlimited'}`
  );
  const activeJobs = new Set<Promise<void>>();
  let lastMetricsAt = 0;

  function trackJob(job: ClaimedJob, options: { startRun?: boolean } = {}) {
    if (job.externalPid) void resourceMonitor.track(job.externalPid);
    const task = runClaimedJob(job, options).finally(() => {
      activeJobs.delete(task);
    });
    activeJobs.add(task);
  }

  while (true) {
    const currentConfig = await loadWorkerRuntimeConfig();
    const memory = await memorySnapshot();
    if (Date.now() - lastMetricsAt >= 30000) {
      const [queue] = await db.execute(sql`select count(*)::int as queued,
        coalesce(extract(epoch from now() at time zone 'UTC' - min(created_at)), 0)::int as oldest_wait_seconds
        from analysis_jobs where status = 'queued'`);
      console.log(JSON.stringify({ event: 'worker_metrics', active: activeJobs.size,
        concurrency: currentConfig.workerConcurrency, userConcurrency: currentConfig.userConcurrency, ...memory, ...queue }));
      lastMetricsAt = Date.now();
    }
    if (memory.availableMb < minAvailableMemoryMb) {
      await sleep(pollIntervalMs);
      continue;
    }

    while (activeJobs.size < currentConfig.workerConcurrency) {
      const recovered = await claimAnalysis(currentConfig, true);
      const job = recovered || await claimAnalysis(currentConfig);
      if (!job) {
        break;
      }

      trackJob(job, { startRun: recovered ? shouldRestartRecoveredJob(job) : true });
    }

    if (activeJobs.size >= currentConfig.workerConcurrency) {
      await Promise.race([...activeJobs, sleep(pollIntervalMs)]);
      continue;
    }

    await sleep(pollIntervalMs);
  }
}

if (basename(process.argv[1] || '') === 'analysis-worker.ts') main().catch((error) => {
  console.error('Analysis worker stopped:', error instanceof Error ? error.name : 'Error');
  process.exit(1);
});
