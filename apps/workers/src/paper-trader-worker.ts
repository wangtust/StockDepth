import '../env';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { claimPaperRun, assertPaperOwner, ownedPaper, renewPaper, expireSubmittedRuns, paperLeaseMs } from './paper-ownership';
import { LostOwnershipError } from './analysis-ownership';
import { readModelConfig } from '@/lib/security/model-key';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  analysisJobs,
  analysisReports,
  llmModelConfigs,
  paperAnalysisRuns,
  paperModelCalls,
  paperPortfolios,
  paperPositions,
  paperTradeDecisions,
} from '@/lib/db/schema';
import { centsFromDecimal } from '@/lib/paper/amount';
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
const modelTimeoutMs = positiveIntegerFromEnv('PAPER_TRADER_MODEL_TIMEOUT_MS', 60000);
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
  return config ? readModelConfig(config) : null;
}

const claimNextRun = claimPaperRun;

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

export async function callDecisionModel(modelConfig: ModelConfig, prompt: string) {
  const baseUrl = modelConfig.baseUrl.replace(/\/$/, '');
  const provider = modelConfig.provider.toLowerCase();
  const options = modelConfig.modelOptions || {};
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let url: string;
  let body: object;
  if (provider === 'anthropic') {
    url = `${baseUrl}/messages`;
    headers['x-api-key'] = modelConfig.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: modelConfig.modelName, max_tokens: Number(options.max_tokens || 1200), temperature: Number(options.temperature ?? 0.1),
      ...(options.top_p != null ? { top_p: Number(options.top_p) } : {}),
      system: 'You are a conservative paper-trading decision engine. Return valid JSON only.',
      messages: [{ role: 'user', content: prompt }] };
  } else if (provider === 'google') {
    url = `${baseUrl}/models/${encodeURIComponent(modelConfig.modelName)}:generateContent`;
    headers['x-goog-api-key'] = modelConfig.apiKey;
    body = { generationConfig: { responseMimeType: 'application/json', temperature: Number(options.temperature ?? 0.1),
        ...(options.max_tokens != null ? { maxOutputTokens: Number(options.max_tokens) } : {}),
        ...(options.top_p != null ? { topP: Number(options.top_p) } : {}) },
      systemInstruction: { parts: [{ text: 'You are a conservative paper-trading decision engine. Return valid JSON only.' }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }] };
  } else {
    url = `${baseUrl}/chat/completions`;
    headers.Authorization = `Bearer ${modelConfig.apiKey}`;
    body = { model: modelConfig.modelName, temperature: Number(options.temperature ?? 0.1),
      ...(options.top_p != null ? { top_p: Number(options.top_p) } : {}),
      ...(options.max_tokens != null ? { max_tokens: Number(options.max_tokens) } : {}),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a conservative paper-trading decision engine. Return valid JSON only.' },
        { role: 'user', content: prompt }
      ] };
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(modelTimeoutMs)
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    const detail = String(payload.error?.message || payload.error || `Decision model failed: ${response.status}`)
      .split(modelConfig.apiKey).join('[redacted]');
    throw new Error(
      detail
    );
  }

  const content = payload.choices?.[0]?.message?.content ?? payload.content?.find((item: any) => item.type === 'text')?.text ?? payload.candidates?.[0]?.content?.parts?.map((item: any) => item.text || '').join('');
  if (!content || typeof content !== 'string') {
    throw new Error('Decision model returned no content');
  }
  return { content, usage: payload.usage || payload.usageMetadata || {} };
}

