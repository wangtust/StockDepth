import { ModelCostDetails } from './model-cost-details';
export function ModelCosts({ jobId, count, knownCount, total, complete, version, paper }: {
  jobId: number; count: number; knownCount: number; total: string; complete: boolean; version: string;
  paper?: { count: number; knownCount: number; total: string; complete: boolean };
}) {
  return <section className="rounded-lg border border-slate-200 bg-white p-5">
    <h2 className="text-base font-semibold">Model costs (administrators only)</h2>
    <div className="mt-3 text-xl font-semibold">{knownCount ? `¥${total}` : 'Cost unknown'}<span className="ml-2 text-xs font-normal text-slate-500">{complete ? 'Total estimated cost' : 'Recorded call costs · Incomplete statistics'}</span></div>
    {!!paper?.count && <p className="mt-2 text-sm text-slate-700">Paper Trader: {paper.knownCount ? `¥${paper.total}` : 'Cost unknown'} · {paper.complete ? 'Complete statistics' : 'Incomplete statistics'} ({paper.count} {paper.count === 1 ? 'call' : 'calls'})</p>}
    <p className="mt-2 text-xs leading-5 text-slate-500">Calculated from CNY prices saved at the time of each call, including recorded retries. When cached usage is unknown, the regular input price provides an upper estimate. Calls with missing prices or usage are excluded. Provider invoices may include discounts or other adjustments; refer to the actual invoice.</p>
    {!!count && <ModelCostDetails jobId={jobId} count={count} version={version} />}
  </section>;
}
