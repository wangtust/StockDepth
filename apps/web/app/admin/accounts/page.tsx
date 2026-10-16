import { desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import { db } from '@/lib/db/drizzle';
import { analysisJobs, billingAccounts, users } from '@/lib/db/schema';
import { adjustUserCredits } from '@/app/admin/actions';
import { StatusBadge } from '@/app/admin/_components/admin-ui';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

async function adjustUserCreditsAction(formData: FormData) {
  'use server';
  await adjustUserCredits(formData);
}

export default async function AdminAccountsPage({ searchParams }: PageProps) {
  await requirePlatformAdmin();
  const { q = '' } = await searchParams;
  const query = q.trim();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      inviteCode: users.inviteCode,
      analysisCredits: billingAccounts.analysisCredits,
      planName: billingAccounts.planName,
      subscriptionStatus: billingAccounts.subscriptionStatus,
      createdAt: users.createdAt,
      jobCount: sql<number>`count(distinct ${analysisJobs.id})::int`
    })
    .from(users)
    .leftJoin(billingAccounts, eq(users.id,billingAccounts.userId))
    .leftJoin(analysisJobs, eq(users.id, analysisJobs.userId))
    .where(
      query
        ? or(
            ilike(users.email, `%${query}%`),
            ilike(users.name, `%${query}%`),
            ilike(users.inviteCode, `%${query.toUpperCase()}%`),
            sql`${users.id}::text ilike ${`%${query}%`}`
          )
        : undefined
    )
    .groupBy(users.id,billingAccounts.userId)
    .orderBy(desc(users.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Accounts</h1>
          <p className="mt-1 text-sm text-slate-600">
            Review users and adjust personal analysis credits.
          </p>
        </div>
        <form className="flex gap-2" action="/admin/accounts">
          <Input name="q" placeholder="Search accounts" defaultValue={query} />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Account Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-3 pr-4">Account</th>
                  <th className="py-3 pr-4">Credits</th>
                  <th className="py-3 pr-4">Plan</th>
                  <th className="py-3 pr-4">Invite Code</th>
                  <th className="py-3 pr-4">Jobs</th>
                  <th className="py-3 pr-4">Adjust Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((account) => (
                  <tr key={account.id}>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-950">
                        {account.name || 'Unnamed'}
                      </div>
                      <div className="text-slate-600">{account.email}</div>
                      <div className="text-xs text-slate-400">#{account.id}</div>
                    </td>
                    <td className="py-3 pr-4 text-lg font-semibold text-slate-950">
                      {account.analysisCredits}
                    </td>
                    <td className="py-3 pr-4">
                      <div>{account.planName || 'Free'}</div>
                      <div className="mt-1">
                        <StatusBadge status={account.subscriptionStatus || 'inactive'} />
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono text-sm tracking-[0.2em] text-slate-700">
                      {account.inviteCode || '------'}
                    </td>
                    <td className="py-3 pr-4">{account.jobCount}</td>
                    <td className="py-3 pr-4">
                      <form action={adjustUserCreditsAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={account.id} />
                        <Input
                          name="amount"
                          type="number"
                          className="w-28"
                          placeholder="+10"
                          required
                        />
                        <Input
                          name="note"
                          className="w-48"
                          placeholder="Note"
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Apply
                        </Button>
                      </form>
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
