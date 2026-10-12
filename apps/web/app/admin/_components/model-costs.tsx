import { ModelCostDetails } from './model-cost-details';
export function ModelCosts({ jobId, count, knownCount, total, complete, version }: {
  jobId: number; count: number; knownCount: number; total: string; complete: boolean; version: string;
}) {
  return <section className="rounded-lg border border-slate-200 bg-white p-5">
    <h2 className="text-base font-semibold">模型费用（仅管理员可见）</h2>
    <div className="mt-3 text-xl font-semibold">{knownCount ? `¥${total}` : '费用未知'}<span className="ml-2 text-xs font-normal text-slate-500">{complete ? '总估算费用' : '已记录调用费用 · 统计不完整'}</span></div>
    <p className="mt-2 text-xs leading-5 text-slate-500">按调用时保存的人民币单价计算，包含已记录重试。缓存用量未知时按普通输入价计算上限估算；价格或用量缺失的调用不计入金额。厂商账单可能另含折扣等项目，以实际账单为准。</p>
    {!!count && <ModelCostDetails jobId={jobId} count={count} version={version} />}
  </section>;
}
