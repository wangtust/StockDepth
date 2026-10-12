import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { getUser } from '@/lib/db/queries';
import {
  paperPortfolios,
  paperPositions,
  paperTradeDecisions
} from '@/lib/db/schema';
import { executePaperDecision } from '@/lib/paper/execution';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const currentUser = await getUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Invalid decision.' }, { status: 400 });
  }

  const [decision] = await db
    .select()
    .from(paperTradeDecisions)
    .where(
      and(
        eq(paperTradeDecisions.id, id),
        eq(paperTradeDecisions.userId, currentUser.id)
      )
    )
    .limit(1);

  if (!decision) {
    return NextResponse.json({ error: 'Decision not found.' }, { status: 404 });
  }

  if (!['proposed', 'skipped'].includes(decision.status)) {
    return NextResponse.json(
      { error: `Decision cannot be executed from status ${decision.status}.` },
      { status: 400 }
    );
  }

  const [portfolio] = await db
    .select()
    .from(paperPortfolios)
    .where(
      and(
        eq(paperPortfolios.id, decision.portfolioId),
        eq(paperPortfolios.userId, currentUser.id),
        eq(paperPortfolios.status, 'active')
      )
    )
    .limit(1);

  if (!portfolio) {
    return NextResponse.json({ error: 'Portfolio not found.' }, { status: 404 });
  }

  const positions = await db
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.portfolioId, portfolio.id));

  const result = await executePaperDecision({
    decision,
    portfolio,
    positions
  });

  return NextResponse.json(result);
}
