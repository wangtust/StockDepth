'use client';
import { ErrorPresentation } from '@/components/error-presentation';
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
  const { data, error, isLoading, isValidating, mutate } = useSWR(expanded ? `/api/admin/jobs/${jobId}/details?v=${encodeURIComponent(version)}` : null, jsonFetcher);
  const calls: Call[] = !error && !isLoading ? data?.calls || [] : [];
  const paperCalls = !error && !isLoading ? data?.paperCalls || [] : [];
  const groups = new Map<string, { role: string; provider: string; model: string; calls: number; input: number; output: number; cached: number; cost: string | null; complete: boolean }>();
  for (const call of calls) {
    const key = [call.agent, call.role, call.provider, call.modelConfigId, call.model].join('|');
    const group = groups.get(key) || { role: `${call.role} · ${call.agent}`, provider: call.provider || 'Unknown', model: call.model, calls: 0, input: 0, output: 0, cached: 0, cost: '0', complete: true };
    group.calls += 1; group.input += call.inputTokens || 0; group.output += call.outputTokens || 0; group.cached += call.cachedInputTokens || 0;
    group.cost = addDecimal(group.cost, call.estimatedCost); group.complete &&= call.costComplete;
    groups.set(key, group);
  }
  return <div className="mt-4"><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide call details' : 'Show call details'} ({count} {count === 1 ? 'call' : 'calls'})</button>
    {expanded && <div className="mt-3 overflow-x-auto">{isLoading && <p role="status">Loading call details…</p>}{error && <ErrorPresentation error={error} context="request" compact onRetry={() => { void mutate(); }} retrying={isValidating} />}{!isLoading && !error && !calls.length && !paperCalls.length && <p role="status">No recorded calls are available.</p>}{!!groups.size && <><h3 className="mb-2 font-medium">Summary by role, provider, and agent</h3><table className="mb-5 w-full min-w-[750px] text-left text-xs"><thead><tr>{['Role / Agent', 'Provider / Model', 'Calls', 'Input', 'Cache hit', 'Output', 'Estimated cost (CNY)'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{[...groups.values()].map((group, index) => <tr key={index} className="border-t border-slate-100"><td className="p-2">{group.role}</td><td className="p-2">{group.provider} · {group.model}</td><td className="p-2">{group.calls}</td><td className="p-2">{group.input.toLocaleString('en-US')}</td><td className="p-2">{group.cached.toLocaleString('en-US')}</td><td className="p-2">{group.output.toLocaleString('en-US')}</td><td className="p-2">{group.cost ?? 'Unknown'}{!group.complete && ' · Incomplete'}</td></tr>)}</tbody></table></>}<table className="w-full min-w-[850px] text-left text-xs">
      <thead><tr>{['Agent / Role / Provider / Model configuration', 'Input / Output tokens', 'Cached input tokens', 'Input / Cache / Output prices', 'Estimated cost (CNY)', 'Statistics status'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
      <tbody>{calls.map(call => {
        let prices: { input: string; cache: string; output: string } | null = null;
        try { prices = call.pricingSnapshot ? JSON.parse(call.pricingSnapshot) : null; } catch {}
        return <tr key={call.callId} className="border-t border-slate-100">
          <td className="p-2">{call.agent}<br />{call.role} · {call.provider || 'Unknown'} · {call.model}{call.modelConfigId ? ` (#${call.modelConfigId})` : ''}{call.isRetry && ' · Retry'}</td>
          <td className="p-2">{call.inputTokens ?? 'Unknown'} / {call.outputTokens ?? 'Unknown'}</td>
          <td className="p-2">{call.cachedInputTokens ?? 'Unknown'}</td>
          <td className="p-2">{prices ? `${prices.input} / ${prices.cache} / ${prices.output}` : 'Not configured'}<br />CNY per million tokens</td>
          <td className="p-2">{call.estimatedCost ?? 'Unknown'}</td>
          <td className="p-2">{call.costComplete ? 'Usage complete' : call.estimatedCost != null ? 'Cache unknown · Upper estimate' : 'Missing price or usage'}</td>
        </tr>;
      })}</tbody>
    </table>
    {!!paperCalls.length && <><h3 className="mb-2 mt-5 font-medium">Paper Trader calls (separate totals)</h3><table className="w-full min-w-[750px] text-left text-xs"><thead><tr>{['Provider / Model', 'Input / Output tokens', 'Cache hit', 'Price snapshot', 'Estimated cost', 'Status'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{paperCalls.map((call: any) => <tr key={call.callId} className="border-t border-slate-100"><td className="p-2">{call.provider} · {call.model}{call.modelConfigId ? ` (#${call.modelConfigId})` : ''}</td><td className="p-2">{call.inputTokens ?? 'Unknown'} / {call.outputTokens ?? 'Unknown'}</td><td className="p-2">{call.cachedInputTokens ?? 'Unknown'}</td><td className="p-2">{call.pricingSnapshot ? 'Snapshot saved' : 'Not configured'}</td><td className="p-2">{call.estimatedCost ?? 'Unknown'}</td><td className="p-2">{call.status} · {call.costComplete ? 'Complete' : 'Incomplete'}</td></tr>)}</tbody></table></>}
    </div>}</div>;
}
