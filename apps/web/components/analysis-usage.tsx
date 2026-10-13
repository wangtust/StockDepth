'use client';

import { useEffect, useState } from 'react';

export type UsageJob = {
  status: string;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  updatedAt?: string | Date;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  tokenUsageComplete?: boolean;
};
export type UsageCall = {
  callId: string; agent: string; model: string; role?: string; provider?: string | null; modelConfigId?: number | null; status: string;
  startedAt: string | Date; endedAt: string | Date | null;
  inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  cachedInputTokens?: number | null;
  usageAvailable: boolean; isRetry: boolean; requestKind: string;
};

function elapsed(start: string | Date, end: string | Date | number) {
  const delta = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(delta) || delta < 0) return '时间异常';
  const seconds = Math.floor(delta / 1000);
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function AnalysisTimer({ job }: { job: UsageJob }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (job.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.status]);
  const end = job.completedAt || (job.status === 'running' ? now : job.updatedAt);
  return <span>{job.startedAt && end ? elapsed(job.startedAt, end) : job.status === 'queued' ? '等待开始' : '—'}</span>;
}

export function AnalysisUsage({ job, calls, compact = false }: { job: UsageJob; calls?: UsageCall[]; compact?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (job.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.status]);
  const end = job.completedAt || (job.status === 'running' ? now : job.updatedAt);
  const duration = job.startedAt && end ? elapsed(job.startedAt, end) : job.status === 'queued' ? '等待开始' : '—';
  const number = (value?: number | null) => value == null ? '未知' : value.toLocaleString('en-US');
  return <div className="mt-2 text-xs text-slate-600">
    <div>耗时 {duration} · 总 token {number(job.totalTokens)}{!job.tokenUsageComplete && '（统计不完整）'}</div>
    {!compact && <>
      <div className="mt-1">输入 {number(job.inputTokens)} · 输出 {number(job.outputTokens)}</div>
      <p className="mt-1">耗时从首次开始到结束，继续任务时包含中间等待时间。Token 累计所有已记录调用，包含重复请求；供应商未返回用量的调用标为未知。</p>
      {!!calls?.length && <details className="mt-3">
        <summary className="cursor-pointer">模型调用明细（{calls.length} 次）</summary>
        <div className="mt-2 overflow-x-auto"><table className="w-full text-left">
          <thead><tr>{['Agent', '角色 / 供应商 / 模型', '状态', '耗时', '输入', '缓存命中', '输出', '总 token'].map(x => <th className="p-2" key={x}>{x}</th>)}</tr></thead>
          <tbody>{calls.map(call => <tr key={call.callId}>
            <td className="p-2">{call.agent}</td><td className="p-2">{call.role || 'legacy'} · {call.provider || '未知'} · {call.model}{call.modelConfigId ? ` (#${call.modelConfigId})` : ''}</td><td className="p-2">{call.status}{call.isRetry ? " · 重试" : ""}<br />{call.requestKind}</td>
            <td className="p-2">{call.endedAt || (call.status === 'running' && now) ? elapsed(call.startedAt, call.endedAt || now!) : '—'}</td>
            <td className="p-2">{number(call.inputTokens)}</td><td className="p-2">{number(call.cachedInputTokens)}</td><td className="p-2">{number(call.outputTokens)}</td><td className="p-2">{number(call.totalTokens)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}
    </>}
  </div>;
}
