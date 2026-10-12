import { and, eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { getUser } from '@/lib/db/queries';
import {
  paperPortfolios,
  paperPositions,
  paperTrades
} from '@/lib/db/schema';
import { normalizeTicker } from '@/lib/market/tickers';

const tradeSchema = z.object({
  portfolioId: z.coerce.number().int().positive(),
  ticker: z.string().trim().min(1).max(40),
  side: z.enum(['buy', 'sell']),
  quantity: z.coerce.number().int().positive().max(10_000_000),
  price: z.coerce.number().positive().max(10_000_000),
  note: z.string().trim().max(500).optional()
});

function toCents(value: number) {
  return Math.round(value * 100);
}

export async function POST(request: NextRequest) {
  const currentUser = await getUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = tradeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const ticker = normalizeTicker(data.ticker);
  const priceCents = toCents(data.price);
  const grossAmountCents = data.quantity * priceCents;

  try {
    const result = await db.transaction(async (tx) => {
      const [portfolio] = await tx
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
        throw new Error('Portfolio not found.');
      }

      const [existingPosition] = await tx
        .select()
        .from(paperPositions)
        .where(
          and(
            eq(paperPositions.portfolioId, portfolio.id),
            eq(paperPositions.ticker, ticker)
          )
        )
        .limit(1);

      if (data.side === 'buy') {
        if (portfolio.cashCents < grossAmountCents) {
          throw new Error('Not enough cash for this trade.');
        }

        const oldQuantity = existingPosition?.quantity || 0;
        const oldCostCents = oldQuantity * (existingPosition?.avgCostCents || 0);
        const newQuantity = oldQuantity + data.quantity;
        const avgCostCents = Math.round(
          (oldCostCents + grossAmountCents) / newQuantity
        );

        const [position] = existingPosition
          ? await tx
              .update(paperPositions)
              .set({
                quantity: newQuantity,
                avgCostCents,
                lastPriceCents: priceCents,
                updatedAt: new Date()
              })
              .where(eq(paperPositions.id, existingPosition.id))
              .returning()
          : await tx
              .insert(paperPositions)
              .values({
                portfolioId: portfolio.id,
                userId: currentUser.id,
                ticker,
                quantity: data.quantity,
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

        const [trade] = await tx
          .insert(paperTrades)
          .values({
            portfolioId: portfolio.id,
            userId: currentUser.id,
            positionId: position.id,
            ticker,
            side: data.side,
            quantity: data.quantity,
            priceCents,
            grossAmountCents,
            note: data.note || null
          })
          .returning();

        return { trade, position };
      }

      if (!existingPosition || existingPosition.quantity < data.quantity) {
        throw new Error('Not enough shares for this sale.');
      }

      const realizedPnlCents =
        (priceCents - existingPosition.avgCostCents) * data.quantity;
      const newQuantity = existingPosition.quantity - data.quantity;
      const [position] = await tx
        .update(paperPositions)
        .set({
          quantity: newQuantity,
          lastPriceCents: priceCents,
          realizedPnlCents:
            sql`${paperPositions.realizedPnlCents} + ${realizedPnlCents}`,
          updatedAt: new Date()
        })
        .where(eq(paperPositions.id, existingPosition.id))
        .returning();

      await tx
        .update(paperPortfolios)
        .set({
          cashCents: sql`${paperPortfolios.cashCents} + ${grossAmountCents}`,
          updatedAt: new Date()
        })
        .where(eq(paperPortfolios.id, portfolio.id));

      const [trade] = await tx
        .insert(paperTrades)
        .values({
          portfolioId: portfolio.id,
          userId: currentUser.id,
          positionId: existingPosition.id,
          ticker,
          side: data.side,
          quantity: data.quantity,
          priceCents,
          grossAmountCents,
          realizedPnlCents,
          note: data.note || null
        })
        .returning();

      return { trade, position };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Trade failed.' },
      { status: 400 }
    );
  }
}
