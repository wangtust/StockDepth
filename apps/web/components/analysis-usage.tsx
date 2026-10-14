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
  if (!Number.isFinite(delta) || delta < 0) return 'Invalid duration';
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
  return <span>{job.startedAt && end ? elapsed(job.startedAt, end) : job.status === 'queued' ? 'Waiting to start' : '—'}</span>;
}

export function AnalysisUsage({ job, calls, compact = false, showDiagnostics = false }: { job: UsageJob; calls?: UsageCall[]; compact?: boolean; showDiagnostics?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (job.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.status]);
  const end = job.completedAt || (job.status === 'running' ? now : job.updatedAt);
  const duration = job.startedAt && end ? elapsed(job.startedAt, end) : job.status === 'queued' ? 'Waiting to start' : '—';
  const number = (value?: number | null) => value == null ? (showDiagnostics ? 'Unknown' : '—') : value.toLocaleString('en-US');
  return <div className="mt-2 min-w-0 text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">
    <div>Duration {duration} · {job.tokenUsageComplete ? 'Total tokens' : 'Recorded tokens'} {number(job.totalTokens)}{showDiagnostics && !job.tokenUsageComplete && ' (Statistics incomplete)'}</div>
    {!compact && <>
      <div className="mt-1">Input {number(job.inputTokens)} · Output {number(job.outputTokens)}</div>
      <p className="mt-1">{showDiagnostics ? 'Duration includes pauses before continuing. Tokens include all recorded calls and retries. Calls without provider usage are marked Unknown.' : 'View the models, duration and recorded usage for each analysis step.'}</p>
      {!!calls?.length && <details className="mt-3">
        <summary className="cursor-pointer">Model calls ({calls.length})</summary>
        <div className="mt-2 max-w-full overflow-x-auto rounded-md border border-slate-200"><table className="w-full min-w-[760px] text-left [&_th]:whitespace-nowrap [&_th]:bg-slate-50 [&_td]:align-top [&_tbody_tr]:border-t [&_tbody_tr]:border-slate-100">
          <thead><tr>{['Agent', 'Role', 'Model', 'Status', 'Duration', 'Input', ...(showDiagnostics ? ['Cache Hit'] : []), 'Output', 'Total Tokens'].map(x => <th className="p-2" key={x}>{x}</th>)}</tr></thead>
          <tbody>{calls.map(call => <tr key={call.callId}>
            <td className="max-w-[220px] p-2">{call.agent || '—'}</td>
            <td className="p-2">{showDiagnostics ? call.role || 'legacy' : call.role === 'quick' ? 'Quick' : call.role === 'deep' ? 'Deep' : '—'}</td>
            <td className="max-w-[260px] p-2">{call.model || '—'}{showDiagnostics && <> · {call.provider || 'Unknown'}{call.modelConfigId ? ` (#${call.modelConfigId})` : ''}</>}</td>
            <td className="p-2">{showDiagnostics ? call.status : ({ complete: 'Completed', completed: 'Completed', running: 'Running', queued: 'Queued', failed: 'Failed', interrupted: 'Interrupted' }[call.status] || 'Processing')}{call.isRetry ? ' · Retry' : ''}{showDiagnostics && <><br />{call.requestKind}</>}</td>
            <td className="p-2">{call.endedAt || (call.status === 'running' && now) ? elapsed(call.startedAt, call.endedAt || now!) : '—'}</td>
            <td className="p-2">{number(call.inputTokens)}</td>{showDiagnostics && <td className="p-2">{number(call.cachedInputTokens)}</td>}<td className="p-2">{number(call.outputTokens)}</td><td className="p-2">{number(call.totalTokens)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}
    </>}
  </div>;
}