function paperCost(usage: any, config: ModelConfig) {
  const input = usage.prompt_tokens ?? (usage.input_tokens == null ? null : Number(usage.input_tokens) + Number(usage.cache_read_input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0)) ?? usage.promptTokenCount ?? null;
  const output = usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? null;
  const details = usage.prompt_tokens_details || usage.input_tokens_details || {};
  const cached = usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens ?? details.cached_tokens ?? details.cache_read ?? usage.cachedContentTokenCount ?? null;
  const prices = config.inputPrice != null && config.cachePrice != null && config.outputPrice != null
    ? { currency: 'CNY', unit: 'million_tokens', input: config.inputPrice, cache: config.cachePrice, output: config.outputPrice } : null;
  if (!prices || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) ||
      (cached != null && (!Number.isSafeInteger(cached) || cached < 0 || cached > input)) ||
      usage.cache_creation_input_tokens || (usage.input_tokens_details || {}).cache_creation) {
    return { input, output, cached, prices, cost: null, complete: false };
  }
  const micros = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 1000000n + BigInt((fraction + '000000').slice(0, 6));
  };
  const hit = BigInt(cached || 0);
  const numerator = (BigInt(input - Number(hit)) * micros(String(prices.input))) + hit * micros(String(prices.cache)) + BigInt(output) * micros(String(prices.output));
  const q = numerator / 1000000000000n; const r = (numerator % 1000000000000n).toString().padStart(12, '0');
  return { input, output, cached, prices, cost: `${q}.${r}`, complete: cached != null || prices.input === prices.cache };
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
  return db.transaction(async tx => {
    await assertPaperOwner(tx, run);
    const [saved] = await tx
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
      priceCents: centsFromDecimal(String(decision.suggested_price)),
      reason: decision.reason || null,
      riskNotes: decision.risk_notes || null,
      rawResponse: raw,
      status,
      errorMessage: errorMessage || null
    })
    .onConflictDoNothing()
    .returning();
    await tx.update(paperAnalysisRuns).set({ processingState: status === 'failed' ? 'failed' : 'complete',
      workerOwner: null, workerLeaseUntil: null }).where(ownedPaper(run));
    return saved ?? null;
  });
}

export async function processRun(run: ClaimedRun, modelConfig: ModelConfig) {
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
  const callId = randomUUID();
  const prices = modelConfig.inputPrice == null ? null : JSON.stringify({ currency: 'CNY', unit: 'million_tokens',
    input: modelConfig.inputPrice, cache: modelConfig.cachePrice, output: modelConfig.outputPrice });
  await db.transaction(async tx => {
    await assertPaperOwner(tx, run);
    const rows = await tx.update(paperAnalysisRuns).set({ processingState: 'submitted', modelSubmittedAt: new Date(), modelCallId: callId })
      .where(and(ownedPaper(run), eq(paperAnalysisRuns.processingState, 'claimed'))).returning({ id: paperAnalysisRuns.id });
    if (!rows.length) throw new LostOwnershipError();
    await tx.insert(paperModelCalls).values({ paperRunId: run.id, callId, modelConfigId: modelConfig.id,
      provider: modelConfig.provider, model: modelConfig.modelName, status: 'running', pricingSnapshot: prices });
  });
  let modelResult: Awaited<ReturnType<typeof callDecisionModel>>;
  try {
    modelResult = await callDecisionModel(modelConfig, prompt);
  } catch (error) {
    await db.transaction(async tx => {
      await assertPaperOwner(tx, run);
      await tx.update(paperModelCalls).set({ status: 'failed', endedAt: new Date(), costComplete: false })
        .where(and(eq(paperModelCalls.paperRunId, run.id), eq(paperModelCalls.callId, callId)));
    });
    throw error;
  }
  const raw = modelResult.content;
  const cost = paperCost(modelResult.usage, modelConfig);
  await db.transaction(async tx => {
    await assertPaperOwner(tx, run);
    await tx.update(paperModelCalls).set({ status: 'complete', endedAt: new Date(), inputTokens: cost.input, outputTokens: cost.output,
      cachedInputTokens: cost.cached, rawUsage: JSON.stringify(modelResult.usage),
      estimatedCost: cost.cost, costComplete: cost.complete })
      .where(and(eq(paperModelCalls.paperRunId, run.id), eq(paperModelCalls.callId, callId)));
  });
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
    await expireSubmittedRuns();
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

    let renewing = false;
    const heartbeat = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      try { await renewPaper(run); } catch { /* Fenced on the next write. */ }
      finally { renewing = false; }
    }, Math.floor(paperLeaseMs / 3));
    try {
      await processRun(run, modelConfig);
    } catch (error) {
      if (error instanceof LostOwnershipError) continue;
      const message = (error instanceof Error ? error.message : String(error)).split(modelConfig.apiKey).join('[redacted]');
      console.error(`Paper decision for run #${run.id} failed: ${message}`);
      const decision = fallbackDecision(message);
      await saveDecision({
        run,
        decision,
        raw: JSON.stringify(decision),
        status: 'failed',
        errorMessage: message.slice(0, 4000)
      });
    } finally {
      clearInterval(heartbeat);
    }
  }
}

if (basename(process.argv[1] || '') === 'paper-trader-worker.ts') main().catch((error) => {
  console.error('Paper worker stopped:', error instanceof Error ? error.name : 'Error');
  process.exit(1);
});
