import { and, eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { getUser } from '@/lib/db/queries';
import { paperPortfolios, paperPositions, paperTrades } from '@/lib/db/schema';

const createPortfolioSchema = z.object({
  name: z.string().trim().min(1).max(120).default('Paper Portfolio'),
  initialCash: z.coerce.number().positive().max(1_000_000_000)
});

function toCents(value: number) {
  return Math.round(value * 100);
}

export async function POST(request: NextRequest) {
  const currentUser = await getUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createPortfolioSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }

  const initialCashCents = toCents(parsed.data.initialCash);
  try {
    const portfolio = await db.transaction(async (tx) => {
      const [existingPortfolio] = await tx
        .select({ id: paperPortfolios.id })
        .from(paperPortfolios)
        .where(
          and(
            eq(paperPortfolios.userId, currentUser.id),
            eq(paperPortfolios.status, 'active')
          )
        )
        .limit(1);

      if (existingPortfolio) {
        const [usage] = await tx
          .select({
            positions: sql<number>`count(distinct ${paperPositions.id})::int`,
            trades: sql<number>`count(distinct ${paperTrades.id})::int`
          })
          .from(paperPortfolios)
          .leftJoin(
            paperPositions,
            eq(paperPositions.portfolioId, paperPortfolios.id)
          )
          .leftJoin(paperTrades, eq(paperTrades.portfolioId, paperPortfolios.id))
          .where(eq(paperPortfolios.id, existingPortfolio.id));

        if ((usage?.positions || 0) > 0 || (usage?.trades || 0) > 0) {
          throw new Error(
            'An active paper portfolio with trading history already exists.'
          );
        }

        const [updatedPortfolio] = await tx
          .update(paperPortfolios)
          .set({
            name: parsed.data.name,
            initialCashCents,
            cashCents: initialCashCents,
            updatedAt: new Date()
          })
          .where(eq(paperPortfolios.id, existingPortfolio.id))
          .returning();

        return updatedPortfolio;
      }

      const [createdPortfolio] = await tx
        .insert(paperPortfolios)
        .values({
          userId: currentUser.id,
          name: parsed.data.name,
          initialCashCents,
          cashCents: initialCashCents
        })
        .returning();

      return createdPortfolio;
    });

    return NextResponse.json({ portfolio }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Portfolio setup failed.' },
      { status: 400 }
    );
  }
}
