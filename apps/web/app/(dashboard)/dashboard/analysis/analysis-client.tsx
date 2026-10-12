'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/http/json-fetcher';
import { pollingDefaults } from '@/lib/http/polling';
const AnalysisProgress = dynamic(() => import('@/components/analysis-progress').then(m => m.AnalysisProgress));
const MarkdownRenderer = dynamic(() => import('@/components/markdown-renderer').then(m => m.MarkdownRenderer));
import { cn } from '@/lib/utils';
import { Loader2, Maximize2, Minimize2, MoreHorizontal, Play, RefreshCcw, Trash2 } from 'lucide-react';
import {
  getDepthCreditCostFromConfig,
  getDepthLabel,
  normalizePricingConfig
} from '@/lib/analysis/pricing';

import { AnalysisUsage, type UsageJob, type UsageCall } from '@/components/analysis-usage';

type Job = UsageJob & {
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
  defaultReportKey?: string | null;
};

type Report = {
  id: number;
  reportKey: string;
  title: string;
  content: string;
  updatedAt?: string;
};

export type JobsPayload = {
  nextCursor?: number | null;
  credits: number;
  pricing?: Partial<Record<number, number>>;
  models?: Array<{ id: number; name: string; modelName: string; isDefault: boolean }>;
  jobs: Job[];
};

const JOBS_POLL_INTERVAL_MS = 7000;
const REPORT_POLL_INTERVAL_MS = 5000;
const LIVE_JOB_STATUSES = new Set(['queued', 'running']);

function formatAnalysisDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
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

