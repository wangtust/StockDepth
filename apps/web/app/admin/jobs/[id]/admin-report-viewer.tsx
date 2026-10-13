'use client';

import { useEffect, useMemo, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/http/json-fetcher';
const AnalysisProgress = dynamic(() => import('@/components/analysis-progress').then(m => m.AnalysisProgress));
const MarkdownRenderer = dynamic(() => import('@/components/markdown-renderer').then(m => m.MarkdownRenderer));
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
  const [selectedReportKey, setSelectedReportKey] = useState(
    initialReportKey || reports[0]?.reportKey || ''
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  const selectedReport = useMemo(
    () =>
      reports.find((report) => report.reportKey === selectedReportKey) ||
      reports[0],
    [reports, selectedReportKey]
  );
  const reportKey = selectedReport?.reportKey || '';
  const { data, error } = useSWR(reportKey ? `/api/admin/jobs/${jobId}/details?report=${encodeURIComponent(reportKey)}&v=${encodeURIComponent(version)}` : null, jsonFetcher);
  const visibleContent = !error && data?.report?.reportKey === reportKey ? data.report.content : '';


  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  return (
    <>
      {error && <p role="alert">{error.message}</p>}
      {isFullscreen && (
        <button
          aria-label="Exit report fullscreen"
          className="fixed inset-0 z-40 bg-slate-950/20 backdrop-blur-sm"
          onClick={() => setIsFullscreen(false)}
          type="button"
        />
      )}

      <Card
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
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist">
              {reports.map((report) => (
                <Button
                  key={report.id}
                  type="button"
                  size="sm"
                  variant={selectedReport?.id === report.id ? 'default' : 'outline'}
                  className="max-w-[260px] shrink-0 overflow-hidden text-ellipsis rounded-md"
                  onClick={() => setSelectedReportKey(report.reportKey)}
                >
                  {report.title}
                </Button>
              ))}
            </div>
          )}
        </CardHeader>

        <CardContent className="min-h-0 flex-1 p-0">
          {selectedReport ? (
            <article
              key={`${jobId}-${selectedReport.id}`}
              className={cn(
                'overflow-auto bg-white px-5 py-6 sm:px-8 lg:px-12 xl:px-16',
                isFullscreen
                  ? 'h-full min-h-0'
                  : 'min-h-[620px] lg:h-[calc(100dvh-340px)] lg:min-h-[680px]'
              )}
            >
              {selectedReport.reportKey === 'progress' ? <AnalysisProgress content={visibleContent} /> : <MarkdownRenderer
                content={visibleContent}
                className="mx-auto max-w-[1180px]"
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
