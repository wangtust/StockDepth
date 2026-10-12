import type { analysisModelCalls } from '@/lib/db/schema';

type Call = typeof analysisModelCalls.$inferSelect;
function scaled(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, '0').slice(0, 12));
}
function money(value: bigint) {
  return `${value / 1_000_000_000_000n}.${(value % 1_000_000_000_000n).toString().padStart(12, '0')}`;
}
export function ModelCosts({ calls, usageComplete }: { calls: Call[]; usageComplete: boolean }) {
  const known = calls.filter(call => call.estimatedCost != null);
  const total = known.reduce((sum, call) => sum + scaled(call.estimatedCost!), 0n);
  const complete = usageComplete && calls.length > 0 && calls.every(call => call.costComplete);
  return <section className="rounded-lg border border-slate-200 bg-white p-5">
    <h2 className="text-base font-semibold">模型费用（仅管理员可见）</h2>
    <div className="mt-3 text-xl font-semibold">{known.length ? `¥${money(total)}` : '费用未知'}<span className="ml-2 text-xs font-normal text-slate-500">{complete ? '总估算费用' : '已记录调用费用 · 统计不完整'}</span></div>
    <p className="mt-2 text-xs leading-5 text-slate-500">按调用时保存的人民币单价计算，包含已记录重试。缓存用量未知时按普通输入价计算上限估算；价格或用量缺失的调用不计入金额。厂商账单可能另含折扣等项目，以实际账单为准。</p>
    {!!calls.length && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs">
      <thead><tr>{['Agent / 模型', '输入 / 输出 token', '缓存命中 token', '输入 / 缓存 / 输出单价', '费用（元）', '统计状态'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
      <tbody>{calls.map(call => {
        let prices: { input: string; cache: string; output: string } | null = null;
        try { prices = call.pricingSnapshot ? JSON.parse(call.pricingSnapshot) : null; } catch {}
        return <tr key={call.callId} className="border-t border-slate-100">
          <td className="p-2">{call.agent}<br />{call.model}{call.isRetry && ' · 重试'}</td>
          <td className="p-2">{call.inputTokens ?? '未知'} / {call.outputTokens ?? '未知'}</td>
          <td className="p-2">{call.cachedInputTokens ?? '未知'}</td>
          <td className="p-2">{prices ? `${prices.input} / ${prices.cache} / ${prices.output}` : '未配置'}<br />元 / 百万 tokens</td>
          <td className="p-2">{call.estimatedCost ?? '未知'}</td>
          <td className="p-2">{call.costComplete ? '用量完整' : call.estimatedCost != null ? '缓存未知 · 上限估算' : '价格或用量缺失'}</td>
        </tr>;
      })}</tbody>
    </table></div>}
  </section>;
}
