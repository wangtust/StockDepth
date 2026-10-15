import 'server-only';
import { enrichPositions } from '../market/service';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { getAnalysisPricingConfig } from '@/lib/analysis/pricing-server';
import {
  analysisJobs,
  paperAnalysisRuns,
  paperPortfolios,
  paperPositions,
  paperTrades,
  paperTradeDecisions,
  llmModelConfigs,
  watchlistItems
} from '@/lib/db/schema';

const portfolioFields = {
  id: paperPortfolios.id,
  userId: paperPortfolios.userId,
  name: paperPortfolios.name,
  initialCashCents: paperPortfolios.initialCashCents,
  cashCents: paperPortfolios.cashCents,
  currency: paperPortfolios.currency,
  status: paperPortfolios.status,
  autoTradeEnabled: paperPortfolios.autoTradeEnabled,
  createdAt: paperPortfolios.createdAt,
  updatedAt: paperPortfolios.updatedAt,
};

const watchlistFields = {
  id: watchlistItems.id,
  userId: watchlistItems.userId,
  instrumentId: watchlistItems.instrumentId,
  ticker: watchlistItems.ticker,
  market: watchlistItems.market,
  name: watchlistItems.name,
  isActive: watchlistItems.isActive,
  createdAt: watchlistItems.createdAt,
  updatedAt: watchlistItems.updatedAt,
};

const positionFields = {
  id: paperPositions.id,
  portfolioId: paperPositions.portfolioId,
  userId: paperPositions.userId,
  instrumentId: paperPositions.instrumentId,
  ticker: paperPositions.ticker,
  quantity: paperPositions.quantity,
  avgCostCents: paperPositions.avgCostCents,
  lastPriceCents: paperPositions.lastPriceCents,
  realizedPnlCents: paperPositions.realizedPnlCents,
  createdAt: paperPositions.createdAt,
  updatedAt: paperPositions.updatedAt,
};

const tradeFields = {
  id: paperTrades.id,
  portfolioId: paperTrades.portfolioId,
  userId: paperTrades.userId,
  positionId: paperTrades.positionId,
  instrumentId: paperTrades.instrumentId,
  priceSnapshotId: paperTrades.priceSnapshotId,
  executionPrice: paperTrades.executionPrice,
  ticker: paperTrades.ticker,
  side: paperTrades.side,
  quantity: paperTrades.quantity,
  priceCents: paperTrades.priceCents,
  grossAmountCents: paperTrades.grossAmountCents,
  feeCents: paperTrades.feeCents,
  realizedPnlCents: paperTrades.realizedPnlCents,
  note: paperTrades.note,
  createdAt: paperTrades.createdAt,
};

const modelFields = {
  id: llmModelConfigs.id,
  name: llmModelConfigs.name,
  provider: llmModelConfigs.provider,
  modelName: llmModelConfigs.modelName,
  isDefault: llmModelConfigs.isDefault,
};

export async function readPaperOverview(userId: number) {
  const [portfolios, watchlist, pricing, models] = await Promise.all([
    db.select({
      ...portfolioFields,
      hasActiveAnalysisRuns: sql<boolean>`exists (
        select 1 from paper_analysis_runs r
        join analysis_jobs j on j.id = r.analysis_job_id
        where r.portfolio_id = paper_portfolios.id and j.status in ('queued', 'running')
      )`
    }).from(paperPortfolios)
      .where(and(eq(paperPortfolios.userId, userId), eq(paperPortfolios.status, 'active')))
      .orderBy(desc(paperPortfolios.createdAt)).limit(1),
    db.select(watchlistFields).from(watchlistItems)
      .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.isActive, true)))
      .orderBy(desc(watchlistItems.createdAt)),
    getAnalysisPricingConfig(),
    db.select(modelFields).from(llmModelConfigs)
      .where(and(eq(llmModelConfigs.isActive, true), isNull(llmModelConfigs.retiredAt), isNull(llmModelConfigs.unavailableReason)))
      .orderBy(desc(llmModelConfigs.isDefault), asc(llmModelConfigs.id)).limit(1)
  ]);
  const { hasActiveAnalysisRuns = false, ...portfolio } = portfolios[0] ?? {};
  return { portfolio: portfolios[0] ? portfolio : null, hasActiveAnalysisRuns,
    watchlist, pricing, defaultModel: models[0] ?? null };
}

export async function readPaperDetails(portfolio: { id: number; currency?: string }) {
  return Promise.all([
    db
      .select(positionFields)
      .from(paperPositions)
      .where(eq(paperPositions.portfolioId, portfolio.id))
      .orderBy(desc(paperPositions.updatedAt)).then(rows=>enrichPositions(rows,portfolio.currency??'USD')),
    db
      .select(tradeFields)
      .from(paperTrades)
      .where(eq(paperTrades.portfolioId, portfolio.id))
      .orderBy(desc(paperTrades.createdAt))
      .limit(50),
    db
      .select({
        id: paperAnalysisRuns.id,
        ticker: paperAnalysisRuns.ticker,
        createdAt: paperAnalysisRuns.createdAt,
        context: paperAnalysisRuns.context,
        watchlistItemId: paperAnalysisRuns.watchlistItemId,
        jobId: analysisJobs.id,
        runId: analysisJobs.runId,
        tradeDate: analysisJobs.tradeDate,
        realtimeData: analysisJobs.realtimeData,
        depth: analysisJobs.depth,
        status: analysisJobs.status,
        externalStatus: analysisJobs.externalStatus,
        errorMessage: analysisJobs.errorMessage,
        updatedAt: analysisJobs.updatedAt,
        reportCount: sql<number>`(select count(*)::int from analysis_reports where job_id = ${analysisJobs.id})`,
        decisionId: paperTradeDecisions.id,
        decisionAction: paperTradeDecisions.action,
        decisionConfidenceBps: paperTradeDecisions.confidenceBps,
        decisionTargetWeightBps: paperTradeDecisions.targetWeightBps,
        decisionQuantity: paperTradeDecisions.quantity,
        decisionPriceCents: paperTradeDecisions.priceCents,
        decisionReason: paperTradeDecisions.reason,
        decisionRiskNotes: paperTradeDecisions.riskNotes,
        decisionStatus: paperTradeDecisions.status,
        decisionErrorMessage: paperTradeDecisions.errorMessage,
        decisionCreatedAt: paperTradeDecisions.createdAt
      })
      .from(paperAnalysisRuns)
      .innerJoin(analysisJobs, eq(analysisJobs.id, paperAnalysisRuns.analysisJobId))
      .leftJoin(
        paperTradeDecisions,
        eq(paperTradeDecisions.paperAnalysisRunId, paperAnalysisRuns.id)
      )
      .where(eq(paperAnalysisRuns.portfolioId, portfolio.id))
      .orderBy(desc(paperAnalysisRuns.createdAt), desc(paperAnalysisRuns.id))
      .limit(30)
  ]);

}
