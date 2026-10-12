import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdminForApi } from '@/lib/auth/admin';
import { db } from '@/lib/db/drizzle';
import { analysisModelCalls, analysisReports } from '@/lib/db/schema';
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
    inputTokens: analysisModelCalls.inputTokens, outputTokens: analysisModelCalls.outputTokens,
    cachedInputTokens: analysisModelCalls.cachedInputTokens, pricingSnapshot: analysisModelCalls.pricingSnapshot,
    estimatedCost: analysisModelCalls.estimatedCost, costComplete: analysisModelCalls.costComplete,
    isRetry: analysisModelCalls.isRetry
  }).from(analysisModelCalls).where(eq(analysisModelCalls.jobId, id)).orderBy(analysisModelCalls.startedAt));
  return NextResponse.json({ calls }, { headers: timing.headers() });
}
