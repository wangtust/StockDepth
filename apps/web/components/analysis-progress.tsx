'use client';

import { useMemo } from 'react';
import { Bot, Database, ArrowDown, CheckCircle2, Clock3 } from 'lucide-react';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { parseProgress, parameterSummary, resultSummary, toolLabel } from '@/lib/analysis/progress-events';

export function AnalysisProgress({ content, running = false }: { content: string; running?: boolean }) {
  const turns = useMemo(() => parseProgress(content), [content]);
  if (!turns.length) return <MarkdownRenderer content={content} />;
  const toolCount = turns.reduce((count, turn) => count + turn.tools.length, 0);
  return <div className="mx-auto max-w-4xl space-y-6">
    <header className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-5">
      <h2 className="text-lg font-semibold text-slate-950">系统交互过程</h2>
      <p className="mt-1 text-sm text-slate-600">查看模型如何发起查询、接收数据并生成分析。原始数据和请求参数可展开查看。</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-emerald-800">
        <span className="rounded-full bg-white px-3 py-1">{turns.filter(t => t.text || t.tools.some(tool => tool.args)).length} 次模型回复</span>
        <span className="rounded-full bg-white px-3 py-1">{toolCount} 次工具调用</span>
        <span className="rounded-full bg-white px-3 py-1">{running ? '分析进行中' : '已记录的交互'}</span>
      </div>
    </header>
    <ol className="space-y-6">
      {turns.map((turn, index) => <li key={turn.id} className="relative pl-10 sm:pl-12">
        {index < turns.length - 1 && <div className="absolute bottom-[-24px] left-4 top-8 w-px bg-slate-200" />}
        <div className="absolute left-0 top-0 flex size-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{index + 1}</div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">
            <Bot className="size-4 text-emerald-600" />{turn.tools.length ? '模型发起数据查询' : '模型生成分析回复'}
          </div>
          {turn.text && <div className="px-4 py-4 sm:px-5">
            {turn.text.length > 1200 ? <details><summary className="cursor-pointer text-sm font-medium text-slate-700">查看分析回复 · {turn.text.length.toLocaleString('en-US')} 字符<span className="mt-2 block text-sm font-normal leading-6 text-slate-500">{turn.text.replace(/[#*`]/g, "").slice(0, 180)}…</span></summary><div className="mt-3"><MarkdownRenderer content={turn.text} /></div></details> : <MarkdownRenderer content={turn.text} />}
          </div>}
          {!!turn.tools.length && <div className="space-y-3 p-4 sm:p-5">
            {turn.tools.map((tool, toolIndex) => <div key={`${tool.name}-${toolIndex}`} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-medium text-slate-800"><Database className="size-4 text-blue-600" />{toolLabel(tool.name)}</span>
                <span className="flex items-center gap-1 text-xs text-slate-500">{tool.result !== undefined ? <><CheckCircle2 className="size-3.5 text-emerald-600" />已返回</> : <><Clock3 className="size-3.5" />尚未记录结果</>}</span>
              </div>
              {tool.args && <>
                <p className="mt-2 break-words text-xs leading-5 text-slate-600">{parameterSummary(tool.args)}</p>
                <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">请求参数</summary><pre className="mt-2 overflow-x-auto rounded bg-white p-3">{tool.args}</pre></details>
              </>}
              {tool.result !== undefined && <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="mb-2 flex items-center gap-1 text-xs text-slate-500"><ArrowDown className="size-3" />数据源 → 模型 · {resultSummary(tool.result)}</div>
                <details><summary className="cursor-pointer text-xs font-medium text-blue-700">查看返回内容</summary><div className="mt-3 max-h-96 overflow-auto rounded-lg bg-white p-3"><MarkdownRenderer content={tool.result} /></div></details>
              </div>}
            </div>)}
          </div>}
        </div>
      </li>)}
    </ol>
    {running && <div role="status" className="flex items-center gap-2 pl-10 text-sm text-slate-500"><Clock3 className="size-4 animate-pulse" />等待下一步分析结果，页面会自动更新。</div>}
  </div>;
}
