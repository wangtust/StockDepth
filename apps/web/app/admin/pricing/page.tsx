import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import { getAnalysisPricingRows } from '@/lib/analysis/pricing-server';
import { updateAnalysisPricing } from '@/app/admin/actions';
import { formatAdminDateTime } from '@/app/admin/_components/admin-ui';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ saved?: string }>;
};

async function updateAnalysisPricingAction(formData: FormData) {
  'use server';
  await updateAnalysisPricing(formData);
  redirect('/admin/pricing?saved=1');
}

export default async function AdminPricingPage({ searchParams }: PageProps) {
  await requirePlatformAdmin();
  const { saved } = await searchParams;
  const rows = await getAnalysisPricingRows();
  const byDepth = Object.fromEntries(rows.map((row) => [row.depth, row]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Pricing</h1>
        <p className="mt-1 text-sm text-slate-600">
          Set how many analysis credits each depth consumes.
        </p>
      </div>

      {saved === '1' && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Pricing saved successfully.
        </div>
      )}

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Analysis Depth Pricing</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateAnalysisPricingAction} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { depth: 1, key: 'depth1', description: 'Fastest analysis, lowest model cost.' },
                { depth: 3, key: 'depth3', description: 'Balanced analysis for routine decisions.' },
                { depth: 5, key: 'depth5', description: 'Fullest analysis, highest model cost.' }
              ].map((item) => {
                const row = byDepth[item.depth];
                return (
                  <div
                    key={item.depth}
                    className="rounded-md border border-slate-200 bg-white p-4"
                  >
                    <div className="text-base font-semibold text-slate-950">
                      {row?.label}
                    </div>
                    <p className="mt-1 min-h-10 text-sm text-slate-500">
                      {item.description}
                    </p>
                    <label
                      htmlFor={item.key}
                      className="mt-4 block text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      Credits charged
                    </label>
                    <Input
                      id={item.key}
                      name={item.key}
                      type="number"
                      min={1}
                      max={1000}
                      step={1}
                      defaultValue={row?.creditCost ?? item.depth}
                      className="mt-2"
                      required
                    />
                    <div className="mt-2 text-xs text-slate-400">
                      Updated {formatAdminDateTime(row?.updatedAt)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end">
              <Button type="submit">Save Pricing</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
