import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { getUser } from '@/lib/db/queries';
import { paperPortfolios } from '@/lib/db/schema';

const settingsSchema = z.object({
  portfolioId: z.coerce.number().int().positive(),
  autoTradeEnabled: z.coerce.boolean()
});

export async function PATCH(request: NextRequest) {
  const currentUser = await getUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = settingsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }

  const [portfolio] = await db
    .update(paperPortfolios)
    .set({
      autoTradeEnabled: parsed.data.autoTradeEnabled,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(paperPortfolios.id, parsed.data.portfolioId),
        eq(paperPortfolios.userId, currentUser.id),
        eq(paperPortfolios.status, 'active')
      )
    )
    .returning();

  if (!portfolio) {
    return NextResponse.json({ error: 'Portfolio not found.' }, { status: 404 });
  }

  return NextResponse.json({ portfolio });
}
