'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/http/json-fetcher';
import type { analysisModelCalls } from '@/lib/db/schema';
type Call = typeof analysisModelCalls.$inferSelect;
export function ModelCostDetails({ jobId, count, version }: { jobId: number; count: number; version: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data, error, isLoading } = useSWR(expanded ? `/api/admin/jobs/${jobId}/details?v=${encodeURIComponent(version)}` : null, jsonFetcher);
  const calls: Call[] = data?.calls || [];
  return <div className="mt-4"><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起调用明细' : '展开调用明细'}（{count} 次调用）</button>
    {expanded && <div className="mt-3 overflow-x-auto">{isLoading && <p>正在加载…</p>}{error && <p role="alert">{error.message}</p>}<table className="w-full min-w-[850px] text-left text-xs">
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
    </table></div>}</div>;
}
