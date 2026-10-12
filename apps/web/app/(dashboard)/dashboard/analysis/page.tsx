'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { cn } from '@/lib/utils';
import { Loader2, Maximize2, Minimize2, MoreHorizontal, Play, RefreshCcw, Trash2 } from 'lucide-react';
import {
  getDepthCreditCostFromConfig,
  getDepthLabel,
  normalizePricingConfig
} from '@/lib/analysis/pricing';

type Job = {
  id: number;
  ticker: string;
  tradeDate: string;
  realtimeData?: boolean;
  language: string;
  depth: number;
  status: string;
  externalStatus?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  reportCount?: number;
};

type Report = {
  id: number;
  reportKey: string;
  title: string;
  content: string;
};

type JobsPayload = {
  credits: number;
  pricing?: Partial<Record<number, number>>;
  defaultModel?: {
    id: number;
    name: string;
    provider: string;
    quickModel: string;
    deepModel: string;
    isDefault: boolean;
  } | null;
  jobs: Job[];
};

const JOBS_POLL_INTERVAL_MS = 7000;
const REPORT_POLL_INTERVAL_MS = 5000;
const LIVE_JOB_STATUSES = new Set(['queued', 'running']);

function areReportsEqual(currentReports: Report[], nextReports: Report[]) {
  if (currentReports.length !== nextReports.length) {
    return false;
  }

  return currentReports.every((currentReport, index) => {
    const nextReport = nextReports[index];
    return (
      nextReport &&
      currentReport.id === nextReport.id &&
      currentReport.reportKey === nextReport.reportKey &&
      currentReport.title === nextReport.title &&
      currentReport.content === nextReport.content
    );
  });
}

function formatAnalysisDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || '';
  const year = value('year');
  const month = value('month');
  const day = value('day');
  return `${year}-${month}-${day}`;
}

