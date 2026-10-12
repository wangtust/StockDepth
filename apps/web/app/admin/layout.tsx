import { requirePlatformAdmin } from '@/lib/auth/admin';
import { AdminBrand, AdminNav } from '@/app/admin/_components/admin-nav';

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const admin = await requirePlatformAdmin();

  return (
    <section className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <AdminBrand />
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <span>{admin.email}</span>
            <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-medium uppercase text-slate-700">
              {admin.role}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1800px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-8">
        <aside className="rounded-md border border-slate-200 bg-white p-2">
          <AdminNav />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </section>
  );
}
