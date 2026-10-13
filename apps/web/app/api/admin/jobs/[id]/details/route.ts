import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdminForApi } from '@/lib/auth/admin';
import { db } from '@/lib/db/drizzle';
import { analysisModelCalls, analysisReports, paperAnalysisRuns, paperModelCalls } from '@/lib/db/schema';
import { RequestTiming } from '@/lib/http/request-timing';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const timing = new RequestTiming();
  const admin = await timing.measure('auth', () => requirePlatformAdminForApi());
  if (admin instanceof NextResponse) return admin;
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const reportKey = request.nextUrl.searchParams.get('report');
  if (reportKey !== null) {
    const [report] = await timing.measure('report', () => db.select({
      id: analysisReports.id, reportKey: analysisReports.reportKey, content: analysisReports.content
    }).from(analysisReports).where(and(eq(analysisReports.jobId, id), eq(analysisReports.reportKey, reportKey))).limit(1));
    return report ? NextResponse.json({ report }, { headers: timing.headers() })
      : NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const calls = await timing.measure('calls', () => db.select({
    callId: analysisModelCalls.callId, agent: analysisModelCalls.agent, model: analysisModelCalls.model,
    role: analysisModelCalls.role, provider: analysisModelCalls.provider, modelConfigId: analysisModelCalls.modelConfigId,
    inputTokens: analysisModelCalls.inputTokens, outputTokens: analysisModelCalls.outputTokens,
    cachedInputTokens: analysisModelCalls.cachedInputTokens, pricingSnapshot: analysisModelCalls.pricingSnapshot,
    estimatedCost: analysisModelCalls.estimatedCost, costComplete: analysisModelCalls.costComplete,
    isRetry: analysisModelCalls.isRetry
  }).from(analysisModelCalls).where(eq(analysisModelCalls.jobId, id)).orderBy(analysisModelCalls.startedAt));
  const paperCalls = await timing.measure('paper_calls', () => db.select({
    callId: paperModelCalls.callId, model: paperModelCalls.model, provider: paperModelCalls.provider,
    modelConfigId: paperModelCalls.modelConfigId, status: paperModelCalls.status,
    inputTokens: paperModelCalls.inputTokens, outputTokens: paperModelCalls.outputTokens,
    cachedInputTokens: paperModelCalls.cachedInputTokens, pricingSnapshot: paperModelCalls.pricingSnapshot,
    estimatedCost: paperModelCalls.estimatedCost, costComplete: paperModelCalls.costComplete,
  }).from(paperModelCalls).innerJoin(paperAnalysisRuns, eq(paperAnalysisRuns.id, paperModelCalls.paperRunId))
    .where(eq(paperAnalysisRuns.analysisJobId, id)).orderBy(paperModelCalls.createdAt));
  return NextResponse.json({ calls, paperCalls }, { headers: timing.headers() });
}
