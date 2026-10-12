import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { getUser } from '@/lib/db/queries';
import { watchlistItems } from '@/lib/db/schema';
import { normalizeTicker } from '@/lib/market/tickers';

const watchlistSchema = z.object({
  ticker: z.string().trim().min(1).max(40),
  market: z.string().trim().max(40).optional(),
  name: z.string().trim().max(160).optional()
});

export async function POST(request: NextRequest) {
  const currentUser = await getUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = watchlistSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }

  const ticker = normalizeTicker(parsed.data.ticker);
  const [item] = await db
    .insert(watchlistItems)
    .values({
      userId: currentUser.id,
      ticker,
      market: parsed.data.market || null,
      name: parsed.data.name || null,
      isActive: true,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [watchlistItems.userId, watchlistItems.ticker],
      set: {
        market: parsed.data.market || null,
        name: parsed.data.name || null,
        isActive: true,
        updatedAt: new Date()
      }
    })
    .returning();

  return NextResponse.json({ item }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const currentUser = await getUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get('id'));
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Invalid watchlist item.' }, { status: 400 });
  }

  const [item] = await db
    .update(watchlistItems)
    .set({
      isActive: false,
      updatedAt: new Date()
    })
    .where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, currentUser.id)))
    .returning();

  if (!item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ item });
}
