import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { analysisJobs } from '@/lib/db/schema';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [job] = await db.update(analysisJobs).set({ hiddenAt: null })
    .where(and(eq(analysisJobs.id, id), eq(analysisJobs.userId, user.id)))
    .returning({ id: analysisJobs.id });
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
