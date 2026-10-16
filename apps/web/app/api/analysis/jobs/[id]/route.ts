import { resumptionHistory } from '@/lib/analysis/resumption-history';
import { jobModelFields } from '@/lib/analysis/job-models';
import { RequestTiming } from '@/lib/http/request-timing';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { analysisJobs, analysisReports } from '@/lib/db/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timing = new RequestTiming();
  const currentUser = await timing.measure('auth', () => getUser());
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const reportKey = request.nextUrl.searchParams.get('report');
  if (reportKey !== null) {
    if (!reportKey || reportKey.length > 80) return NextResponse.json({ error: 'Invalid report' }, { status: 400 });
    const [report] = await timing.measure('report', () => db.select({
      id: analysisReports.id, reportKey: analysisReports.reportKey,
      title: analysisReports.title, content: analysisReports.content
    }).from(analysisReports).innerJoin(analysisJobs, eq(analysisJobs.id, analysisReports.jobId))
      .where(and(eq(analysisJobs.id, id), eq(analysisJobs.userId, currentUser.id),
        isNull(analysisJobs.hiddenAt), eq(analysisReports.userId, currentUser.id),
        eq(analysisReports.reportKey, reportKey))).limit(1));
    return report ? NextResponse.json({ report }, { headers: timing.headers() })
      : NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [job] = await timing.measure('job', () => db
    .select({
      id: analysisJobs.id, ticker: analysisJobs.ticker, status: analysisJobs.status,
      quickModelConfigId: jobModelFields.quickModelConfigId, deepModelConfigId: jobModelFields.deepModelConfigId,
      quickModelVersionId: analysisJobs.quickModelVersionId, deepModelVersionId: analysisJobs.deepModelVersionId,
      configurationState: analysisJobs.configurationState, chargedCredits: analysisJobs.chargedCredits,
      externalStatus: analysisJobs.externalStatus, errorMessage: analysisJobs.errorMessage,
      hiddenAt: analysisJobs.hiddenAt,
      startedAt: analysisJobs.startedAt, completedAt: analysisJobs.completedAt,
      updatedAt: analysisJobs.updatedAt, inputTokens: analysisJobs.inputTokens,
      outputTokens: analysisJobs.outputTokens, totalTokens: analysisJobs.totalTokens,
      tokenUsageComplete: analysisJobs.tokenUsageComplete,
      reports: sql`coalesce((select json_agg(json_build_object('id', r.id, 'reportKey', r.report_key,
        'title', r.title, 'updatedAt', r.updated_at at time zone 'UTC') order by r.id)
        from analysis_reports r where r.job_id = analysis_jobs.id and r.user_id = ${currentUser.id}), '[]'::json)`,
      resumptions: resumptionHistory(currentUser.id),
      calls: sql`coalesce((select json_agg(json_build_object('callId', c.call_id, 'agent', c.agent,
        'model', c.model, 'role', c.role, 'provider', c.provider, 'modelConfigId', c.model_config_id,
        'modelVersionId', c.model_version_id, 'costCurrency', c.cost_currency,
        'status', c.status, 'startedAt', c.started_at,
        'endedAt', c.ended_at, 'inputTokens', c.input_tokens,
        'outputTokens', c.output_tokens, 'totalTokens', c.total_tokens, 'cachedInputTokens', c.cached_input_tokens,
        'usageAvailable', c.usage_available, 'isRetry', c.is_retry, 'requestKind', c.request_kind)
        order by c.started_at) from analysis_model_calls c where c.job_id = analysis_jobs.id), '[]'::json)`
    })
    .from(analysisJobs)
    .where(
      and(
        eq(analysisJobs.id, id),
        eq(analysisJobs.userId, currentUser.id),
        isNull(analysisJobs.hiddenAt)
      )
    )
    .limit(1));

  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { reports, calls, resumptions, ...summary } = job;
  return NextResponse.json({ job: summary, reports, calls, resumptions }, { headers: { ...timing.headers(), 'Cache-Control': 'private, no-store' } });
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