export default function AnalysisClient({ initialPayload }: { initialPayload: JobsPayload }) {
  const [before, setBefore] = useState<number | null>(null);
  const jobsUrl = before ? `/api/analysis/jobs?before=${before}` : '/api/analysis/jobs';
  const { data: payload = initialPayload, error: listError, isLoading: loading, mutate: loadJobs } = useSWR<JobsPayload>(jobsUrl, jsonFetcher, {
    ...pollingDefaults,
    fallbackData: before === null ? initialPayload : undefined,
    revalidateIfStale: false,
    refreshInterval: data => data?.jobs.some(job => LIVE_JOB_STATUSES.has(job.status)) ? JOBS_POLL_INTERVAL_MS : 0
  });
  const jobsLoadError = listError?.message || '';
  const [selectedJobId, setSelectedJobId] = useState<number | null>(initialPayload.jobs[0]?.id ?? null);
  const [selectedReportKey, setSelectedReportKey] = useState<string>('');
  const [modelConfigId, setModelConfigId] = useState<number | null>(null);
  const [ticker, setTicker] = useState('AAPL');
  const [tradeDate, setTradeDate] = useState('');
  useEffect(() => {
    setTradeDate(formatAnalysisDate(new Date()));
  }, []);
  const [realtimeData, setRealtimeData] = useState(false);
  const [language, setLanguage] = useState('Chinese');
  const [depth, setDepth] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<number | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [isReportFullscreen, setIsReportFullscreen] = useState(false);
  const reportScrollRef = useRef<HTMLElement | null>(null);


  const selectedJob = useMemo(
    () => payload.jobs.find((job) => job.id === selectedJobId),
    [payload.jobs, selectedJobId]
  );

  const { data: detail, error: detailError, mutate: refreshDetail } = useSWR(
    selectedJobId ? `/api/analysis/jobs/${selectedJobId}` : null, jsonFetcher, {
      ...pollingDefaults,
      refreshInterval: data => LIVE_JOB_STATUSES.has(data?.job?.status) ? REPORT_POLL_INTERVAL_MS : 0
    }
  );
  const selectedReports: Report[] = detail?.reports || [];
  const usageJob: Job | null = detail?.job || null;
  const calls: UsageCall[] = detail?.calls || [];
  const effectiveReportKey = selectedReports.some(r => r.reportKey === selectedReportKey)
    ? selectedReportKey : (selectedReports.find(r => r.reportKey === 'progress') || selectedReports[0])?.reportKey || selectedJob?.defaultReportKey || '';
  const { data: reportData, error: reportError, mutate: refreshReport } = useSWR(
    selectedJobId && effectiveReportKey ? `/api/analysis/jobs/${selectedJobId}?report=${encodeURIComponent(effectiveReportKey)}` : null,
    jsonFetcher, { ...pollingDefaults,
      refreshInterval: () => LIVE_JOB_STATUSES.has(usageJob?.status || selectedJob?.status || '') ? REPORT_POLL_INTERVAL_MS : 0
    }
  );
  const selectedReport: Report | undefined = reportData?.report;
  const previousDetail = useRef<{ id: number; status: string; revision: string; key: string } | null>(null);
  useEffect(() => {
    if (!usageJob) return;
    const revision = selectedReports.find(r => r.reportKey === effectiveReportKey)?.updatedAt || '';
    const previous = previousDetail.current;
    if (previous?.id === usageJob.id && previous.key === effectiveReportKey && (previous.revision !== revision ||
      LIVE_JOB_STATUSES.has(previous.status) && !LIVE_JOB_STATUSES.has(usageJob.status))) refreshReport();
    previousDetail.current = { id: usageJob.id, status: usageJob.status, revision, key: effectiveReportKey };
  }, [usageJob?.id, usageJob?.status, selectedReports, effectiveReportKey, refreshReport]);
  useEffect(() => {
    if (!payload.jobs.some(job => job.id === selectedJobId)) setSelectedJobId(payload.jobs[0]?.id ?? null);
  }, [payload.jobs, selectedJobId]);
  const requestError = detailError?.message || reportError?.message || '';
  const pricing = normalizePricingConfig(payload.pricing);
  const selectedDepthCost = getDepthCreditCostFromConfig(depth, pricing);
  const hasEnoughCredits = payload.credits >= selectedDepthCost;
  const models = payload.models ?? [];
  const selectedModelId = models.some(model => model.id === modelConfigId) ? modelConfigId : (models.find(model => model.isDefault) ?? models[0])?.id ?? null;

  async function loadJobDetail(_id: number) {
    await Promise.all([refreshDetail(), refreshReport()]);
  }
  async function handleRefresh() {
    await Promise.all([loadJobs(), refreshDetail(), refreshReport()]);
  }

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
          modelConfigId: selectedModelId,
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

        {(error || requestError) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error || requestError}
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
                  {models.length ? (
                    <div>
                      <Label htmlFor="analysis-model" className="mb-2">分析模型</Label>
                      <select id="analysis-model" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedModelId ?? ''} onChange={event => setModelConfigId(Number(event.target.value))} required>
                        {models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.modelName}</option>)}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">所有分析阶段使用所选模型。</p>
                    </div>
                  ) : <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">暂无可用模型，请联系管理员。</div>}
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
                    disabled={submitting || !hasEnoughCredits || !selectedModelId}
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
                <div className="mb-3 flex gap-2">
                  {before !== null && <Button variant="outline" size="sm" onClick={() => { setBefore(null); }}>第一页</Button>}
                  {payload.nextCursor && <Button variant="outline" size="sm" onClick={() => setBefore(payload.nextCursor!)}>下一页</Button>}
                </div>
                <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                  {loading && <p role="status" className="py-3 text-sm text-slate-500">正在加载任务列表…</p>}
                  {jobsLoadError && (
                    <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                      <p>任务列表加载失败：{jobsLoadError}</p>
                      <Button type="button" variant="outline" className="mt-2" onClick={() => loadJobs()}>重试加载</Button>
                    </div>
                  )}
                  {!loading && !jobsLoadError && payload.jobs.length === 0 && <p className="py-3 text-sm text-slate-500">暂无任务。</p>}
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
                      <div className="mt-1 text-xs text-muted-foreground">
                        创建于 <time dateTime={job.createdAt}>{formatAnalysisDate(new Date(job.createdAt))}</time>
                      </div>
                      <AnalysisUsage job={job} compact />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild id={`job-menu-trigger-${job.id}`} aria-controls={`job-menu-content-${job.id}`}>
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
                      <DropdownMenuContent align="end" id={`job-menu-content-${job.id}`} aria-labelledby={`job-menu-trigger-${job.id}`}>
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
              {selectedJob && <AnalysisUsage job={usageJob?.id === selectedJob.id ? usageJob : selectedJob} calls={usageJob?.id === selectedJob.id ? calls : []} />}
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
                        effectiveReportKey === report.reportKey ? 'default' : 'outline'
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
                  {!selectedReport ? <p role="status">正在加载报告…</p> : selectedReport.reportKey === 'progress' ? <AnalysisProgress content={selectedReport.content} running={selectedJob?.status === 'running'} /> : <MarkdownRenderer
                    content={selectedReport?.content || ''}
                    className="max-w-none"
                  />}
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
