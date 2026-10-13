'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/http/json-fetcher';
import type { analysisModelCalls } from '@/lib/db/schema';
type Call = typeof analysisModelCalls.$inferSelect;
function addDecimal(left: string | null, right: string | null) {
  if (left == null || right == null) return null;
  const units = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 1000000000000n + BigInt((fraction + '000000000000').slice(0, 12));
  };
  const result = units(left) + units(right);
  return `${result / 1000000000000n}.${(result % 1000000000000n).toString().padStart(12, '0')}`;
}
export function ModelCostDetails({ jobId, count, version }: { jobId: number; count: number; version: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data, error, isLoading } = useSWR(expanded ? `/api/admin/jobs/${jobId}/details?v=${encodeURIComponent(version)}` : null, jsonFetcher);
  const calls: Call[] = data?.calls || [];
  const paperCalls = data?.paperCalls || [];
  const groups = new Map<string, { role: string; provider: string; model: string; calls: number; input: number; output: number; cached: number; cost: string | null; complete: boolean }>();
  for (const call of calls) {
    const key = [call.agent, call.role, call.provider, call.modelConfigId, call.model].join('|');
    const group = groups.get(key) || { role: `${call.role} · ${call.agent}`, provider: call.provider || '未知', model: call.model, calls: 0, input: 0, output: 0, cached: 0, cost: '0', complete: true };
    group.calls += 1; group.input += call.inputTokens || 0; group.output += call.outputTokens || 0; group.cached += call.cachedInputTokens || 0;
    group.cost = addDecimal(group.cost, call.estimatedCost); group.complete &&= call.costComplete;
    groups.set(key, group);
  }
  return <div className="mt-4"><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起调用明细' : '展开调用明细'}（{count} 次调用）</button>
    {expanded && <div className="mt-3 overflow-x-auto">{isLoading && <p>正在加载…</p>}{error && <p role="alert">{error.message}</p>}{!!groups.size && <><h3 className="mb-2 font-medium">按角色、供应商和 Agent 汇总</h3><table className="mb-5 w-full min-w-[750px] text-left text-xs"><thead><tr>{['角色 / Agent', '供应商 / 模型', '调用', '输入', '缓存命中', '输出', '估算费用（元）'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{[...groups.values()].map((group, index) => <tr key={index} className="border-t border-slate-100"><td className="p-2">{group.role}</td><td className="p-2">{group.provider} · {group.model}</td><td className="p-2">{group.calls}</td><td className="p-2">{group.input.toLocaleString()}</td><td className="p-2">{group.cached.toLocaleString()}</td><td className="p-2">{group.output.toLocaleString()}</td><td className="p-2">{group.cost ?? '未知'}{!group.complete && ' · 不完整'}</td></tr>)}</tbody></table></>}<table className="w-full min-w-[850px] text-left text-xs">
      <thead><tr>{['Agent / 角色 / 供应商 / 模型配置', '输入 / 输出 token', '缓存命中 token', '输入 / 缓存 / 输出单价', '估算费用（元）', '统计状态'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
      <tbody>{calls.map(call => {
        let prices: { input: string; cache: string; output: string } | null = null;
        try { prices = call.pricingSnapshot ? JSON.parse(call.pricingSnapshot) : null; } catch {}
        return <tr key={call.callId} className="border-t border-slate-100">
          <td className="p-2">{call.agent}<br />{call.role} · {call.provider || '未知'} · {call.model}{call.modelConfigId ? ` (#${call.modelConfigId})` : ''}{call.isRetry && ' · 重试'}</td>
          <td className="p-2">{call.inputTokens ?? '未知'} / {call.outputTokens ?? '未知'}</td>
          <td className="p-2">{call.cachedInputTokens ?? '未知'}</td>
          <td className="p-2">{prices ? `${prices.input} / ${prices.cache} / ${prices.output}` : '未配置'}<br />元 / 百万 tokens</td>
          <td className="p-2">{call.estimatedCost ?? '未知'}</td>
          <td className="p-2">{call.costComplete ? '用量完整' : call.estimatedCost != null ? '缓存未知 · 上限估算' : '价格或用量缺失'}</td>
        </tr>;
      })}</tbody>
    </table>
    {!!paperCalls.length && <><h3 className="mb-2 mt-5 font-medium">Paper Trader 调用（单独统计）</h3><table className="w-full min-w-[750px] text-left text-xs"><thead><tr>{['供应商 / 模型', '输入 / 输出 token', '缓存命中', '价格快照', '估算费用', '状态'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{paperCalls.map((call: any) => <tr key={call.callId} className="border-t border-slate-100"><td className="p-2">{call.provider} · {call.model}{call.modelConfigId ? ` (#${call.modelConfigId})` : ''}</td><td className="p-2">{call.inputTokens ?? '未知'} / {call.outputTokens ?? '未知'}</td><td className="p-2">{call.cachedInputTokens ?? '未知'}</td><td className="p-2">{call.pricingSnapshot ? '已快照' : '未配置'}</td><td className="p-2">{call.estimatedCost ?? '未知'}</td><td className="p-2">{call.status} · {call.costComplete ? '完整' : '不完整'}</td></tr>)}</tbody></table></>}
    </div>}</div>;
}
