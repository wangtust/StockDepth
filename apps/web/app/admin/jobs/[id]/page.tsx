import { LiveAnalysisRefresh } from '@/components/live-analysis-refresh';
import { ModelCosts } from '@/app/admin/_components/model-costs';
import { AnalysisUsage, AnalysisTimer } from '@/components/analysis-usage';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { ArrowLeft, RefreshCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import { db } from '@/lib/db/drizzle';
import { analysisJobs, analysisReports, analysisModelCalls, users } from '@/lib/db/schema';
import { cancelAnalysisJob, retryAnalysisJob } from '@/app/admin/actions';
import {
  formatAdminDateTime,
  StatusBadge
} from '@/app/admin/_components/admin-ui';
import { AdminReportViewer } from '@/app/admin/jobs/[id]/admin-report-viewer';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ report?: string }>;
};

async function retryAnalysisJobAction(formData: FormData) {
  'use server';
  await retryAnalysisJob(formData);
}

async function cancelAnalysisJobAction(formData: FormData) {
  'use server';
  await cancelAnalysisJob(formData);
}

function parseAnalysts(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join(', ') : value;
  } catch {
    return value;
  }
}

export default async function AdminJobDetailPage({ params, searchParams }: PageProps) {
  await requirePlatformAdmin();

  const { id } = await params;
  const { report: selectedReportParam } = await searchParams;
  const jobId = Number(id);

  if (!Number.isInteger(jobId) || jobId <= 0) {
    notFound();
  }

  const [job] = await db
    .select({
      id: analysisJobs.id,
      runId: analysisJobs.runId,
      ticker: analysisJobs.ticker,
      tradeDate: analysisJobs.tradeDate,
      language: analysisJobs.language,
      depth: analysisJobs.depth,
      analysts: analysisJobs.analysts,
      provider: analysisJobs.provider,
      quickModel: analysisJobs.quickModel,
      deepModel: analysisJobs.deepModel,
      status: analysisJobs.status,
      hiddenAt: analysisJobs.hiddenAt,
      externalStatus: analysisJobs.externalStatus,
      externalPid: analysisJobs.externalPid,
      errorMessage: analysisJobs.errorMessage,
      createdAt: analysisJobs.createdAt,
      inputTokens: analysisJobs.inputTokens,
      outputTokens: analysisJobs.outputTokens,
      totalTokens: analysisJobs.totalTokens,
      tokenUsageComplete: analysisJobs.tokenUsageComplete,
      startedAt: analysisJobs.startedAt,
      completedAt: analysisJobs.completedAt,
      updatedAt: analysisJobs.updatedAt,
      userId: users.id,
      userEmail: users.email
    })
    .from(analysisJobs)
    .leftJoin(users, eq(analysisJobs.userId, users.id))
    .where(eq(analysisJobs.id, jobId))
    .limit(1);

  if (!job) {
    notFound();
  }

  const calls = await db.select().from(analysisModelCalls).where(eq(analysisModelCalls.jobId, jobId)).orderBy(analysisModelCalls.startedAt);

  const reports = await db
    .select({
      id: analysisReports.id,
      reportKey: analysisReports.reportKey,
      title: analysisReports.title,
      relativePath: analysisReports.relativePath,
      content: analysisReports.content,
      updatedAt: analysisReports.updatedAt
    })
    .from(analysisReports)
    .where(and(eq(analysisReports.jobId, jobId), eq(analysisReports.userId, job.userId!)))
    .orderBy(analysisReports.id);

  const selectedReport =
    reports.find((report) => report.reportKey === selectedReportParam) || reports[0];
  const facts: Array<[string, string]> = [
    ['Owner', job.userEmail || `User #${job.userId || '-'}`],
    ['Language', job.language],
    ['Depth', String(job.depth)],
    ['Analysts', parseAnalysts(job.analysts)],
    ['Provider', job.provider || 'not set'],
    ['Quick', job.quickModel || 'not set'],
    ['Deep', job.deepModel || 'not set'],
    ['External', job.externalStatus || 'no external status'],
    ['PID', job.externalPid ? String(job.externalPid) : 'no pid']
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Button asChild variant="ghost" className="-ml-3 mb-2">
            <Link href="/admin/jobs">
              <ArrowLeft className="h-4 w-4" />
              Jobs
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-950">
              Trading Analysis Report: {job.ticker}
            </h1>
            <StatusBadge status={job.status} />
            {job.hiddenAt && <span className="text-sm text-slate-500">用户已删除（仅用户列表隐藏）</span>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Job #{job.id} · {job.tradeDate} · {reports.length} sections · <AnalysisTimer job={job} />
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {job.status === 'failed' && (
            <form action={retryAnalysisJobAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <Button type="submit" variant="outline">
                <RefreshCcw className="h-4 w-4" />
                Retry
              </Button>
            </form>
          )}
          {['queued', 'running'].includes(job.status) && (
            <form action={cancelAnalysisJobAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <Button type="submit" variant="destructive">
                <XCircle className="h-4 w-4" />
                Cancel
              </Button>
            </form>
          )}
        </div>
      </div>

      <ModelCosts calls={calls} usageComplete={job.tokenUsageComplete} />
      <AnalysisUsage job={job} calls={calls} />
      <AdminReportViewer
        reports={reports.map((report) => ({
          id: report.id,
          reportKey: report.reportKey,
          title: report.title,
          relativePath: report.relativePath,
          content: report.content,
          updatedAtLabel: formatAdminDateTime(report.updatedAt)
        }))}
        initialReportKey={selectedReport?.reportKey}
        title={`Trading Analysis Report: ${job.ticker}`}
        subtitle="Waiting for the worker to sync report content."
        facts={[
          ...facts,
          ['Created', formatAdminDateTime(job.createdAt)],
          ['Started', formatAdminDateTime(job.startedAt)],
          ['Completed', formatAdminDateTime(job.completedAt)]
        ]}
      />

      {job.errorMessage && (
        <Card className="rounded-md border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-800">Error Message</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words text-sm text-red-800">
              {job.errorMessage}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
