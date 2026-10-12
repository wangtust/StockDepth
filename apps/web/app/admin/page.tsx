import { desc, eq, sql } from 'drizzle-orm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import { db } from '@/lib/db/drizzle';
import {
  adminAuditLogs,
  analysisJobs,
  users
} from '@/lib/db/schema';
import { formatAdminDateTime } from '@/app/admin/_components/admin-ui';

export const dynamic = 'force-dynamic';

async function scalarCount(table: any) {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
  return row?.count ?? 0;
}

export default async function AdminOverviewPage() {
  await requirePlatformAdmin();

  const [
    userCount,
    activeUserCount,
    jobStatusRows,
    creditRows,
    recentFailures,
    recentAuditLogs
  ] = await Promise.all([
    scalarCount(users),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.status, 'active')),
    db
      .select({
        status: analysisJobs.status,
        count: sql<number>`count(*)::int`
      })
      .from(analysisJobs)
      .groupBy(analysisJobs.status)
      .orderBy(analysisJobs.status),
    db
      .select({
        totalCredits: sql<number>`coalesce(sum(${users.analysisCredits}), 0)::int`
      })
      .from(users),
    db
      .select({
        id: analysisJobs.id,
        ticker: analysisJobs.ticker,
        status: analysisJobs.status,
        errorMessage: analysisJobs.errorMessage,
        completedAt: analysisJobs.completedAt,
        userEmail: users.email
      })
      .from(analysisJobs)
      .leftJoin(users, eq(analysisJobs.userId, users.id))
      .where(eq(analysisJobs.status, 'failed'))
      .orderBy(desc(analysisJobs.completedAt))
      .limit(5),
    db
      .select({
        id: adminAuditLogs.id,
        action: adminAuditLogs.action,
        targetType: adminAuditLogs.targetType,
        targetId: adminAuditLogs.targetId,
        createdAt: adminAuditLogs.createdAt,
        adminEmail: users.email
      })
      .from(adminAuditLogs)
      .leftJoin(users, eq(adminAuditLogs.adminUserId, users.id))
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(8)
  ]);

  const jobCounts = Object.fromEntries(
    jobStatusRows.map((row) => [row.status, row.count])
  );

  const summaryCards = [
    { label: 'Users', value: userCount, detail: `${activeUserCount[0]?.count ?? 0} active` },
    { label: 'Accounts', value: userCount, detail: 'personal wallets' },
    { label: 'Queued', value: jobCounts.queued ?? 0, detail: 'waiting jobs' },
    { label: 'Running', value: jobCounts.running ?? 0, detail: 'active jobs' },
    { label: 'Failed', value: jobCounts.failed ?? 0, detail: 'needs attention' },
    { label: 'Credits', value: creditRows[0]?.totalCredits ?? 0, detail: 'available total' }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Overview</h1>
        <p className="mt-1 text-sm text-slate-600">
          Platform activity, queue health, and recent admin changes.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaryCards.map((item) => (
          <Card key={item.label} className="rounded-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-slate-950">{item.value}</div>
              <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-md">
          <CardHeader>
            <CardTitle>Recent Failures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentFailures.length ? (
              recentFailures.map((job) => (
                <div key={job.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-slate-950">
                      #{job.id} {job.ticker}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatAdminDateTime(job.completedAt)}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {job.userEmail || 'Unknown user'}
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-red-700">
                    {job.errorMessage || 'No error message recorded.'}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No failed jobs.</p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-md">
          <CardHeader>
            <CardTitle>Audit Log</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentAuditLogs.length ? (
              recentAuditLogs.map((log) => (
                <div key={log.id} className="rounded-md border border-slate-200 p-3">
                  <div className="font-medium text-slate-950">{log.action}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {log.adminEmail} · {log.targetType}
                    {log.targetId ? ` #${log.targetId}` : ''}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatAdminDateTime(log.createdAt)}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No admin actions yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
