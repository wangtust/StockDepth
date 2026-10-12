import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { getAnalysisPricingConfig } from '@/lib/analysis/pricing-server';
import { getDefaultModelConfig } from '@/lib/analysis/model-configs-server';
import {
  analysisJobs,
  analysisReports,
  paperAnalysisRuns,
  paperPortfolios,
  paperPositions,
  paperTrades,
  paperTradeDecisions,
  watchlistItems
} from '@/lib/db/schema';

export async function readOriginalPaper(currentUser: {id: number; analysisCredits: number | null}) {
  const [portfolio] = await db
    .select()
    .from(paperPortfolios)
    .where(
      and(
        eq(paperPortfolios.userId, currentUser.id),
        eq(paperPortfolios.status, 'active')
      )
    )
    .orderBy(desc(paperPortfolios.createdAt))
    .limit(1);

  const watchlist = await db
    .select()
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, currentUser.id),
        eq(watchlistItems.isActive, true)
      )
    )
    .orderBy(desc(watchlistItems.createdAt));

  const [pricing, defaultModel] = await Promise.all([
    getAnalysisPricingConfig(),
    getDefaultModelConfig()
  ]);

  if (!portfolio) {
    return ({
      credits: currentUser.analysisCredits ?? 0,
      pricing,
      defaultModel: publicModel(defaultModel),
      portfolio: null,
      watchlist,
      positions: [],
      trades: [],
      analysisRuns: []
    });
  }

  const [positions, trades, analysisRuns] = await Promise.all([
    db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.portfolioId, portfolio.id))
      .orderBy(desc(paperPositions.updatedAt)),
    db
      .select()
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
        reportCount: sql<number>`count(${analysisReports.id})::int`,
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
      .leftJoin(analysisReports, eq(analysisReports.jobId, analysisJobs.id))
      .leftJoin(
        paperTradeDecisions,
        eq(paperTradeDecisions.paperAnalysisRunId, paperAnalysisRuns.id)
      )
      .where(eq(paperAnalysisRuns.portfolioId, portfolio.id))
      .groupBy(paperAnalysisRuns.id, analysisJobs.id, paperTradeDecisions.id)
      .orderBy(desc(paperAnalysisRuns.createdAt))
      .limit(30)
  ]);

  return ({
    credits: currentUser.analysisCredits ?? 0,
    pricing,
    defaultModel: publicModel(defaultModel),
    portfolio,
    watchlist,
    positions,
    trades,
    analysisRuns
  });
}

function publicModel(
  model: Awaited<ReturnType<typeof getDefaultModelConfig>>
) {
  return model
    ? {
        id: model.id,
        name: model.name,
        provider: model.provider,
        modelName: model.modelName,
        isDefault: model.isDefault
      }
    : null;
}
