import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  paperPortfolios,
  paperPositions,
  paperTradeDecisions,
  paperTrades
} from '@/lib/db/schema';

type Portfolio = typeof paperPortfolios.$inferSelect;
type Position = typeof paperPositions.$inferSelect;
type Decision = typeof paperTradeDecisions.$inferSelect;

export type PaperExecutionResult = {
  status: 'executed' | 'skipped';
  message?: string;
};

export async function executePaperDecision({
  decision,
  portfolio,
  positions,
  maxPositionBps = 2000,
  maxTradeBps = 1000
}: {
  decision: Decision;
  portfolio: Portfolio;
  positions: Position[];
  maxPositionBps?: number;
  maxTradeBps?: number;
}): Promise<PaperExecutionResult> {
  if (decision.status === 'executed') {
    return { status: 'skipped', message: 'Decision has already been executed.' };
  }

  if (decision.action === 'hold') {
    await markDecision(decision.id, 'skipped', 'Hold decision.');
    return { status: 'skipped', message: 'Hold decision.' };
  }

  const targetPosition = positions.find((position) => position.ticker === decision.ticker);
  const positionValueCents = positions.reduce(
    (sum, position) => sum + position.quantity * position.lastPriceCents,
    0
  );
  const totalValueCents = portfolio.cashCents + positionValueCents;
  const currentValueCents = targetPosition
    ? targetPosition.quantity * targetPosition.lastPriceCents
    : 0;
  const targetWeight = Math.min(decision.targetWeightBps, maxPositionBps) / 10000;
  const targetValueCents = Math.floor(totalValueCents * targetWeight);
  const maxTradeValueCents = Math.floor(totalValueCents * (maxTradeBps / 10000));
  const priceCents = decision.priceCents || targetPosition?.lastPriceCents || 0;

  if (!priceCents) {
    await markDecision(decision.id, 'skipped', 'No usable price for simulated execution.');
    return { status: 'skipped', message: 'No usable price for simulated execution.' };
  }

  if (decision.action === 'buy') {
    const desiredSpendCents = Math.max(0, targetValueCents - currentValueCents);
    const spendCents = Math.min(desiredSpendCents, maxTradeValueCents, portfolio.cashCents);
    const modelQuantity = decision.quantity > 0 ? decision.quantity : Number.MAX_SAFE_INTEGER;
    const quantity = Math.min(modelQuantity, Math.floor(spendCents / priceCents));

    if (quantity <= 0) {
      await markDecision(decision.id, 'skipped', 'Risk checks reduced buy quantity to zero.');
      return { status: 'skipped', message: 'Risk checks reduced buy quantity to zero.' };
    }

    await executeBuy({ decision, portfolio, position: targetPosition, quantity, priceCents });
    return { status: 'executed' };
  }

  if (decision.action === 'sell') {
    if (!targetPosition || targetPosition.quantity <= 0) {
      await markDecision(decision.id, 'skipped', 'No shares available to sell.');
      return { status: 'skipped', message: 'No shares available to sell.' };
    }

    const desiredSellCents = Math.max(0, currentValueCents - targetValueCents);
    const maxSharesByValue = Math.floor(Math.min(desiredSellCents, maxTradeValueCents) / priceCents);
    const modelQuantity = decision.quantity > 0 ? decision.quantity : Number.MAX_SAFE_INTEGER;
    const quantity = Math.min(modelQuantity, maxSharesByValue, targetPosition.quantity);

    if (quantity <= 0) {
      await markDecision(decision.id, 'skipped', 'Risk checks reduced sell quantity to zero.');
      return { status: 'skipped', message: 'Risk checks reduced sell quantity to zero.' };
    }

    await executeSell({ decision, portfolio, position: targetPosition, quantity, priceCents });
    return { status: 'executed' };
  }

  await markDecision(decision.id, 'skipped', `Unsupported action: ${decision.action}`);
  return { status: 'skipped', message: `Unsupported action: ${decision.action}` };
}

async function executeBuy({
  decision,
  portfolio,
  position,
  quantity,
  priceCents
}: {
  decision: Decision;
  portfolio: Portfolio;
  position?: Position;
  quantity: number;
  priceCents: number;
}) {
  await db.transaction(async (tx) => {
    const grossAmountCents = quantity * priceCents;
    const oldQuantity = position?.quantity || 0;
    const oldCostCents = oldQuantity * (position?.avgCostCents || 0);
    const newQuantity = oldQuantity + quantity;
    const avgCostCents = Math.round((oldCostCents + grossAmountCents) / newQuantity);

    const [updatedPosition] = position
      ? await tx
          .update(paperPositions)
          .set({
            quantity: newQuantity,
            avgCostCents,
            lastPriceCents: priceCents,
            updatedAt: new Date()
          })
          .where(eq(paperPositions.id, position.id))
          .returning()
      : await tx
          .insert(paperPositions)
          .values({
            portfolioId: portfolio.id,
            userId: decision.userId,
            ticker: decision.ticker,
            quantity,
            avgCostCents,
            lastPriceCents: priceCents
          })
          .returning();

    await tx
      .update(paperPortfolios)
      .set({
        cashCents: sql`${paperPortfolios.cashCents} - ${grossAmountCents}`,
        updatedAt: new Date()
      })
      .where(eq(paperPortfolios.id, portfolio.id));

    await tx.insert(paperTrades).values({
      portfolioId: portfolio.id,
      userId: decision.userId,
      positionId: updatedPosition.id,
      ticker: decision.ticker,
      side: 'buy',
      quantity,
      priceCents,
      grossAmountCents,
      note: `Paper trade from decision #${decision.id}`
    });

    await tx
      .update(paperTradeDecisions)
      .set({
        status: 'executed',
        quantity,
        priceCents,
        executedAt: new Date(),
        errorMessage: null
      })
      .where(eq(paperTradeDecisions.id, decision.id));
  });
}

async function executeSell({
  decision,
  portfolio,
  position,
  quantity,
  priceCents
}: {
  decision: Decision;
  portfolio: Portfolio;
  position: Position;
  quantity: number;
  priceCents: number;
}) {
  await db.transaction(async (tx) => {
    const grossAmountCents = quantity * priceCents;
    const realizedPnlCents = (priceCents - position.avgCostCents) * quantity;

    await tx
      .update(paperPositions)
      .set({
        quantity: position.quantity - quantity,
        lastPriceCents: priceCents,
        realizedPnlCents: sql`${paperPositions.realizedPnlCents} + ${realizedPnlCents}`,
        updatedAt: new Date()
      })
      .where(eq(paperPositions.id, position.id));

    await tx
      .update(paperPortfolios)
      .set({
        cashCents: sql`${paperPortfolios.cashCents} + ${grossAmountCents}`,
        updatedAt: new Date()
      })
      .where(eq(paperPortfolios.id, portfolio.id));

    await tx.insert(paperTrades).values({
      portfolioId: portfolio.id,
      userId: decision.userId,
      positionId: position.id,
      ticker: decision.ticker,
      side: 'sell',
      quantity,
      priceCents,
      grossAmountCents,
      realizedPnlCents,
      note: `Paper trade from decision #${decision.id}`
    });

    await tx
      .update(paperTradeDecisions)
      .set({
        status: 'executed',
        quantity,
        priceCents,
        executedAt: new Date(),
        errorMessage: null
      })
      .where(eq(paperTradeDecisions.id, decision.id));
  });
}

async function markDecision(id: number, status: string, message: string) {
  await db
    .update(paperTradeDecisions)
    .set({
      status,
      errorMessage: message,
      executedAt: null
    })
    .where(eq(paperTradeDecisions.id, id));
}
