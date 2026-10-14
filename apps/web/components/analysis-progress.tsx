'use client';

import { memo, useMemo } from 'react';
import { DeferredDetails } from '@/components/deferred-details';
import { Bot, Database, ArrowDown, CheckCircle2, Clock3 } from 'lucide-react';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { parseProgress, parameterSummary, resultSummary, toolLabel } from '@/lib/analysis/progress-events';

export const AnalysisProgress = memo(function AnalysisProgress({ content, running = false }: { content: string; running?: boolean }) {
  const turns = useMemo(() => parseProgress(content), [content]);
  if (!turns.length) return <MarkdownRenderer content={content} />;
  const responseCount = turns.filter(t => t.text || t.tools.some(tool => tool.args)).length;
  const toolCount = turns.reduce((count, turn) => count + turn.tools.length, 0);
  return <div className="mx-auto max-w-4xl space-y-6">
    <header className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-5">
      <h2 className="text-lg font-semibold text-slate-950">Analysis Progress</h2>
      <p className="mt-1 text-sm text-slate-600">Follow model queries, data retrieval and analysis. Expand entries to view source data and query parameters.</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-emerald-800">
        <span className="rounded-full bg-white px-3 py-1">{responseCount} model {responseCount === 1 ? 'response' : 'responses'}</span>
        <span className="rounded-full bg-white px-3 py-1">{toolCount} tool {toolCount === 1 ? 'call' : 'calls'}</span>
        <span className="rounded-full bg-white px-3 py-1">{running ? 'Analysis in progress' : 'Recorded interactions'}</span>
      </div>
    </header>
    <ol className="space-y-6">
      {turns.map((turn, index) => <li key={turn.id} className="relative pl-10 sm:pl-12">
        {index < turns.length - 1 && <div className="absolute bottom-[-24px] left-4 top-8 w-px bg-slate-200" />}
        <div className="absolute left-0 top-0 flex size-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{index + 1}</div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">
            <Bot className="size-4 text-emerald-600" />{turn.tools.length ? 'Model queries data' : 'Model generates analysis'}
          </div>
          {turn.text && <div className="px-4 py-4 sm:px-5">
            {turn.text.length > 1200 ? <DeferredDetails summary={<span className="cursor-pointer text-sm font-medium text-slate-700">View analysis response · {turn.text.length.toLocaleString('en-US')} characters<span className="mt-2 block text-sm font-normal leading-6 text-slate-500">{turn.text.replace(/[#*`]/g, "").slice(0, 180)}…</span></span>}><div className="mt-3"><MarkdownRenderer content={turn.text} /></div></DeferredDetails> : <MarkdownRenderer content={turn.text} />}
          </div>}
          {!!turn.tools.length && <div className="space-y-3 p-4 sm:p-5">
            {turn.tools.map((tool, toolIndex) => <div key={`${tool.name}-${toolIndex}`} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-medium text-slate-800"><Database className="size-4 text-blue-600" />{toolLabel(tool.name)}</span>
                <span className="flex items-center gap-1 text-xs text-slate-500">{tool.result !== undefined ? <><CheckCircle2 className="size-3.5 text-emerald-600" />Returned</> : <><Clock3 className="size-3.5" />Result pending</>}</span>
              </div>
              {tool.args && <>
                <p className="mt-2 break-words text-xs leading-5 text-slate-600">{parameterSummary(tool.args)}</p>
                <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Query parameters</summary><pre className="mt-2 overflow-x-auto rounded bg-white p-3">{tool.args}</pre></details>
              </>}
              {tool.result !== undefined && <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="mb-2 flex items-center gap-1 text-xs text-slate-500"><ArrowDown className="size-3" />Data source → Model · {resultSummary(tool.result)}</div>
                <DeferredDetails summary={<span className="cursor-pointer text-xs font-medium text-blue-700">View returned data</span>}><div className="mt-3 max-h-96 overflow-auto rounded-lg bg-white p-3"><MarkdownRenderer content={tool.result} /></div></DeferredDetails>
              </div>}
            </div>)}
          </div>}
        </div>
      </li>)}
    </ol>
    {running && <div role="status" className="flex items-center gap-2 pl-10 text-sm text-slate-500"><Clock3 className="size-4 animate-pulse" />Waiting for the next analysis result. This page updates automatically.</div>}
  </div>;
});
