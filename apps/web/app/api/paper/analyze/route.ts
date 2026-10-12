import { ensureInstrument } from '@/lib/market/catalogue';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { getUser } from '@/lib/db/queries';
import { getDefaultModelConfig } from '@/lib/analysis/model-configs-server';
import { getDepthCreditCostFromDb } from '@/lib/analysis/pricing-server';
import {
  analysisJobs,
  creditTransactions,
  paperAnalysisRuns,
  paperPortfolios,
  paperPositions,
  users,
  watchlistItems
} from '@/lib/db/schema';
import { normalizeTicker } from '@/lib/market/tickers';

const analyzeSchema = z.object({
  portfolioId: z.coerce.number().int().positive(),
  watchlistItemIds: z.array(z.coerce.number().int().positive()).min(1).max(20),
  tradeDate: z.string().trim().min(8).max(20).optional(),
  realtimeData: z.coerce.boolean().default(true),
  language: z.string().trim().min(1).max(40).default('Chinese'),
  depth: z.coerce.number().int().refine((value) => [1, 3, 5].includes(value)),
  analysts: z.array(z.string()).min(1).default(['market', 'social', 'news', 'fundamentals'])
});

function today() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export async function POST(request: NextRequest) {
  const currentUser = await getUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = analyzeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const modelConfig = await getDefaultModelConfig();
  if (!modelConfig) {
    return NextResponse.json(
      { error: 'No active model config is available. Please ask an admin to configure a model.' },
      { status: 400 }
    );
  }

  const creditCost = await getDepthCreditCostFromDb(data.depth);
  const uniqueItemIds = [...new Set(data.watchlistItemIds)];
  const totalCreditCost = creditCost * uniqueItemIds.length;
  const tradeDate = data.tradeDate || today();

  const [portfolio] = await db
    .select()
    .from(paperPortfolios)
    .where(
      and(
        eq(paperPortfolios.id, data.portfolioId),
        eq(paperPortfolios.userId, currentUser.id),
        eq(paperPortfolios.status, 'active')
      )
    )
    .limit(1);

  if (!portfolio) {
    return NextResponse.json({ error: 'Portfolio not found.' }, { status: 404 });
  }

  const [items, positions] = await Promise.all([
    db
      .select()
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, currentUser.id),
          eq(watchlistItems.isActive, true),
          inArray(watchlistItems.id, uniqueItemIds)
        )
      ),
    db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.portfolioId, portfolio.id))
  ]);

  if (items.length !== uniqueItemIds.length) {
    return NextResponse.json(
      { error: 'One or more selected stocks are no longer in your watchlist.' },
      { status: 400 }
    );
  }

  const jobs = await db.transaction(async (tx) => {
    const [updatedUser] = await tx
      .update(users)
      .set({
        analysisCredits: sql`${users.analysisCredits} - ${totalCreditCost}`,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(users.id, currentUser.id),
          gte(users.analysisCredits, totalCreditCost)
        )
      )
      .returning({ analysisCredits: users.analysisCredits });

    if (!updatedUser) {
      return null;
    }

    const createdJobs = [];
    for (const item of items) {
      const ticker = normalizeTicker(item.ticker);
      const context = buildPortfolioContext({
        portfolio,
        positions,
        targetTicker: ticker,
        watchlist: items.map((watchlistItem) => watchlistItem.ticker)
      });

      const instrument = await ensureInstrument(ticker, tx);
      const [createdJob] = await tx
        .insert(analysisJobs)
        .values({
          runId: `saas-job-${randomUUID()}`,
          userId: currentUser.id,
          ticker,
          instrumentId: instrument.id,
          tradeDate,
          realtimeData: data.realtimeData,
          language: data.language,
          depth: data.depth,
          analysts: JSON.stringify(data.analysts),
          provider: modelConfig.provider,
          baseUrl: modelConfig.baseUrl,
          quickModel: modelConfig.modelName,
          deepModel: modelConfig.modelName,
          modelConfigId: modelConfig.id,
          status: 'queued'
        })
        .returning();

      await tx.insert(creditTransactions).values({
        userId: currentUser.id,
        jobId: createdJob.id,
        amount: -creditCost,
        reason: 'paper_portfolio_analysis'
      });

      await tx.insert(paperAnalysisRuns).values({
        portfolioId: portfolio.id,
        userId: currentUser.id,
        watchlistItemId: item.id,
        analysisJobId: createdJob.id,
        ticker,
        context
      });

      createdJobs.push(createdJob);
    }

    return {
      jobs: createdJobs,
      creditCost,
      totalCreditCost,
      remainingCredits: updatedUser.analysisCredits
    };
  });

  if (!jobs) {
    return NextResponse.json(
      { error: `Not enough analysis credits. This batch costs ${totalCreditCost} credits.` },
      { status: 402 }
    );
  }

  return NextResponse.json(jobs, { status: 201 });
}

function buildPortfolioContext({
  portfolio,
  positions,
  targetTicker,
  watchlist
}: {
  portfolio: typeof paperPortfolios.$inferSelect;
  positions: (typeof paperPositions.$inferSelect)[];
  targetTicker: string;
  watchlist: string[];
}) {
  const positionValueCents = positions.reduce(
    (sum, position) => sum + position.quantity * position.lastPriceCents,
    0
  );
  const totalValueCents = portfolio.cashCents + positionValueCents;
  const targetPosition = positions.find((position) => position.ticker === targetTicker);

  return JSON.stringify({
    targetTicker,
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      currency: portfolio.currency,
      cashCents: portfolio.cashCents,
      initialCashCents: portfolio.initialCashCents,
      totalValueCents
    },
    targetPosition: targetPosition
      ? {
          ticker: targetPosition.ticker,
          quantity: targetPosition.quantity,
          avgCostCents: targetPosition.avgCostCents,
          lastPriceCents: targetPosition.lastPriceCents,
          realizedPnlCents: targetPosition.realizedPnlCents,
          marketValueCents: targetPosition.quantity * targetPosition.lastPriceCents,
          weight:
            totalValueCents > 0
              ? (targetPosition.quantity * targetPosition.lastPriceCents) / totalValueCents
              : 0
        }
      : null,
    positions: positions.map((position) => ({
      ticker: position.ticker,
      quantity: position.quantity,
      avgCostCents: position.avgCostCents,
      lastPriceCents: position.lastPriceCents,
      marketValueCents: position.quantity * position.lastPriceCents,
      realizedPnlCents: position.realizedPnlCents
    })),
    watchlist
  });
}