export default function AnalysisPage() {
  const [payload, setPayload] = useState<JobsPayload>({ credits: 0, jobs: [] });
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedReports, setSelectedReports] = useState<Report[]>([]);
  const [selectedReportKey, setSelectedReportKey] = useState<string>('');
  const [ticker, setTicker] = useState('AAPL');
  const [tradeDate, setTradeDate] = useState(() => formatAnalysisDate(new Date()));
  const [realtimeData, setRealtimeData] = useState(false);
  const [language, setLanguage] = useState('Chinese');
  const [depth, setDepth] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<number | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [isReportFullscreen, setIsReportFullscreen] = useState(false);
  const reportScrollRef = useRef<HTMLElement | null>(null);
  const selectedReportKeyRef = useRef(selectedReportKey);

  const selectedJob = useMemo(
    () => payload.jobs.find((job) => job.id === selectedJobId),
    [payload.jobs, selectedJobId]
  );

  const selectedReport = useMemo(
    () =>
      selectedReports.find((report) => report.reportKey === selectedReportKey) ||
      selectedReports[0],
    [selectedReportKey, selectedReports]
  );
  const selectedJobStatus = selectedJob?.status;
  const selectedJobUpdatedAt = selectedJob?.updatedAt;
  const pricing = normalizePricingConfig(payload.pricing);
  const selectedDepthCost = getDepthCreditCostFromConfig(depth, pricing);
  const hasEnoughCredits = payload.credits >= selectedDepthCost;
  const defaultModel = payload.defaultModel ?? null;

  const loadJobs = useCallback(async () => {
    const response = await fetch('/api/analysis/jobs', { cache: 'no-store' });
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load analysis jobs');
    }
    setPayload(data);
    setSelectedJobId((currentId) => {
      if (currentId && data.jobs.some((job: Job) => job.id === currentId)) {
        return currentId;
      }
      return data.jobs[0]?.id ?? null;
    });
  }, []);

  const loadJobDetail = useCallback(async (id: number) => {
    const response = await fetch(`/api/analysis/jobs/${id}`, { cache: 'no-store' });
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load analysis report');
    }
    const reports = data.reports || [];
    const currentReportKey = selectedReportKeyRef.current;
    const shouldRestoreScroll =
      Boolean(currentReportKey) &&
      reports.some((report: Report) => report.reportKey === currentReportKey);
    const previousScrollTop = reportScrollRef.current?.scrollTop ?? 0;

    setSelectedReports((currentReports) =>
      areReportsEqual(currentReports, reports) ? currentReports : reports
    );
    setSelectedReportKey((currentKey) => {
      if (currentKey && reports.some((report: Report) => report.reportKey === currentKey)) {
        return currentKey;
      }
      return reports.find((report: Report) => report.reportKey === 'progress')?.reportKey || reports[0]?.reportKey || '';
    });

    if (shouldRestoreScroll) {
      requestAnimationFrame(() => {
        if (reportScrollRef.current) {
          reportScrollRef.current.scrollTop = previousScrollTop;
        }
      });
    }
  }, []);

  async function handleRefresh() {
    await loadJobs();
    if (selectedJobId) {
      await loadJobDetail(selectedJobId);
    }
  }

  useEffect(() => {
    let mounted = true;
    async function run() {
      try {
        await loadJobs();
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    run();
    const timer = setInterval(run, JOBS_POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [loadJobs]);

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedReports([]);
      setSelectedReportKey('');
      return;
    }

    let cancelled = false;
    let inFlight = false;

    async function run() {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        await loadJobDetail(selectedJobId!);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        inFlight = false;
      }
    }

    run();
    if (!selectedJobStatus || !LIVE_JOB_STATUSES.has(selectedJobStatus)) {
      return () => {
        cancelled = true;
      };
    }

    const timer = setInterval(run, REPORT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loadJobDetail, selectedJobId, selectedJobStatus, selectedJobUpdatedAt]);

  useEffect(() => {
    selectedReportKeyRef.current = selectedReportKey;
  }, [selectedReportKey]);

  useEffect(() => {
    if (!isReportFullscreen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsReportFullscreen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isReportFullscreen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/analysis/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          tradeDate,
          realtimeData,
          language,
          depth,
          analysts: ['market', 'social', 'news', 'fundamentals']
        })
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create analysis job');
      }
      await loadJobs();
      setSelectedJobId(data.job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteJob(id: number) {
    setDeletingJobId(id);
    setError('');
    try {
      const response = await fetch(`/api/analysis/jobs/${id}`, { method: 'DELETE' });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to delete job');
      if (selectedJobId === id) {
        setSelectedReports([]);
        setSelectedReportKey('');
        setSelectedJobId(null);
      }
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingJobId(null);
    }
  }

  async function handleRetryJob(id: number) {
    setRetryingJobId(id);
    setError('');
    try {
      const response = await fetch(`/api/analysis/jobs/${id}/retry`, {
        method: 'POST'
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || 'Failed to continue analysis job');
      }
      await loadJobs();
      await loadJobDetail(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryingJobId(null);
    }
  }

  return (
    <section className="flex-1 bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-950 lg:text-2xl">
              Analysis Queue
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Credits: {payload.credits}
            </p>
          </div>
          <Button
            className="w-full rounded-md sm:w-auto"
            variant="outline"
            onClick={() => handleRefresh()}
            disabled={loading}
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid min-h-0 gap-6 xl:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
            <Card className="rounded-lg border-slate-200 py-5 shadow-sm">
              <CardHeader className="px-5">
                <CardTitle className="text-base">New Analysis</CardTitle>
              </CardHeader>
              <CardContent className="px-5">
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div>
                    <Label htmlFor="ticker" className="mb-2">
                      Ticker
                    </Label>
                    <Input
                      id="ticker"
                      value={ticker}
                      onChange={(event) => setTicker(event.target.value.toUpperCase())}
                      placeholder="AAPL"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="tradeDate" className="mb-2">
                      Date
                    </Label>
                    <Input
                      id="tradeDate"
                      type="date"
                      value={tradeDate}
                      onChange={(event) => setTradeDate(event.target.value)}
                      disabled={realtimeData}
                      required
                    />
                  </div>
                  <label
                    htmlFor="realtimeData"
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <input
                      id="realtimeData"
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={realtimeData}
                      onChange={(event) => setRealtimeData(event.target.checked)}
                    />
                    <span className="min-w-0">
                      Realtime data
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="language" className="mb-2">
                        Language
                      </Label>
                      <select
                        id="language"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={language}
                        onChange={(event) => setLanguage(event.target.value)}
                      >
                        <option value="Chinese">Chinese</option>
                        <option value="English">English</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="depth" className="mb-2">
                        Depth
                      </Label>
                      <select
                        id="depth"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={depth}
                        onChange={(event) => setDepth(Number(event.target.value))}
                      >
                        <option value={1}>Shallow · {pricing[1]} credit{pricing[1] === 1 ? '' : 's'}</option>
                        <option value={3}>Medium · {pricing[3]} credits</option>
                        <option value={5}>Deep · {pricing[5]} credits</option>
                      </select>
                    </div>
                  </div>
                  {defaultModel ? (
                    <div>
                      <Label className="mb-2">
                        Model
                      </Label>
                      <div className="flex min-h-9 w-full items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                        <span className="min-w-0 truncate">
                          {defaultModel.name} · {defaultModel.quickModel}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      No active model is configured.
                    </div>
                  )}
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <div className="flex items-center justify-between gap-3">
                      <span>{getDepthLabel(depth)} analysis</span>
                      <span className="font-medium text-slate-950">
                        {selectedDepthCost} credits
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Balance after queueing:{' '}
                      {Math.max(0, payload.credits - selectedDepthCost)}
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full rounded-md"
                    disabled={submitting || !hasEnoughCredits || !defaultModel}
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {hasEnoughCredits ? 'Queue Analysis' : 'Not Enough Credits'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="rounded-lg border-slate-200 py-5 shadow-sm">
              <CardHeader className="px-5">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Jobs</CardTitle>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {payload.jobs.length}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="px-5">
                <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                  {payload.jobs.map((job) => (
                    <div key={job.id} className="relative">
                    <button
                      className={`w-full rounded-md border py-3 pl-3 pr-12 text-left transition ${
                        selectedJobId === job.id
                          ? 'border-slate-900 bg-white shadow-sm ring-1 ring-slate-900/5'
                          : 'border-slate-200 bg-white/70 hover:border-slate-300 hover:bg-white'
                      }`}
                      onClick={() => setSelectedJobId(job.id)}
                      type="button"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="truncate font-medium text-slate-950">
                          {job.ticker}
                        </span>
                        <StatusLabel status={job.status} />
                      </div>
                      <div className="mt-1 truncate text-sm text-muted-foreground">
                        {job.realtimeData ? 'Realtime' : job.tradeDate} · {getDepthLabel(job.depth)} · {job.reportCount || 0} reports
                      </div>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-1.5 top-1.5 h-8 w-8"
                          aria-label={`${job.ticker} 任务操作`}
                          disabled={deletingJobId !== null}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-red-600 focus:bg-red-50 focus:text-red-600"
                          disabled={deletingJobId !== null}
                          onSelect={() => handleDeleteJob(job.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    </div>
                  ))}
                  {!payload.jobs.length && (
                    <p className="rounded-md border border-dashed border-slate-200 bg-white/60 px-3 py-4 text-sm text-muted-foreground">
                      No analysis jobs yet.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {isReportFullscreen && (
            <button
              aria-label="Exit report fullscreen"
              className="fixed inset-0 z-40 bg-slate-950/20 backdrop-blur-sm"
              onClick={() => setIsReportFullscreen(false)}
              type="button"
            />
          )}

          <Card
            className={cn(
              'min-w-0 gap-0 overflow-hidden rounded-lg border-slate-200 bg-white py-0 shadow-sm transition-all duration-300 ease-out',
              isReportFullscreen &&
                'fixed inset-3 z-50 rounded-xl border-slate-300 shadow-2xl sm:inset-5 lg:inset-6'
            )}
          >
            <CardHeader className="gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-base text-slate-950">Report</CardTitle>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {selectedJob
                      ? `${selectedJob.ticker} · ${selectedJob.realtimeData ? 'Realtime' : selectedJob.tradeDate}`
                      : 'Select a completed or running job to view saved reports.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {selectedJob?.status === 'failed' && (
                    <Button
                      className="rounded-md"
                      disabled={retryingJobId === selectedJob.id}
                      onClick={() => handleRetryJob(selectedJob.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {retryingJobId === selectedJob.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-4 w-4" />
                      )}
                      Continue
                    </Button>
                  )}
                  <button
                    aria-label={
                      isReportFullscreen
                        ? 'Exit report fullscreen'
                        : 'Enter report fullscreen'
                    }
                    className="flex size-9 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm transition hover:bg-emerald-100 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                    onClick={() => setIsReportFullscreen(!isReportFullscreen)}
                    title={
                      isReportFullscreen
                        ? 'Exit report fullscreen'
                        : 'Enter report fullscreen'
                    }
                    type="button"
                  >
                    {isReportFullscreen ? (
                      <Minimize2 className="size-4" />
                    ) : (
                      <Maximize2 className="size-4" />
                    )}
                  </button>
                  {selectedReports.length > 0 && (
                    <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
                      {selectedReports.length} sections
                    </span>
                  )}
                </div>
              </div>

              {selectedReports.length > 0 && (
                <div
                  className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
                  role="tablist"
                >
                  {selectedReports.map((report) => (
                    <Button
                      key={report.id}
                      type="button"
                      size="sm"
                      variant={
                        selectedReport?.id === report.id ? 'default' : 'outline'
                      }
                      className="max-w-[240px] shrink-0 overflow-hidden text-ellipsis rounded-md"
                      onClick={() => setSelectedReportKey(report.reportKey)}
                    >
                      {report.title}
                    </Button>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
              {selectedReports.length > 0 ? (
                <article
                  ref={reportScrollRef}
                  key={`${selectedJobId}-${selectedReport?.reportKey || selectedReportKey}`}
                  className={cn(
                    'overflow-auto bg-white px-5 py-6 sm:px-8 lg:px-10',
                    isReportFullscreen
                      ? 'h-full min-h-0'
                      : 'min-h-[520px] lg:h-[calc(100dvh-280px)] lg:min-h-[640px]'
                  )}
                >
                  <MarkdownRenderer
                    content={selectedReport?.content || ''}
                    className="max-w-none"
                  />
                </article>
              ) : (
                <div className="flex min-h-[520px] items-center justify-center bg-white px-6 text-center">
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Select a completed or running job to view saved reports.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function StatusLabel({ status }: { status: string }) {
  const className =
    status === 'complete'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'failed'
        ? 'border-red-200 bg-red-50 text-red-700'
        : status === 'running'
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-amber-200 bg-amber-50 text-amber-700';

  return (
    <span
      className={`inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-medium ${className}`}
    >
      {status}
    </span>
  );
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
