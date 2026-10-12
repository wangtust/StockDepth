import Link from 'next/link';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import { db } from '@/lib/db/drizzle';
import { analysisJobs, users } from '@/lib/db/schema';
import { cancelAnalysisJob, retryAnalysisJob } from '@/app/admin/actions';
import {
  formatAdminDate,
  formatAdminDateTime,
  formatElapsed,
  StatusBadge
} from '@/app/admin/_components/admin-ui';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ status?: string; q?: string }>;
};

const statusOptions = ['all', 'queued', 'running', 'complete', 'failed'];

async function retryAnalysisJobAction(formData: FormData) {
  'use server';
  await retryAnalysisJob(formData);
}

async function cancelAnalysisJobAction(formData: FormData) {
  'use server';
  await cancelAnalysisJob(formData);
}

export default async function AdminJobsPage({ searchParams }: PageProps) {
  await requirePlatformAdmin();
  const { status = 'all', q = '' } = await searchParams;
  const statusFilter = statusOptions.includes(status) ? status : 'all';
  const query = q.trim();

  const whereParts = [];
  if (statusFilter !== 'all') {
    whereParts.push(eq(analysisJobs.status, statusFilter));
  }
  if (query) {
    whereParts.push(
      or(
        ilike(analysisJobs.ticker, `%${query}%`),
        ilike(users.email, `%${query}%`)
      )
    );
  }

  const rows = await db
    .select({
      id: analysisJobs.id,
      ticker: analysisJobs.ticker,
      tradeDate: analysisJobs.tradeDate,
      status: analysisJobs.status,
      hiddenAt: analysisJobs.hiddenAt,
      externalStatus: analysisJobs.externalStatus,
      externalPid: analysisJobs.externalPid,
      errorMessage: analysisJobs.errorMessage,
      createdAt: analysisJobs.createdAt,
      startedAt: analysisJobs.startedAt,
      completedAt: analysisJobs.completedAt,
      userEmail: users.email
    })
    .from(analysisJobs)
    .leftJoin(users, eq(analysisJobs.userId, users.id))
    .where(whereParts.length ? and(...whereParts) : undefined)
    .orderBy(desc(analysisJobs.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Analysis Jobs</h1>
          <p className="mt-1 text-sm text-slate-600">
            Inspect queue state, retry failures, and cancel queued or running jobs.
          </p>
        </div>
        <form className="flex flex-wrap gap-2" action="/admin/jobs">
          <select
            name="status"
            defaultValue={statusFilter}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <Input name="q" placeholder="Ticker or user" defaultValue={query} />
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
      </div>

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-3 pr-4">Job</th>
                  <th className="py-3 pr-4">Owner</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Timing</th>
                  <th className="py-3 pr-4">Error</th>
                  <th className="py-3 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((job) => (
                  <tr key={job.id}>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-950">
                        #{job.id} {job.ticker}
                      </div>
                      <div className="text-xs text-slate-500">{job.tradeDate}</div>
                      <Button asChild size="sm" variant="outline" className="mt-2">
                        <Link href={`/admin/jobs/${job.id}`}>View Report</Link>
                      </Button>
                    </td>
                    <td className="py-3 pr-4">
                      <div>{job.userEmail || 'Unknown user'}</div>
                    </td>
                    <td className="py-3 pr-4">
                        <StatusBadge status={job.status} />
                        {job.hiddenAt && <span className="ml-2 text-xs text-slate-500">用户已删除</span>}
                      <div className="text-xs text-slate-500">
                        {job.externalStatus || 'no external status'}
                        {job.externalPid ? ` · pid ${job.externalPid}` : ''}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-600">
                      <div>Created {formatAdminDateTime(job.createdAt)}</div>
                      {job.startedAt && <div>Started {formatAdminDate(job.startedAt)}</div>}
                      {job.completedAt && (
                        <div>Completed {formatAdminDate(job.completedAt)}</div>
                      )}
                      <div className="mt-1 font-medium text-slate-700">
                        {job.status === 'running'
                          ? `Running ${formatElapsed(job.startedAt || job.createdAt)}`
                          : job.completedAt
                            ? `Took ${formatElapsed(job.startedAt || job.createdAt, job.completedAt)}`
                            : 'Not finished'}
                      </div>
                    </td>
                    <td className="max-w-[320px] py-3 pr-4">
                      <p className="line-clamp-4 text-xs text-red-700">
                        {job.errorMessage || ''}
                      </p>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-2">
                        {job.status === 'failed' && (
                          <form action={retryAnalysisJobAction}>
                            <input type="hidden" name="jobId" value={job.id} />
                            <Button type="submit" size="sm" variant="outline">
                              Retry
                            </Button>
                          </form>
                        )}
                        {['queued', 'running'].includes(job.status) && (
                          <form action={cancelAnalysisJobAction}>
                            <input type="hidden" name="jobId" value={job.id} />
                            <Button type="submit" size="sm" variant="destructive">
                              Cancel
                            </Button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
