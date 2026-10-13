import { publicAnalysisJob } from '@/lib/analysis/public-job';
import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { analysisJobs } from '@/lib/db/schema';

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
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [job] = await db
    .update(analysisJobs)
    .set({
      status: 'queued',
      workerOwner: null, workerLeaseUntil: null,
      externalStatus: 'resume-queued',
      externalPid: null,
      errorMessage: null,
      completedAt: null,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(analysisJobs.id, id),
        eq(analysisJobs.userId, currentUser.id),
        isNull(analysisJobs.hiddenAt),
        eq(analysisJobs.status, 'failed')
      )
    )
    .returning();

  if (!job) {
    return NextResponse.json(
      { error: 'Only failed analysis jobs can be continued' },
      { status: 409 }
    );
  }

  return NextResponse.json({ job: publicAnalysisJob(job) });
}
