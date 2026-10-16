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
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { analysisFetcher, canRetainAnalysisData, shouldRetryAnalysisRead } from '@/lib/http/analysis-fetcher';
import { pollingDefaults } from '@/lib/http/polling';
import { AnalysisActionError, presentActionError } from '@/lib/analysis/action-error';
import type { PresentedError } from '@/lib/analysis/error-presentation';
import { ErrorPresentation } from '@/components/error-presentation';
import { analysisStatusMessage } from '@/lib/analysis/client-status-message';
const AnalysisProgress = dynamic(() => import('@/components/analysis-progress').then(m => m.AnalysisProgress));
const MarkdownRenderer = dynamic(() => import('@/components/markdown-renderer').then(m => m.MarkdownRenderer));
import { cn } from '@/lib/utils';
import { Loader2, Maximize2, Minimize2, MoreHorizontal, Play, RefreshCcw, Trash2 } from 'lucide-react';
import {
  getDepthCreditCostFromConfig,
  getDepthLabel,
  normalizePricingConfig
} from '@/lib/analysis/pricing';

import { ResumeWithModels, type ResumeSelection } from '@/components/resume-with-models';
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
  quickModelConfigId?: number | null;
  deepModelConfigId?: number | null;
  quickModel?: string | null;
  deepModel?: string | null;
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
  models?: Array<{ id: number; name: string; modelName: string; provider: string; isDefault: boolean; quickEnabled: boolean; deepEnabled: boolean }>;
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
  // Keep this callback stable: detail updates every 5s must not reset the 7s list timer.
  const jobsRefreshInterval = useCallback((data?: JobsPayload) =>
    (data ?? (before === null ? initialPayload : undefined))?.jobs.some(job => LIVE_JOB_STATUSES.has(job.status))
      ? JOBS_POLL_INTERVAL_MS : 0, [before, initialPayload]);
  const { data: payload = { ...initialPayload, jobs: [] }, error: listError, isLoading: loading, mutate: loadJobs } = useSWR<JobsPayload>(jobsUrl, analysisFetcher, {
    ...pollingDefaults, shouldRetryOnError: shouldRetryAnalysisRead,
    fallbackData: before === null ? initialPayload : undefined,
    revalidateOnMount: true,
    refreshInterval: jobsRefreshInterval
  });
  const jobsLoadError = listError?.message || '';
  const [selectedJobId, setSelectedJobId] = useState<number | null>(initialPayload.jobs[0]?.id ?? null);
  const [selectedReportKey, setSelectedReportKey] = useState<string>('');
  const [quickModelConfigId, setQuickModelConfigId] = useState<number | null>(null);
  const [deepModelConfigId, setDeepModelConfigId] = useState<number | null>(null);
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
  const [error, setError] = useState<PresentedError | null>(null);
  const [invalidField, setInvalidField] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const actionLock = useRef(false);
  const refreshLock = useRef(false);
  const reportPanelRef = useRef<HTMLDivElement | null>(null);
  const [isReportFullscreen, setIsReportFullscreen] = useState(false);
  const reportScrollRef = useRef<HTMLElement | null>(null);


  const selectedJob = useMemo(
    () => payload.jobs.find((job) => job.id === selectedJobId),
    [payload.jobs, selectedJobId]
  );

  const detailRefreshInterval = useCallback((data?: { job?: { status?: string } }) =>
    LIVE_JOB_STATUSES.has(data?.job?.status || '') ? REPORT_POLL_INTERVAL_MS : 0, []);
  const { data: detail, error: detailError, isLoading: detailLoading, mutate: refreshDetail } = useSWR(
    selectedJobId ? `/api/analysis/jobs/${selectedJobId}` : null, analysisFetcher, {
      ...pollingDefaults, shouldRetryOnError: shouldRetryAnalysisRead,
      refreshInterval: detailRefreshInterval
    }
  );
  const selectedReports: Report[] = canRetainAnalysisData(detailError) && detail?.job?.id === selectedJobId
    ? (detail?.reports || []).filter((report: Report) => report.reportKey !== 'execution') : [];
  const usageJob: Job | null = canRetainAnalysisData(detailError) && detail?.job?.id === selectedJobId ? detail?.job || null : null;
  const calls: UsageCall[] = canRetainAnalysisData(detailError) && detail?.job?.id === selectedJobId ? detail?.calls || [] : [];
  const statusJob = usageJob?.id === selectedJobId ? usageJob : selectedJob;
  const effectiveReportKey = selectedReports.some(r => r.reportKey === selectedReportKey)
    ? selectedReportKey : (selectedReports.find(r => r.reportKey === 'progress') || selectedReports[0])?.reportKey ||
      (selectedJob?.defaultReportKey !== 'execution' ? selectedJob?.defaultReportKey : '') || '';
  const reportStatus = usageJob?.status || selectedJob?.status || '';
  const reportRefreshInterval = useCallback(() => LIVE_JOB_STATUSES.has(reportStatus)
    ? REPORT_POLL_INTERVAL_MS : 0, [reportStatus]);
  const { data: reportData, error: reportError, isLoading: reportLoading, mutate: refreshReport } = useSWR(
    selectedJobId && effectiveReportKey ? `/api/analysis/jobs/${selectedJobId}?report=${encodeURIComponent(effectiveReportKey)}` : null,
    analysisFetcher, { ...pollingDefaults, shouldRetryOnError: shouldRetryAnalysisRead,
      refreshInterval: reportRefreshInterval
    }
  );
  const selectedReport: Report | undefined = canRetainAnalysisData(detailError) && canRetainAnalysisData(reportError) && reportData?.report?.reportKey === effectiveReportKey ? reportData?.report : undefined;
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
    if (!loading && !listError && !payload.jobs.some(job => job.id === selectedJobId)) setSelectedJobId(payload.jobs[0]?.id ?? null);
  }, [payload.jobs, selectedJobId, loading, listError]);
  const requestError = detailError?.message || reportError?.message || '';
  const pricing = normalizePricingConfig(payload.pricing);
  const selectedDepthCost = getDepthCreditCostFromConfig(depth, pricing);
  const hasEnoughCredits = payload.credits >= selectedDepthCost;
  const models = payload.models ?? [];
  const quickModels = models.filter(model => model.quickEnabled);
  const deepModels = models.filter(model => model.deepEnabled);
  const selectedQuickId = quickModels.some(model => model.id === quickModelConfigId) ? quickModelConfigId : (quickModels.find(model => model.isDefault) ?? quickModels[0])?.id ?? null;
  const selectedDeepId = deepModels.some(model => model.id === deepModelConfigId) ? deepModelConfigId : (deepModels.find(model => model.isDefault) ?? deepModels[0])?.id ?? null;

  async function loadJobDetail(_id: number) {
    await Promise.all([refreshDetail(), refreshReport()]);
  }
  async function handleRefresh() {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    setError(null);
    try { await Promise.all([loadJobs(), refreshDetail(), refreshReport()]); }
    finally { refreshLock.current = false; setRefreshing(false); }
  }

  useEffect(() => {
    if (!isReportFullscreen) {
      return;
    }

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousScroll = reportScrollRef.current?.scrollTop || 0;
    const panel = reportPanelRef.current;
    const siblings: Array<{ element: HTMLElement; inert: boolean }> = [];
    let child: HTMLElement | null = panel;
    while (child?.parentElement) {
      for (const sibling of Array.from(child.parentElement.children)) {
        if (sibling !== child && sibling instanceof HTMLElement) { siblings.push({ element: sibling, inert: sibling.inert }); sibling.inert = true; }
      }
      child = child.parentElement;
    }
    panel?.querySelector<HTMLElement>('button[aria-label="Exit report fullscreen"]')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Tab' && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], summary, [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === 'Escape') {
        setIsReportFullscreen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      siblings.forEach(({ element, inert }) => { element.inert = inert; });
      if (reportScrollRef.current) reportScrollRef.current.scrollTop = previousScroll;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [isReportFullscreen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLock.current) return;
    actionLock.current = true;
    setNotice('');
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/analysis/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quickModelConfigId: selectedQuickId,
          deepModelConfigId: selectedDeepId,
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
        throw new AnalysisActionError(response.status, data.error || 'Failed to create analysis job');
      }
      await Promise.allSettled([loadJobs()]);
      setSelectedReportKey('');
      setSelectedJobId(data.job.id);
      setNotice('Analysis queued.');
    } catch (err) {
      setError(presentActionError(err, 'queue'));
    } finally {
      actionLock.current = false;
      setSubmitting(false);
    }
  }

  async function handleDeleteJob(id: number) {
    if (actionLock.current || !window.confirm('Delete this job from your list? You can restore it from Recently deleted.')) return;
    actionLock.current = true;
    setNotice('');
    setDeletingJobId(id);
    setError(null);
    try {
      const response = await fetch(`/api/analysis/jobs/${id}`, { method: 'DELETE' });
      const data = await readJson(response);
      if (!response.ok) throw new AnalysisActionError(response.status, data.error || 'Failed to delete job');
      if (selectedJobId === id) {
        setSelectedReportKey('');
        setSelectedJobId(null);
      }
      await Promise.allSettled([loadJobs()]);
      setNotice('Job deleted.');
    } catch (err) {
      setError(presentActionError(err, 'delete'));
    } finally {
      actionLock.current = false;
      setDeletingJobId(null);
    }
  }

  async function handleRetryJob(id: number, replacement?: ResumeSelection): Promise<boolean> {
    if (actionLock.current) return false;
    actionLock.current = true;
    setNotice('');
    setRetryingJobId(id);
    setError(null);
    try {
      const response = await fetch(`/api/analysis/jobs/${id}/retry`, {
        method: 'POST',
        headers: replacement ? { 'Content-Type': 'application/json' } : undefined,
        body: replacement ? JSON.stringify(replacement) : undefined
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new AnalysisActionError(response.status, data.error || 'Failed to continue analysis job');
      }
      await Promise.allSettled([loadJobs()]);
      await Promise.allSettled([loadJobDetail(id)]);
      setNotice(replacement ? '' : 'Analysis continuation requested.');
      return true;
    } catch (err) {
      setError(presentActionError(err, 'continue'));
      return false;
    } finally {
      actionLock.current = false;
      setRetryingJobId(null);
    }
  }

  return (
    <section className="min-w-0 flex-1 bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-[2400px] flex-col gap-6">
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
            disabled={loading || refreshing} aria-busy={refreshing}
          >
            <RefreshCcw className="h-4 w-4" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        {(error || requestError) && (
          <ErrorPresentation error={requestError} presentation={error ?? undefined} onDismiss={error ? () => setError(null) : undefined} context="request" onRetry={!error && requestError ? handleRefresh : undefined} retrying={refreshing} />
        )}

        <div className="grid min-h-0 min-w-0 gap-6 xl:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5 xl:sticky xl:top-6 xl:self-start">
            <Card className="rounded-lg border-slate-200 py-5 shadow-sm">
              <CardHeader className="px-5">
                <CardTitle className="text-base">New Analysis</CardTitle>
              </CardHeader>
              <CardContent className="px-5">
                <form className="space-y-4" onSubmit={handleSubmit} onInvalid={event => setInvalidField((event.target as HTMLInputElement).id)} onChange={() => setInvalidField('')}>
                  {invalidField && <p id="analysis-field-error" role="alert" className="text-sm text-red-700">Complete the highlighted field.</p>}
                  <div>
                    <Label htmlFor="ticker" className="mb-2">
                      Ticker
                    </Label>
                    <Input
                      aria-invalid={invalidField === "ticker"}
                      aria-describedby={invalidField === "ticker" ? "analysis-field-error" : undefined}
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
                      aria-invalid={invalidField === "tradeDate"}
                      aria-describedby={invalidField === "tradeDate" ? "analysis-field-error" : undefined}
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
                    <div className="space-y-3">
                      <div><Label htmlFor="analysis-quick-model" className="mb-2">Quick Model · Research and debate</Label><select aria-invalid={invalidField === "analysis-quick-model"} aria-describedby={invalidField === "analysis-quick-model" ? "analysis-field-error" : undefined} id="analysis-quick-model" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedQuickId ?? ''} onChange={event => setQuickModelConfigId(Number(event.target.value))} required>{quickModels.map(model => <option key={model.id} value={model.id}>{model.name} · {model.modelName}</option>)}</select></div>
                      <div><Label htmlFor="analysis-deep-model" className="mb-2">Deep Model · In-depth research and decisions</Label><select aria-invalid={invalidField === "analysis-deep-model"} aria-describedby={invalidField === "analysis-deep-model" ? "analysis-field-error" : undefined} id="analysis-deep-model" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedDeepId ?? ''} onChange={event => setDeepModelConfigId(Number(event.target.value))} required>{deepModels.map(model => <option key={model.id} value={model.id}>{model.name} · {model.modelName}</option>)}</select></div>
                      <p className="text-xs text-slate-500">Choose models for initial research and in-depth decisions.</p>
                    </div>
                  ) : <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No models are available. Contact your administrator.</div>}
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
                    aria-busy={submitting}
                    type="submit"
                    className="w-full rounded-md"
                    disabled={submitting || retryingJobId !== null || deletingJobId !== null || !hasEnoughCredits || !selectedQuickId || !selectedDeepId}
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {submitting ? 'Queueing…' : hasEnoughCredits ? 'Queue Analysis' : 'Not Enough Credits'}
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
                  {before !== null && <Button variant="outline" size="sm" onClick={() => { setBefore(null); }}>First page</Button>}
                  {payload.nextCursor && <Button variant="outline" size="sm" onClick={() => setBefore(payload.nextCursor!)}>Next page</Button>}
                </div>
                <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                  {loading && <p role="status" className="py-3 text-sm text-slate-500">Loading jobs…</p>}
                  {jobsLoadError && (
                    <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                      <ErrorPresentation error={jobsLoadError} context="request" compact />
                      <Button type="button" variant="outline" className="mt-2" onClick={() => loadJobs()}>Retry loading</Button>
                    </div>
                  )}
                  {!loading && !jobsLoadError && payload.jobs.length === 0 && <p className="py-3 text-sm text-slate-500">No jobs yet.</p>}
                  {payload.jobs.map((job) => (
                    <div key={job.id} className="relative">
                    <button
                      className={`w-full rounded-md border py-3 pl-3 pr-12 text-left transition ${
                        selectedJobId === job.id
                          ? 'border-slate-900 bg-white shadow-sm ring-1 ring-slate-900/5'
                          : 'border-slate-200 bg-white/70 hover:border-slate-300 hover:bg-white'
                      }`}
                      aria-pressed={selectedJobId === job.id}
                      onClick={() => { setSelectedReportKey(''); setSelectedJobId(job.id); }}
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
                        Models: {job.quickModel && job.deepModel && job.quickModel !== job.deepModel
                          ? `Quick ${job.quickModel} · Deep ${job.deepModel}`
                          : job.deepModel || job.quickModel || 'Not recorded'}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Created <time dateTime={job.createdAt}>{formatAnalysisDate(new Date(job.createdAt))}</time>
                      </div>
                      {analysisStatusMessage(job) && <p className="mt-2 text-xs text-slate-600">{analysisStatusMessage(job)}</p>}
                      {(job.status === 'failed' || job.errorMessage) && <ErrorPresentation error={job.errorMessage} jobId={job.id} compact />}
                      <AnalysisUsage job={job} compact />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild id={`job-menu-trigger-${job.id}`} aria-controls={`job-menu-content-${job.id}`}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-1.5 top-1.5 h-8 w-8"
                          aria-label={`${job.ticker} job actions`}
                          disabled={deletingJobId !== null || submitting || retryingJobId !== null}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" id={`job-menu-content-${job.id}`} aria-labelledby={`job-menu-trigger-${job.id}`}>
                        <DropdownMenuItem
                          className="text-red-600 focus:bg-red-50 focus:text-red-600"
                          disabled={deletingJobId !== null || submitting || retryingJobId !== null}
                          onSelect={() => handleDeleteJob(job.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
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
            ref={reportPanelRef}
            role={isReportFullscreen ? "dialog" : undefined}
            aria-modal={isReportFullscreen ? true : undefined}
            aria-label={isReportFullscreen ? "Analysis report" : undefined}
            className={cn(
              'min-w-0 gap-0 overflow-hidden rounded-lg border-slate-200 bg-white py-0 shadow-sm transition-all duration-300 ease-out',
              isReportFullscreen &&
                'fixed inset-3 z-50 rounded-xl border-slate-300 shadow-2xl sm:inset-5 lg:inset-6'
            )}
          >
            <CardHeader className="gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
              {selectedJob && <AnalysisUsage job={usageJob?.id === selectedJob.id ? usageJob : selectedJob} calls={usageJob?.id === selectedJob.id ? calls : []} />}
              {statusJob?.status === 'failed' && <ResumeWithModels key={statusJob.id} jobId={statusJob.id} models={models} quickId={statusJob.quickModelConfigId} deepId={statusJob.deepModelConfigId} disabled={retryingJobId !== null || submitting || deletingJobId !== null} onResume={handleRetryJob} />}
              {detail?.job?.id === selectedJobId && !!detail?.resumptions?.length && <details className="mt-3 rounded-md border p-3 text-xs"><summary className="cursor-pointer">模型更换记录 ({detail.resumptions.length})</summary><ul className="mt-2 space-y-2">{detail.resumptions.map((entry: {id:number;previousQuickModel:string|null;previousDeepModel:string|null;nextQuickModel:string;nextDeepModel:string;createdAt:string})=><li key={entry.id}>{new Date(entry.createdAt).toLocaleString()} · Quick: {entry.previousQuickModel||'—'} → {entry.nextQuickModel} · Deep: {entry.previousDeepModel||'—'} → {entry.nextDeepModel}</li>)}</ul></details>}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-base text-slate-950">Report</CardTitle>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {selectedJob
                      ? `${selectedJob.ticker} · ${selectedJob.realtimeData ? 'Realtime' : selectedJob.tradeDate}`
                      : 'Select a completed or running job to view saved reports.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {statusJob?.status === 'failed' && (
                    <Button
                      className="rounded-md"
                      disabled={retryingJobId !== null || submitting || deletingJobId !== null}
                      onClick={() => handleRetryJob(statusJob.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {retryingJobId === statusJob.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-4 w-4" />
                      )}
                      {retryingJobId === statusJob.id ? 'Continuing…' : 'Continue'}
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

              {statusJob && analysisStatusMessage(statusJob) && <p role="status" className="text-sm text-slate-600">{analysisStatusMessage(statusJob)}</p>}
              {statusJob && (statusJob.status === 'failed' || statusJob.errorMessage) && <ErrorPresentation error={statusJob.errorMessage} jobId={statusJob.id} />}
              {selectedReports.length > 0 && (
                <div
                  className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
                  aria-label="Report sections"
                >
                  {selectedReports.map((report) => (
                    <Button
                      aria-pressed={effectiveReportKey === report.reportKey}
                      key={report.id}
                      type="button"
                      size="sm"
                      variant={
                        effectiveReportKey === report.reportKey ? 'default' : 'outline'
                      }
                      className="max-w-[240px] shrink-0 overflow-hidden text-ellipsis rounded-md"
                      onClick={() => setSelectedReportKey(report.reportKey)}
                    >
                      {report.reportKey === 'progress' ? 'Interactions' : report.title}
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
                    'min-w-0 overflow-auto bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8',
                    isReportFullscreen
                      ? 'h-full min-h-0'
                      : 'min-h-[520px] lg:h-[calc(100dvh-280px)] lg:min-h-[640px]'
                  )}
                >
                  {!selectedReport ? <p role="status">Loading report…</p> : selectedReport.reportKey === 'progress' ? <AnalysisProgress content={selectedReport.content} running={statusJob?.status === 'running'} /> : <MarkdownRenderer
                    content={selectedReport?.content || ''}
                    className="mx-auto w-full max-w-[80ch] min-w-0 [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:[overflow-wrap:normal] [&_figure]:min-w-0 [&_table]:[overflow-wrap:normal]"
                  />}
                </article>
              ) : (
                <div className="flex min-h-[520px] items-center justify-center bg-white px-6 text-center">
                  <p className="max-w-sm text-sm text-muted-foreground">
                    {detailError ? 'Unable to load reports. Use Retry above.' : detailLoading || reportLoading ? 'Loading reports…' : selectedJobId ? 'No saved reports yet.' : 'Select a completed or running job to view saved reports.'}
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
