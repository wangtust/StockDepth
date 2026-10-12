import { and, eq, isNull, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { analysisJobs, analysisReports } from '@/lib/db/schema';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const currentUser = await getUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [job] = await db
    .select()
    .from(analysisJobs)
    .where(
      and(
        eq(analysisJobs.id, id),
        eq(analysisJobs.userId, currentUser.id),
        isNull(analysisJobs.hiddenAt)
      )
    )
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const reports = await db
    .select()
    .from(analysisReports)
    .where(
      and(
        eq(analysisReports.jobId, id),
        eq(analysisReports.userId, currentUser.id)
      )
    )
    .orderBy(analysisReports.id);

  return NextResponse.json({ job, reports });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const [job] = await db.update(analysisJobs)
    .set({ hiddenAt: sql`coalesce(${analysisJobs.hiddenAt}, now())` })
    .where(and(eq(analysisJobs.id, id), eq(analysisJobs.userId, user.id)))
    .returning({ id: analysisJobs.id });
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
