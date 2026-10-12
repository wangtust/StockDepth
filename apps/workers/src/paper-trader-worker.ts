import '../env';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  analysisJobs,
  analysisReports,
  llmModelConfigs,
  paperAnalysisRuns,
  paperPortfolios,
  paperPositions,
  paperTradeDecisions,
} from '@/lib/db/schema';
import { paperMarketContext } from '@/lib/paper/market-context';
import { executePaperDecision } from '@/lib/paper/execution';

type ClaimedRun = typeof paperAnalysisRuns.$inferSelect & {
  analysisJob: typeof analysisJobs.$inferSelect;
};

type Position = typeof paperPositions.$inferSelect;
type Portfolio = typeof paperPortfolios.$inferSelect;
type ModelConfig = typeof llmModelConfigs.$inferSelect;

type DecisionJson = {
  action?: string;
  confidence?: number;
  target_weight?: number;
  quantity?: number;
  suggested_price?: number;
  reason?: string;
  risk_notes?: string;
};

const pollIntervalMs = positiveIntegerFromEnv('PAPER_TRADER_WORKER_POLL_MS', 10000);
const maxReportsChars = positiveIntegerFromEnv('PAPER_TRADER_MAX_REPORT_CHARS', 18000);
const forceAutoExecute = process.env.PAPER_TRADER_AUTO_EXECUTE === 'true';
const maxPositionBps = positiveIntegerFromEnv('PAPER_TRADER_MAX_POSITION_BPS', 2000);
const maxTradeBps = positiveIntegerFromEnv('PAPER_TRADER_MAX_TRADE_BPS', 1000);
const minConfidenceBps = positiveIntegerFromEnv('PAPER_TRADER_MIN_CONFIDENCE_BPS', 6000);

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDefaultModelConfig() {
  const [config] = await db
    .select()
    .from(llmModelConfigs)
    .where(and(eq(llmModelConfigs.isActive, true), isNull(llmModelConfigs.retiredAt)))
    .orderBy(sql`${llmModelConfigs.isDefault} desc`, asc(llmModelConfigs.id))
    .limit(1);
  return config ?? null;
}

async function claimNextRun(): Promise<ClaimedRun | null> {
  const [run] = await db
    .select({
      id: paperAnalysisRuns.id,
      portfolioId: paperAnalysisRuns.portfolioId,
      userId: paperAnalysisRuns.userId,
      watchlistItemId: paperAnalysisRuns.watchlistItemId,
      analysisJobId: paperAnalysisRuns.analysisJobId,
      ticker: paperAnalysisRuns.ticker,
      context: paperAnalysisRuns.context,
      createdAt: paperAnalysisRuns.createdAt,
      analysisJob: analysisJobs
    })
    .from(paperAnalysisRuns)
    .innerJoin(analysisJobs, eq(analysisJobs.id, paperAnalysisRuns.analysisJobId))
    .leftJoin(
      paperTradeDecisions,
      eq(paperTradeDecisions.paperAnalysisRunId, paperAnalysisRuns.id)
    )
    .where(
      and(
        or(
          eq(analysisJobs.status, 'complete'),
          and(
            eq(analysisJobs.status, 'failed'),
            eq(analysisJobs.externalStatus, 'timeout'),
            sql`exists (
              select 1
              from ${analysisReports} usable_reports
              where usable_reports.job_id = ${analysisJobs.id}
                and usable_reports.report_key in ('trader', 'complete')
            )`
          )
        ),
        isNull(paperTradeDecisions.id)
      )
    )
    .orderBy(asc(paperAnalysisRuns.createdAt))
    .limit(1);

  return run ?? null;
}

async function getPortfolio(run: ClaimedRun) {
  const [portfolio] = await db
    .select()
    .from(paperPortfolios)
    .where(
      and(
        eq(paperPortfolios.id, run.portfolioId),
        eq(paperPortfolios.userId, run.userId),
        eq(paperPortfolios.status, 'active')
      )
    )
    .limit(1);
  return portfolio ?? null;
}

