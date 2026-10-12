import { desc, ilike, or } from 'drizzle-orm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { setUserRole, setUserStatus } from '@/app/admin/actions';
import { formatAdminDateTime, StatusBadge } from '@/app/admin/_components/admin-ui';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

async function setUserRoleAction(formData: FormData) {
  'use server';
  await setUserRole(formData);
}

async function setUserStatusAction(formData: FormData) {
  'use server';
  await setUserStatus(formData);
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const admin = await requirePlatformAdmin();
  const { q = '' } = await searchParams;
  const query = q.trim();
  const canManageRoles = admin.role === 'super_admin';

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      analysisCredits: users.analysisCredits,
      inviteCode: users.inviteCode
    })
    .from(users)
    .where(
      query
        ? or(ilike(users.email, `%${query}%`), ilike(users.name, `%${query}%`))
        : undefined
    )
    .orderBy(desc(users.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Users</h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage platform roles and account access.
          </p>
        </div>
        <form className="flex gap-2" action="/admin/users">
          <Input name="q" placeholder="Search users" defaultValue={query} />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>User Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-3 pr-4">User</th>
                  <th className="py-3 pr-4">Platform Role</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Credits</th>
                  <th className="py-3 pr-4">Invite Code</th>
                  <th className="py-3 pr-4">Joined</th>
                  <th className="py-3 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((user) => (
                  <tr key={user.id}>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-950">
                        {user.name || 'Unnamed'}
                      </div>
                      <div className="text-slate-600">{user.email}</div>
                      <div className="text-xs text-slate-400">#{user.id}</div>
                    </td>
                    <td className="py-3 pr-4">
                      {canManageRoles ? (
                        <form action={setUserRoleAction} className="flex items-center gap-2">
                          <input type="hidden" name="userId" value={user.id} />
                          <select
                            name="role"
                            defaultValue={user.role}
                            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                            <option value="super_admin">Super Admin</option>
                          </select>
                          <Button type="submit" size="sm" variant="outline">
                            Save
                          </Button>
                        </form>
                      ) : (
                        <StatusBadge status={user.role} />
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="py-3 pr-4 font-semibold text-slate-950">
                      {user.analysisCredits}
                    </td>
                    <td className="py-3 pr-4 font-mono text-sm tracking-[0.2em] text-slate-700">
                      {user.inviteCode || '------'}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {formatAdminDateTime(user.createdAt)}
                    </td>
                    <td className="py-3 pr-4">
                      {user.id === admin.id ? (
                        <span className="text-xs text-slate-500">Current admin</span>
                      ) : (
                        <form action={setUserStatusAction}>
                          <input type="hidden" name="userId" value={user.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={user.status === 'active' ? 'disabled' : 'active'}
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant={user.status === 'active' ? 'destructive' : 'outline'}
                          >
                            {user.status === 'active' ? 'Disable' : 'Restore'}
                          </Button>
                        </form>
                      )}
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
