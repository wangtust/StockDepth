import '../env';
import { readFile } from 'node:fs/promises';
import { asc, eq, sql } from 'drizzle-orm';
import { getAnalysisConcurrencySettings } from '@/lib/analysis/concurrency-settings';
import { db } from '@/lib/db/drizzle';
import { analysisJobs, analysisReports, llmModelConfigs } from '@/lib/db/schema';

type ClaimedJob = typeof analysisJobs.$inferSelect;

type StockDepthReport = {
  key: string;
  title: string;
  relative_path?: string;
  mtime?: number;
  size?: number;
  content: string;
};

type StockDepthRun = {
  status: string;
  reports?: StockDepthReport[];
  runner_log?: string;
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
const maxWorkerConcurrency = positiveIntegerFromEnv(
  'ANALYSIS_WORKER_MAX_CONCURRENCY',
  4
);
const mockMode = process.env.ANALYSIS_WORKER_MOCK === 'true';

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

async function loadWorkerRuntimeConfig() {
  const settings = await getAnalysisConcurrencySettings();

  return {
    workerConcurrency: Math.min(settings.systemConcurrency, maxWorkerConcurrency),
    userConcurrency: settings.userConcurrency
  };
}

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

async function pidMatchesRun(pid: number, runId: string) {
  try {
    const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8');
    const args = cmdline.split('\0').filter(Boolean);
    return (
      args.some((arg) => arg.endsWith('analysis_runner.py')) &&
      args.includes('--run-id') &&
      args.includes(runId)
    );
  } catch {
    return false;
  }
}

async function terminateExternalRun(job: ClaimedJob) {
  const [freshJob] = await db
    .select()
    .from(analysisJobs)
    .where(eq(analysisJobs.id, job.id))
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
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
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

async function claimNextJob(userConcurrency: number): Promise<ClaimedJob | null> {
  const userConcurrencyCondition =
    userConcurrency <= 0
      ? sql`true`
      : sql`(
          select count(*)
          from analysis_jobs running_jobs
          where running_jobs.user_id = ${analysisJobs.userId}
            and running_jobs.status = 'running'
        ) < ${userConcurrency}`;

  const [claimed] = await db
    .update(analysisJobs)
    .set({
      status: 'running',
      startedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      eq(
        analysisJobs.id,
        sql<number>`(
          select ${analysisJobs.id}
          from ${analysisJobs}
          where ${analysisJobs.status} = 'queued'
            and ${userConcurrencyCondition}
          order by ${analysisJobs.createdAt} asc
          for update skip locked
          limit 1
        )`
      )
    )
    .returning();

  return claimed ?? null;
}

async function recoverRunningJobs(): Promise<ClaimedJob[]> {
  return db
    .select()
    .from(analysisJobs)
    .where(eq(analysisJobs.status, 'running'))
    .orderBy(asc(analysisJobs.startedAt), asc(analysisJobs.createdAt));
}

function shouldRestartRecoveredJob(job: ClaimedJob) {
  return (
    !job.externalPid &&
    !['running', 'started', 'already-running'].includes(job.externalStatus || '')
  );
}

async function startStockDepth(job: ClaimedJob) {
  const modelConfig = job.modelConfigId
    ? (
        await db
          .select()
          .from(llmModelConfigs)
          .where(eq(llmModelConfigs.id, job.modelConfigId))
          .limit(1)
      )[0]
    : null;

  if (!modelConfig || !modelConfig.isActive) {
    throw new Error('任务没有可用的数据库模型配置，请管理员配置模型后重新提交分析。');
  }

  const response = await fetch(`${tradingAgentsUrl}/api/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader()
    },
    body: JSON.stringify({
      run_id: runIdFor(job),
      ticker: job.ticker,
      date: job.tradeDate,
      realtime_data: job.realtimeData,
      language: job.language,
      depth: job.depth,
      analysts: parseAnalysts(job.analysts),
      provider: modelConfig.provider,
      base_url: modelConfig.baseUrl || undefined,
      quick_model: modelConfig.quickModel,
      deep_model: modelConfig.deepModel,
      api_key: modelConfig.apiKey
    })
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `StockDepth start failed: ${response.status}`);
  }

  await db
    .update(analysisJobs)
    .set({
      externalStatus: payload.status,
      externalPid: payload.pid || null,
      updatedAt: new Date()
    })
    .where(eq(analysisJobs.id, job.id));
}

async function fetchRun(job: ClaimedJob): Promise<StockDepthRun> {
  const query = new URLSearchParams({
    run_id: runIdFor(job),
    ticker: job.ticker,
    date: job.tradeDate
  });
  const response = await fetch(`${tradingAgentsUrl}/api/run?${query}`, {
    headers: authHeader()
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `StockDepth run fetch failed: ${response.status}`);
  }
  return payload;
}

async function saveReports(job: ClaimedJob, reports: StockDepthReport[]) {
  await db.transaction(async (tx) => {
    await tx
      .delete(analysisReports)
      .where(eq(analysisReports.jobId, job.id));

    if (reports.length) {
      await tx.insert(analysisReports).values(
        reports.map((report) => ({
          jobId: job.id,
          userId: job.userId,
          reportKey: report.key,
          title: report.title,
          relativePath: report.relative_path || null,
          content: report.content || ''
        }))
      );
    }
  });
}

function hasFinalDecisionReport(reports: StockDepthReport[]) {
  const reportKeys = new Set(reports.map((report) => report.key));
  return reportKeys.has('decision');
}

function progressSignature(run: StockDepthRun) {
  const reports = run.reports || [];
  return JSON.stringify({
    status: run.status,
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
      updatedAt: new Date()
    })
    .where(eq(analysisJobs.id, job.id));
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
  console.log(`Mock-completing analysis job #${job.id}: ${job.ticker} ${job.tradeDate}`);
  await db
    .update(analysisJobs)
    .set({
      externalStatus: 'mock',
      externalPid: null,
      updatedAt: new Date()
    })
    .where(eq(analysisJobs.id, job.id));
  await saveReports(job, mockReports(job));
  await finishJob(job, 'complete');
  console.log(`Mock completed analysis job #${job.id}`);
}

async function processJob(job: ClaimedJob, options: { startRun?: boolean } = {}) {
  const startRun = options.startRun ?? true;
  console.log(
    `${startRun ? 'Starting' : 'Monitoring'} analysis job #${job.id}: ${job.ticker} ${job.tradeDate}`
  );
  if (mockMode) {
    await processMockJob(job);
    return;
  }

  if (startRun) {
    await startStockDepth(job);
  }

  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let lastSignature = '';

  while (true) {
    const run = await fetchRun(job);
    const reports = run.reports || [];
    await saveReports(job, reports);

    const signature = progressSignature(run);
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastProgressAt = Date.now();
    }

    await db
      .update(analysisJobs)
      .set({
        externalStatus: run.status,
        updatedAt: new Date()
      })
      .where(eq(analysisJobs.id, job.id));

    if (
      run.status === 'complete' ||
      (!['running', 'started', 'already-running'].includes(run.status) &&
        hasFinalDecisionReport(reports))
    ) {
      await finishJob(job, 'complete');
      console.log(`Completed analysis job #${job.id}`);
      return;
    }

    if (run.status === 'failed') {
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
        .where(eq(analysisJobs.id, job.id));
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
        .where(eq(analysisJobs.id, job.id));
      throw new Error(
        `Analysis job timed out after ${Math.round(elapsedMs / 1000)} seconds ` +
          `with no progress for ${Math.round(stalledMs / 1000)} seconds`
      );
    }

    await sleep(pollIntervalMs);
  }
}

async function runClaimedJob(job: ClaimedJob, options: { startRun?: boolean } = {}) {
  try {
    await processJob(job, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishJob(job, 'failed', message);
    console.error(`Analysis job #${job.id} failed: ${message}`);
  }
}

async function main() {
  const runtimeConfig = await loadWorkerRuntimeConfig();
  console.log(
    `Analysis worker started${mockMode ? ' in mock mode' : ''} with concurrency ${runtimeConfig.workerConcurrency}, user concurrency ${runtimeConfig.userConcurrency || 'unlimited'}`
  );
  const activeJobs = new Set<Promise<void>>();

  function trackJob(job: ClaimedJob, options: { startRun?: boolean } = {}) {
    const task = runClaimedJob(job, options).finally(() => {
      activeJobs.delete(task);
    });
    activeJobs.add(task);
  }

  const recoveredJobs = await recoverRunningJobs();
  if (recoveredJobs.length) {
    console.log(`Recovering ${recoveredJobs.length} running analysis job(s)`);
    for (const job of recoveredJobs) {
      trackJob(job, { startRun: shouldRestartRecoveredJob(job) });
    }
  }

  while (true) {
    const currentConfig = await loadWorkerRuntimeConfig();

    while (activeJobs.size < currentConfig.workerConcurrency) {
      const job = await claimNextJob(currentConfig.userConcurrency);
      if (!job) {
        break;
      }

      trackJob(job);
    }

    if (activeJobs.size >= currentConfig.workerConcurrency) {
      await Promise.race(activeJobs);
      continue;
    }

    await sleep(pollIntervalMs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