async function getPositions(run: ClaimedRun) {
  return db
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.portfolioId, run.portfolioId));
}

async function getReports(run: ClaimedRun) {
  return db
    .select()
    .from(analysisReports)
    .where(eq(analysisReports.jobId, run.analysisJobId))
    .orderBy(analysisReports.id);
}

function formatReports(reports: (typeof analysisReports.$inferSelect)[]) {
  const text = reports
    .map((report) => `## ${report.title}\n\n${report.content}`)
    .join('\n\n---\n\n');
  return text.length > maxReportsChars ? `${text.slice(0, maxReportsChars)}\n\n[truncated]` : text;
}

async function buildPrompt({
  run,
  portfolio,
  positions,
  reports
}: {
  run: ClaimedRun;
  portfolio: Portfolio;
  positions: Position[];
  reports: string;
}) {
  const marketContext = await paperMarketContext(positions,portfolio.currency,portfolio.cashCents);
  const targetPosition = marketContext.positions.find(position=>position.ticker===run.ticker);

  return `You are a paper-trading decision engine. You do not give financial advice. You convert research reports into a conservative simulated-trading proposal.

Return only compact JSON with this exact shape:
{"action":"buy|sell|hold","confidence":0.0,"target_weight":0.0,"quantity":0,"suggested_price":0,"reason":"...","risk_notes":"..."}

Hard constraints:
- action must be buy, sell, or hold.
- confidence is 0.0 to 1.0.
- target_weight is 0.0 to ${maxPositionBps / 10000}.
- Never short. If uncertain, action must be hold.
- Prefer hold unless the reports clearly support a change.
- quantity may be 0 when action is hold or when there is insufficient price/cash context.
- suggested_price is a model suggestion only, never a verified market quote or fill price. Use 0 when unavailable.
- Only shared quotes with valid valuationStatus are market marks. Null totalValueCents means incomplete valuation; never treat missing assets as zero.

Portfolio context:
${JSON.stringify({
  ticker: run.ticker,
  initialCashCents: portfolio.initialCashCents,
  ...marketContext,
  maxPositionBps,
  maxTradeBps,
  minConfidenceBps,
  targetPosition,
  storedPaperContext: run.context ? safeJsonParse(run.context) : null
})}

StockDepth reports:
${reports}`;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function callDecisionModel(modelConfig: ModelConfig, prompt: string) {
  const baseUrl = modelConfig.baseUrl.replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${modelConfig.apiKey}`
    },
    body: JSON.stringify({
      model: modelConfig.modelName,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a conservative paper-trading decision engine. Return valid JSON only.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error?.message || payload.error || `Decision model failed: ${response.status}`
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('Decision model returned no content');
  }
  return content;
}

function parseDecision(raw: string): Required<DecisionJson> {
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw) as DecisionJson;
  const action = ['buy', 'sell', 'hold'].includes(String(parsed.action))
    ? String(parsed.action)
    : 'hold';
  const confidence = clampNumber(parsed.confidence ?? 0, 0, 1);
  const targetWeight = clampNumber(parsed.target_weight ?? 0, 0, maxPositionBps / 10000);
  const quantity = Math.max(0, Math.floor(Number(parsed.quantity || 0)));
  const suggestedPrice = Math.max(0, Number(parsed.suggested_price || 0));

  return {
    action,
    confidence,
    target_weight: targetWeight,
    quantity,
    suggested_price: suggestedPrice,
    reason: String(parsed.reason || '').slice(0, 4000),
    risk_notes: String(parsed.risk_notes || '').slice(0, 4000)
  };
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function bps(value: number) {
  return Math.round(value * 10000);
}

async function saveDecision({
  run,
  decision,
  raw,
  status,
  errorMessage
}: {
  run: ClaimedRun;
  decision: Required<DecisionJson>;
  raw: string;
  status: string;
  errorMessage?: string;
}) {
  const [saved] = await db
    .insert(paperTradeDecisions)
    .values({
      portfolioId: run.portfolioId,
      userId: run.userId,
      paperAnalysisRunId: run.id,
      analysisJobId: run.analysisJobId,
      ticker: run.ticker,
      action: decision.action,
      confidenceBps: bps(decision.confidence),
      targetWeightBps: bps(decision.target_weight),
      quantity: decision.quantity,
      priceCents: Math.round(decision.suggested_price * 100),
      reason: decision.reason || null,
      riskNotes: decision.risk_notes || null,
      rawResponse: raw,
      status,
      errorMessage: errorMessage || null
    })
    .onConflictDoNothing()
    .returning();
  return saved ?? null;
}

async function processRun(run: ClaimedRun, modelConfig: ModelConfig) {
  const [portfolio, positions, reports] = await Promise.all([
    getPortfolio(run),
    getPositions(run),
    getReports(run)
  ]);

  if (!portfolio) {
    const decision = fallbackDecision('Portfolio not found.');
    await saveDecision({
      run,
      decision,
      raw: JSON.stringify(decision),
      status: 'failed',
      errorMessage: 'Portfolio not found.'
    });
    return;
  }

  if (!reports.length) {
    const decision = fallbackDecision('No reports were saved for this analysis job.');
    await saveDecision({
      run,
      decision,
      raw: JSON.stringify(decision),
      status: 'failed',
      errorMessage: 'No reports were saved for this analysis job.'
    });
    return;
  }

  const prompt = await buildPrompt({
    run,
    portfolio,
    positions,
    reports: formatReports(reports)
  });
  const raw = await callDecisionModel(modelConfig, prompt);
  const decision = parseDecision(raw);
  const confidenceBps = bps(decision.confidence);
  const status =
    decision.action === 'hold' || confidenceBps < minConfidenceBps
      ? 'skipped'
      : forceAutoExecute || portfolio.autoTradeEnabled
        ? 'proposed'
        : 'proposed';

  const savedDecision = await saveDecision({
    run,
    decision:
      confidenceBps < minConfidenceBps
        ? { ...decision, action: 'hold', quantity: 0 }
        : decision,
    raw,
    status,
    errorMessage:
      confidenceBps < minConfidenceBps
        ? `Confidence below ${minConfidenceBps / 100}% threshold.`
        : undefined
  });

  if (
    (forceAutoExecute || portfolio.autoTradeEnabled) &&
    savedDecision &&
    confidenceBps >= minConfidenceBps &&
    decision.action !== 'hold'
  ) {
    await executePaperDecision({
      decision: savedDecision,
      portfolio,
      positions,
      maxPositionBps,
      maxTradeBps
    });
  }

  console.log(
    `Created paper decision for run #${run.id} (${run.ticker}): ${decision.action}, confidence ${decision.confidence}`
  );
}

function fallbackDecision(reason: string): Required<DecisionJson> {
  return {
    action: 'hold',
    confidence: 0,
    target_weight: 0,
    quantity: 0,
    suggested_price: 0,
    reason,
    risk_notes: reason
  };
}

async function main() {
  console.log(
    `Paper trader worker started with forceAutoExecute=${forceAutoExecute}, minConfidence=${minConfidenceBps / 100}%`
  );

  while (true) {
    const modelConfig = await getDefaultModelConfig();
    if (!modelConfig) {
      console.log('No active model config available for paper trader worker.');
      await sleep(pollIntervalMs);
      continue;
    }

    const run = await claimNextRun();
    if (!run) {
      await sleep(pollIntervalMs);
      continue;
    }

    try {
      await processRun(run, modelConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Paper decision for run #${run.id} failed: ${message}`);
      const decision = fallbackDecision(message);
      await saveDecision({
        run,
        decision,
        raw: JSON.stringify(decision),
        status: 'failed',
        errorMessage: message.slice(0, 4000)
      });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
