import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { analysisJobs } from '@/lib/db/schema';

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const jobs = await db.select({
    id: analysisJobs.id,
    ticker: analysisJobs.ticker,
    tradeDate: analysisJobs.tradeDate,
    status: analysisJobs.status,
    hiddenAt: analysisJobs.hiddenAt
  }).from(analysisJobs)
    .where(and(eq(analysisJobs.userId, user.id), isNotNull(analysisJobs.hiddenAt)))
    .orderBy(desc(analysisJobs.hiddenAt))
    .limit(50);
  return NextResponse.json({ jobs });
}
