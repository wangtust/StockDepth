'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/http/json-fetcher';
const AnalysisProgress = dynamic(() => import('@/components/analysis-progress').then(m => m.AnalysisProgress));
const MarkdownRenderer = dynamic(() => import('@/components/markdown-renderer').then(m => m.MarkdownRenderer));
import { ErrorPresentation } from '@/components/error-presentation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type AdminReport = {
  id: number;
  reportKey: string;
  title: string;
  relativePath: string | null;
  content: string;
  updatedAtLabel: string;
};

type AdminReportViewerProps = {
  jobId: number;
  version: string;
  reports: AdminReport[];
  initialReportKey?: string;
  title: string;
  subtitle: string;
  facts: Array<[string, string]>;
};

export function AdminReportViewer({
  jobId, version,
  reports,
  initialReportKey,
  title,
  subtitle,
  facts
}: AdminReportViewerProps) {
  const [selection, setSelection] = useState({ jobId, key: initialReportKey || reports[0]?.reportKey || '' });
  const selectedReportKey = selection.jobId === jobId ? selection.key : initialReportKey || reports[0]?.reportKey || '';
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const selectedReport = useMemo(
    () =>
      reports.find((report) => report.reportKey === selectedReportKey) ||
      reports[0],
    [reports, selectedReportKey]
  );
  const reportKey = selectedReport?.reportKey || '';
  const { data, error, isLoading, isValidating, mutate } = useSWR(reportKey ? `/api/admin/jobs/${jobId}/details?report=${encodeURIComponent(reportKey)}&v=${encodeURIComponent(version)}` : null, jsonFetcher);
  const visibleContent = !error && data?.report?.reportKey === reportKey ? data.report.content : '';


  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    const article = articleRef.current;
    const articleScrollTop = article?.scrollTop ?? 0;
    const articleScrollLeft = article?.scrollLeft ?? 0;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    const scrollX = window.scrollX, scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    toggleRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Tab') {
        const controls = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]') || []);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
      window.scrollTo(scrollX, scrollY);
      if (article) {
        article.scrollTop = articleScrollTop;
        article.scrollLeft = articleScrollLeft;
      }
    };
  }, [isFullscreen]);

  return (
    <>
      {isFullscreen && (
        <button
          tabIndex={-1}
          aria-label="Exit report fullscreen"
          className="fixed inset-0 z-40 bg-slate-950/20 backdrop-blur-sm"
          onClick={() => setIsFullscreen(false)}
          type="button"
        />
      )}

      <Card
        ref={cardRef}
        role={isFullscreen ? "dialog" : undefined}
        aria-modal={isFullscreen || undefined}
        aria-label={isFullscreen ? "Report viewer" : undefined}
        className={cn(
          'min-w-0 gap-0 overflow-hidden rounded-lg border-slate-200 bg-white py-0 shadow-sm transition-all duration-300 ease-out',
          isFullscreen &&
            'fixed inset-3 z-50 rounded-xl border-slate-300 shadow-2xl sm:inset-5 lg:inset-6'
        )}
      >
        <CardHeader className="gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base text-slate-950">
                {selectedReport?.title || title}
              </CardTitle>
              <p className="mt-1 truncate text-sm text-slate-500">
                {selectedReport
                  ? `${selectedReport.reportKey} · updated ${selectedReport.updatedAtLabel}`
                  : subtitle}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {reports.length > 0 && (
                <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
                  {reports.length} sections
                </span>
              )}
              <button
                ref={toggleRef}
                aria-label={isFullscreen ? 'Exit report fullscreen' : 'Enter report fullscreen'}
                className="flex size-9 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm transition hover:bg-emerald-100 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                onClick={() => setIsFullscreen(!isFullscreen)}
                title={isFullscreen ? 'Exit report fullscreen' : 'Enter report fullscreen'}
                type="button"
              >
                {isFullscreen ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </button>
            </div>
          </div>

          {!isFullscreen && (
            <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-5">
              {facts.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <div className="font-medium uppercase tracking-wide text-slate-400">
                    {label}
                  </div>
                  <div className="truncate text-slate-700" title={value}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {reports.length > 0 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Report sections">
              {reports.map((report) => (
                <Button
                  aria-pressed={selectedReport?.id === report.id}
                  key={report.id}
                  type="button"
                  size="sm"
                  variant={selectedReport?.id === report.id ? 'default' : 'outline'}
                  className="max-w-[260px] shrink-0 overflow-hidden text-ellipsis rounded-md"
                  onClick={() => setSelection({ jobId, key: report.reportKey })}
                >
                  {report.reportKey === 'progress' ? 'Interactions' : report.title}
                </Button>
              ))}
            </div>
          )}
        </CardHeader>

        <CardContent className="min-h-0 flex-1 p-0">
          {selectedReport ? (
            <article
              ref={articleRef}
              key={`${jobId}-${selectedReport.id}`}
              className={cn(
                'overflow-auto bg-white px-5 py-6 sm:px-8 lg:px-12 xl:px-16',
                isFullscreen
                  ? 'h-full min-h-0'
                  : 'min-h-[620px] lg:h-[calc(100dvh-340px)] lg:min-h-[680px]'
              )}
            >
              {error ? <ErrorPresentation error={error} context="request" jobId={jobId} onRetry={() => { void mutate(); }} retrying={isValidating} /> : isLoading || !data ? <p role="status">Loading report…</p> : !visibleContent ? <p role="status">This report has no content yet.</p> : selectedReport.reportKey === 'progress' ? <AnalysisProgress content={visibleContent} /> : <MarkdownRenderer
                content={visibleContent}
                className="mx-auto w-full min-w-0 max-w-[80ch]"
              />}
            </article>
          ) : (
            <div className="flex min-h-[560px] items-center justify-center bg-white px-6 text-center">
              <p className="max-w-sm text-sm text-slate-500">
                This job has not saved any report content yet.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
