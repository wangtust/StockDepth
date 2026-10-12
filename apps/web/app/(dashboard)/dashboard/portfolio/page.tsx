'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Brain,
  BriefcaseBusiness,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCcw,
  Star,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getDepthCreditCostFromConfig,
  getDepthLabel,
  normalizePricingConfig
} from '@/lib/analysis/pricing';
import { cn } from '@/lib/utils';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/http/json-fetcher';
import { pollingDefaults } from '@/lib/http/polling';

type Portfolio = {
  id: number;
  name: string;
  initialCashCents: number;
  cashCents: number;
  currency: string;
  status: string;
  autoTradeEnabled: boolean;
};

type WatchlistItem = {
  id: number;
  ticker: string;
  market?: string | null;
  name?: string | null;
};

type Position = {
  id: number;
  ticker: string;
  quantity: number;
  avgCostCents: number;
  lastPriceCents: number;
  realizedPnlCents: number;
};

type Trade = {
  id: number;
  ticker: string;
  side: 'buy' | 'sell';
  quantity: number;
  priceCents: number;
  grossAmountCents: number;
  realizedPnlCents: number;
  note?: string | null;
  createdAt: string;
};

type AnalysisRun = {
  id: number;
  ticker: string;
  createdAt: string;
  watchlistItemId?: number | null;
  jobId: number;
  tradeDate: string;
  realtimeData?: boolean;
  depth: number;
  status: string;
  externalStatus?: string | null;
  errorMessage?: string | null;
  updatedAt: string;
  reportCount: number;
  decisionId?: number | null;
  decisionAction?: string | null;
  decisionConfidenceBps?: number | null;
  decisionTargetWeightBps?: number | null;
  decisionQuantity?: number | null;
  decisionPriceCents?: number | null;
  decisionReason?: string | null;
  decisionRiskNotes?: string | null;
  decisionStatus?: string | null;
  decisionErrorMessage?: string | null;
  decisionCreatedAt?: string | null;
};

type PaperPayload = {
  credits: number;
  pricing?: Partial<Record<number, number>>;
  defaultModel?: {
    id: number;
    name: string;
    provider: string;
    modelName: string;
    isDefault: boolean;
  } | null;
  portfolio: Portfolio | null;
  watchlist: WatchlistItem[];
  positions: Position[];
  trades: Trade[];
  analysisRuns: AnalysisRun[];
  hasActiveAnalysisRuns?: boolean;
};

const emptyPayload: PaperPayload = {
  credits: 0,
  pricing: undefined,
  defaultModel: null,
  portfolio: null,
  watchlist: [],
  positions: [],
  trades: [],
  analysisRuns: []
};

function formatMoney(cents: number, currency = 'USD') {
  const safeCents = Number.isFinite(cents) ? cents : 0;
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: safeCurrency,
    maximumFractionDigits: 2
  }).format(safeCents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export default function PortfolioPage() {
  const { data, error: readError, isLoading: loading, mutate } = useSWR<PaperPayload>(
    '/api/paper',
    jsonFetcher,
    {
      ...pollingDefaults,
      // Portfolio reads are relatively large; only live jobs need periodic updates.
      refreshInterval: (current) => (current?.hasActiveAnalysisRuns || current?.analysisRuns?.some(
        (run) => run.status === 'queued' || run.status === 'running'
      )) ? 10000 : 0,
      shouldRetryOnError: false
    }
  );
  const payload = useMemo(() => data ? normalizePayload(data) : emptyPayload, [data]);
  const [portfolioName, setPortfolioName] = useState('Paper Portfolio');
  const [initialCash, setInitialCash] = useState('100000');
  const [watchTicker, setWatchTicker] = useState('');
  const [watchName, setWatchName] = useState('');
  const [tradeTicker, setTradeTicker] = useState('');
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('10');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [selectedWatchlistIds, setSelectedWatchlistIds] = useState<number[]>([]);
  const [analysisDepth, setAnalysisDepth] = useState(1);
  const [analysisRealtimeData, setAnalysisRealtimeData] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const portfolio = payload.portfolio;
  const currency = portfolio?.currency || 'USD';
  const openPositions = payload.positions.filter((position) => position.quantity > 0);
  const positionsValueCents = openPositions.reduce(
    (sum, position) => sum + position.quantity * position.lastPriceCents,
    0
  );
  const totalValueCents = (portfolio?.cashCents || 0) + positionsValueCents;
  const totalPnlCents = portfolio
    ? totalValueCents - portfolio.initialCashCents
    : 0;
  const pricing = normalizePricingConfig(payload.pricing);
  const selectedAnalysisCost =
    getDepthCreditCostFromConfig(analysisDepth, pricing) *
    selectedWatchlistIds.length;
  const defaultModel = payload.defaultModel ?? null;

  const selectedPosition = useMemo(
    () =>
      payload.positions.find(
        (position) => position.ticker === tradeTicker.toUpperCase()
      ),
    [payload.positions, tradeTicker]
  );

  useEffect(() => {
    if (!data) return;
    setTradeTicker((current) => current || payload.watchlist[0]?.ticker || '');
  }, [data, payload.watchlist]);

  async function loadPaper() {
    // Explicit reads must reject on failure; SWR's plain revalidation swallows
    // fetch errors. A mutation also prevents an older in-flight read overwriting it.
    await mutate(() => jsonFetcher('/api/paper'), { revalidate: false });
  }

  async function refreshAfterMutation() {
    try {
      await loadPaper();
    } catch (err) {
      // The write already succeeded. Keep its result so the user does not repeat it.
      setError(`Saved, but refreshing the portfolio failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function submitJson(path: string, body: unknown, label: string) {
    setBusy(label);
    setError('');
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || 'Request failed.');
      }
      await refreshAfterMutation();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy('');
    }
  }

  async function handleCreatePortfolio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const initialCashValue = Number(initialCash);
    if (!Number.isFinite(initialCashValue) || initialCashValue <= 0) {
      setError('Initial cash must be a positive number.');
      return;
    }
    await submitJson(
      '/api/paper/portfolio',
      { name: portfolioName.trim() || 'Paper Portfolio', initialCash: initialCashValue },
      'portfolio'
    );
  }

  async function handleAddWatchlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = await submitJson(
      '/api/paper/watchlist',
      { ticker: watchTicker, name: watchName },
      'watchlist'
    );
    if (data) {
      setTradeTicker(data.item.ticker);
      setWatchTicker('');
      setWatchName('');
    }
  }

  async function handleRemoveWatchlist(id: number) {
    setBusy(`watchlist-${id}`);
    setError('');
    try {
      const response = await fetch(`/api/paper/watchlist?id=${id}`, {
        method: 'DELETE'
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove ticker.');
      }
      setSelectedWatchlistIds((currentIds) => currentIds.filter((currentId) => currentId !== id));
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function handleTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!portfolio) {
      setError('Create a paper portfolio first.');
      return;
    }
    const quantityValue = Number(quantity);
    const priceValue = Number(price);
    if (!Number.isInteger(quantityValue) || quantityValue <= 0) {
      setError('Shares must be a positive whole number.');
      return;
    }
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      setError('Price must be a positive number.');
      return;
    }
    const data = await submitJson(
      '/api/paper/trades',
      {
        portfolioId: portfolio.id,
        ticker: tradeTicker,
        side: tradeSide,
        quantity: quantityValue,
        price: priceValue,
        note
      },
      'trade'
    );
    if (data) {
      setNote('');
    }
  }

  async function handleToggleAutoTrade(enabled: boolean) {
    if (!portfolio) {
      return;
    }
    setBusy('auto-trade');
    setError('');
    try {
      const response = await fetch('/api/paper/portfolio/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId: portfolio.id,
          autoTradeEnabled: enabled
        })
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update auto trading setting.');
      }
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function handleExecuteDecision(id: number) {
    setBusy(`decision-${id}`);
    setError('');
    try {
      const response = await fetch(`/api/paper/decisions/${id}/execute`, {
        method: 'POST'
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || 'Failed to execute decision.');
      }
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function handleAnalyzeSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!portfolio) {
      setError('Create a paper portfolio first.');
      return;
    }
    if (!selectedWatchlistIds.length) {
      setError('Select at least one watchlist stock to analyze.');
      return;
    }
    if (!defaultModel) {
      setError('No active model is configured.');
      return;
    }

    const data = await submitJson(
      '/api/paper/analyze',
      {
        portfolioId: portfolio.id,
        watchlistItemIds: selectedWatchlistIds,
        realtimeData: analysisRealtimeData,
        language: 'Chinese',
        depth: analysisDepth,
        analysts: ['market', 'social', 'news', 'fundamentals']
      },
      'analyze'
    );

    if (data) {
      setSelectedWatchlistIds([]);
    }
  }

  function toggleWatchlistItem(id: number) {
    setSelectedWatchlistIds((currentIds) =>
      currentIds.includes(id)
        ? currentIds.filter((currentId) => currentId !== id)
        : [...currentIds, id]
    );
  }

  const visibleError = error || (readError instanceof Error ? readError.message : readError ? String(readError) : '');

  if (!data) {
    return (
      <section className="flex-1 bg-slate-50 p-4 sm:p-6 lg:p-8">
        <h1 className="text-xl font-semibold text-slate-950">Paper Portfolio</h1>
        {loading ? <p role="status">Loading portfolio…</p> : <p role="alert">{visibleError || 'Portfolio data is unavailable.'}</p>}
        <Button variant="outline" disabled={loading} onClick={async () => {
          setError('');
          try { await loadPaper(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
        }}>Refresh</Button>
      </section>
    );
  }

  return (
    <section className="flex-1 bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-950 lg:text-2xl">
              Paper Portfolio
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Track watchlist names, place simulated trades, and queue AI analysis.
            </p>
          </div>
          <Button
            className="w-full rounded-md sm:w-auto"
            variant="outline"
            onClick={async () => {
              setError('');
              try {
                await loadPaper();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
            disabled={loading || Boolean(busy)}
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {visibleError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {visibleError}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Total Value"
            value={portfolio ? formatMoney(totalValueCents, currency) : '-'}
            icon={<BriefcaseBusiness className="h-5 w-5 text-slate-700" />}
          />
          <MetricCard
            title="Cash"
            value={portfolio ? formatMoney(portfolio.cashCents, currency) : '-'}
            icon={<ArrowDownToLine className="h-5 w-5 text-emerald-700" />}
          />
          <MetricCard
            title="Positions"
            value={formatMoney(positionsValueCents, currency)}
            icon={<Star className="h-5 w-5 text-amber-600" />}
          />
          <MetricCard
            title="Paper P&L"
            value={portfolio ? formatMoney(totalPnlCents, currency) : '-'}
            valueClassName={totalPnlCents >= 0 ? 'text-emerald-700' : 'text-red-700'}
            icon={<ArrowUpFromLine className="h-5 w-5 text-blue-700" />}
          />
        </div>

        {portfolio && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <label
              htmlFor="autoTradeEnabled"
              className="flex cursor-pointer items-start gap-3"
            >
              <input
                id="autoTradeEnabled"
                checked={portfolio.autoTradeEnabled}
                className="mt-1 h-4 w-4 rounded border-slate-300"
                disabled={busy === 'auto-trade'}
                onChange={(event) => handleToggleAutoTrade(event.target.checked)}
                type="checkbox"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-950">
                  Automatically execute eligible AI decisions
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Uses the same paper-trading risk checks. Decisions below confidence threshold remain skipped.
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
            {!portfolio && (
              <Card className="rounded-lg border-slate-200 py-5 shadow-sm">
                <CardHeader className="px-5">
                  <CardTitle className="text-base">Create Portfolio</CardTitle>
                </CardHeader>
                <CardContent className="px-5">
                  <form className="space-y-4" onSubmit={handleCreatePortfolio}>
                    <div>
                      <Label htmlFor="portfolioName" className="mb-2">
                        Name
                      </Label>
                      <Input
                        id="portfolioName"
                        value={portfolioName}
                        onChange={(event) => setPortfolioName(event.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="initialCash" className="mb-2">
                        Initial Cash
                      </Label>
                      <Input
                        id="initialCash"
                        inputMode="decimal"
                        value={initialCash}
                        onChange={(event) => setInitialCash(event.target.value)}
                        required
                      />
                    </div>
                    <Button
                      className="w-full rounded-md"
                      disabled={busy === 'portfolio'}
                      type="submit"
                    >
                      {busy === 'portfolio' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Create
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            <Card className="rounded-lg border-slate-200 py-5 shadow-sm">
              <CardHeader className="px-5">
                <CardTitle className="text-base">Watchlist</CardTitle>
              </CardHeader>
              <CardContent className="px-5">
                <form className="space-y-3" onSubmit={handleAddWatchlist}>
                  <div className="grid grid-cols-[1fr_1.2fr] gap-3">
                    <div>
                      <Label htmlFor="watchTicker" className="mb-2">
                        Ticker
                      </Label>
                      <Input
                        id="watchTicker"
                        value={watchTicker}
                        onChange={(event) =>
                          setWatchTicker(event.target.value.toUpperCase())
                        }
                        placeholder="AAPL"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="watchName" className="mb-2">
                        Name
                      </Label>
                      <Input
                        id="watchName"
                        value={watchName}
                        onChange={(event) => setWatchName(event.target.value)}
                        placeholder="Apple"
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full rounded-md"
                    disabled={busy === 'watchlist'}
                    type="submit"
                    variant="outline"
                  >
                    {busy === 'watchlist' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Add Ticker
                  </Button>
                </form>

                <div className="mt-4 space-y-2">
                  {payload.watchlist.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                    >
                      <input
                        aria-label={`Select ${item.ticker} for analysis`}
                        checked={selectedWatchlistIds.includes(item.id)}
                        className="h-4 w-4 rounded border-slate-300"
                        onChange={() => toggleWatchlistItem(item.id)}
                        type="checkbox"
                      />
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setTradeTicker(item.ticker)}
                        type="button"
                      >
                        <div className="font-medium text-slate-950">
                          {item.ticker}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {item.name || item.market || 'Watchlist'}
                        </div>
                      </button>
                      <Button
                        aria-label={`Remove ${item.ticker}`}
                        className="size-8 rounded-md"
                        disabled={busy === `watchlist-${item.id}`}
                        onClick={() => handleRemoveWatchlist(item.id)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        {busy === `watchlist-${item.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                  {!payload.watchlist.length && (
                    <p className="rounded-md border border-dashed border-slate-200 bg-white/60 px-3 py-4 text-sm text-muted-foreground">
                      Add stocks you want to follow.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-lg border-slate-200 py-5 shadow-sm">
              <CardHeader className="px-5">
                <CardTitle className="text-base">AI Analysis</CardTitle>
              </CardHeader>
              <CardContent className="px-5">
                <form className="space-y-4" onSubmit={handleAnalyzeSelected}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="analysisDepth" className="mb-2">
                        Depth
                      </Label>
                      <select
                        id="analysisDepth"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={analysisDepth}
                        onChange={(event) => setAnalysisDepth(Number(event.target.value))}
                      >
                        <option value={1}>Shallow</option>
                        <option value={3}>Medium</option>
                        <option value={5}>Deep</option>
                      </select>
                    </div>
                    <div>
                      <Label className="mb-2">Credits</Label>
                      <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                        {selectedAnalysisCost}
                      </div>
                    </div>
                  </div>
                  <label
                    htmlFor="analysisRealtimeData"
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <input
                      id="analysisRealtimeData"
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={analysisRealtimeData}
                      onChange={(event) => setAnalysisRealtimeData(event.target.checked)}
                    />
                    <span>Realtime data</span>
                  </label>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <div className="flex items-center justify-between gap-3">
                      <span>{selectedWatchlistIds.length} selected</span>
                      <span className="font-medium text-slate-950">
                        {payload.credits} credits available
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {defaultModel
                        ? `${defaultModel.name} · ${defaultModel.modelName}`
                        : 'No active model configured'}
                    </div>
                  </div>
                  <Button
                    className="w-full rounded-md"
                    disabled={
                      !portfolio ||
                      !selectedWatchlistIds.length ||
                      !defaultModel ||
                      selectedAnalysisCost > payload.credits ||
                      busy === 'analyze'
                    }
                    type="submit"
                  >
                    {busy === 'analyze' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Brain className="h-4 w-4" />
                    )}
                    {selectedAnalysisCost > payload.credits
                      ? 'Not Enough Credits'
                      : 'Analyze Selected'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="rounded-lg border-slate-200 py-5 shadow-sm">
              <CardHeader className="px-5">
                <CardTitle className="text-base">Simulated Trade</CardTitle>
              </CardHeader>
              <CardContent className="px-5">
                <form className="space-y-4" onSubmit={handleTrade}>
                  <div className="grid grid-cols-[1fr_120px] gap-3">
                    <div>
                      <Label htmlFor="tradeTicker" className="mb-2">
                        Ticker
                      </Label>
                      <Input
                        id="tradeTicker"
                        value={tradeTicker}
                        onChange={(event) =>
                          setTradeTicker(event.target.value.toUpperCase())
                        }
                        placeholder="AAPL"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="tradeSide" className="mb-2">
                        Side
                      </Label>
                      <select
                        id="tradeSide"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={tradeSide}
                        onChange={(event) =>
                          setTradeSide(event.target.value as 'buy' | 'sell')
                        }
                      >
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="quantity" className="mb-2">
                        Shares
                      </Label>
                      <Input
                        id="quantity"
                        inputMode="numeric"
                        value={quantity}
                        onChange={(event) => setQuantity(event.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="price" className="mb-2">
                        Price
                      </Label>
                      <Input
                        id="price"
                        inputMode="decimal"
                        value={price}
                        onChange={(event) => setPrice(event.target.value)}
                        placeholder="185.50"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="note" className="mb-2">
                      Note
                    </Label>
                    <Input
                      id="note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Manual paper trade"
                    />
                  </div>
                  {selectedPosition && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      Holding {selectedPosition.quantity} shares at{' '}
                      {formatMoney(selectedPosition.avgCostCents, currency)} avg.
                    </div>
                  )}
                  <Button
                    className="w-full rounded-md"
                    disabled={!portfolio || busy === 'trade'}
                    type="submit"
                  >
                    {busy === 'trade' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : tradeSide === 'buy' ? (
                      <ArrowDownToLine className="h-4 w-4" />
                    ) : (
                      <ArrowUpFromLine className="h-4 w-4" />
                    )}
                    {tradeSide === 'buy' ? 'Buy' : 'Sell'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="min-w-0 rounded-lg border-slate-200 py-5 shadow-sm">
              <CardHeader className="px-5">
                <CardTitle className="text-base">Positions</CardTitle>
              </CardHeader>
              <CardContent className="px-5">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Ticker</th>
                        <th className="py-2 pr-3 font-medium">Shares</th>
                        <th className="py-2 pr-3 font-medium">Avg Cost</th>
                        <th className="py-2 pr-3 font-medium">Last Price</th>
                        <th className="py-2 pr-3 font-medium">Value</th>
                        <th className="py-2 pr-3 font-medium">Unrealized</th>
                        <th className="py-2 pr-3 font-medium">Realized</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payload.positions.map((position) => {
                        const valueCents = position.quantity * position.lastPriceCents;
                        const unrealizedCents =
                          (position.lastPriceCents - position.avgCostCents) *
                          position.quantity;
                        return (
                          <tr key={position.id}>
                            <td className="py-3 pr-3">
                              <button
                                className="font-medium text-slate-950 hover:underline"
                                onClick={() => {
                                  setTradeTicker(position.ticker);
                                  setTradeSide(position.quantity > 0 ? 'sell' : 'buy');
                                  setPrice(
                                    position.lastPriceCents
                                      ? String(position.lastPriceCents / 100)
                                      : ''
                                  );
                                }}
                                type="button"
                              >
                                {position.ticker}
                              </button>
                            </td>
                            <td className="py-3 pr-3 text-slate-700">
                              {position.quantity}
                            </td>
                            <td className="py-3 pr-3 text-slate-700">
                              {formatMoney(position.avgCostCents, currency)}
                            </td>
                            <td className="py-3 pr-3 text-slate-700">
                              {formatMoney(position.lastPriceCents, currency)}
                            </td>
                            <td className="py-3 pr-3 text-slate-700">
                              {formatMoney(valueCents, currency)}
                            </td>
                            <td
                              className={cn(
                                'py-3 pr-3',
                                unrealizedCents >= 0
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              )}
                            >
                              {formatMoney(unrealizedCents, currency)}
                            </td>
                            <td
                              className={cn(
                                'py-3 pr-3',
                                position.realizedPnlCents >= 0
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              )}
                            >
                              {formatMoney(position.realizedPnlCents, currency)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!payload.positions.length && (
                    <div className="rounded-md border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-muted-foreground">
                      No paper positions yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="rounded-lg border-slate-200 py-5 shadow-sm">
                <CardHeader className="px-5">
                  <CardTitle className="text-base">AI Analysis Runs</CardTitle>
                </CardHeader>
                <CardContent className="px-5">
                  <div className="max-h-[360px] space-y-3 overflow-auto pr-1">
                    {payload.analysisRuns.map((run) => (
                      <div
                        key={run.id}
                        className="rounded-md border border-slate-200 bg-white px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-950">
                                {run.ticker}
                              </span>
                              <StatusLabel status={run.status} />
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {run.realtimeData ? 'Realtime' : run.tradeDate} ·{' '}
                              {getDepthLabel(run.depth)} · {run.reportCount} reports
                            </div>
                          </div>
                          <Button
                            asChild
                            className="size-8 rounded-md"
                            size="icon"
                            title="Open in Analysis"
                            variant="ghost"
                          >
                            <a href="/dashboard/analysis">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                        {run.errorMessage && (
                          <div className="mt-2 text-sm text-red-700">
                            {run.errorMessage}
                          </div>
                        )}
                        {run.decisionId && (
                          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium text-slate-950">
                                Decision: {run.decisionAction}
                              </span>
                              <span className="text-xs text-slate-500">
                                {Math.round((run.decisionConfidenceBps || 0) / 100)}%
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {run.decisionStatus} · Target{' '}
                              {((run.decisionTargetWeightBps || 0) / 100).toFixed(1)}%
                              {run.decisionQuantity
                                ? ` · ${run.decisionQuantity} shares`
                                : ''}
                            </div>
                            {run.decisionReason && (
                              <div className="mt-2 line-clamp-3 text-slate-700">
                                {run.decisionReason}
                              </div>
                            )}
                            {run.decisionErrorMessage && (
                              <div className="mt-2 text-xs text-amber-700">
                                {run.decisionErrorMessage}
                              </div>
                            )}
                            {run.decisionId &&
                              ['proposed', 'skipped'].includes(run.decisionStatus || '') &&
                              run.decisionAction !== 'hold' && (
                                <Button
                                  className="mt-3 w-full rounded-md"
                                  disabled={busy === `decision-${run.decisionId}`}
                                  onClick={() => handleExecuteDecision(run.decisionId!)}
                                  size="sm"
                                  type="button"
                                >
                                  {busy === `decision-${run.decisionId}` ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <ArrowDownToLine className="h-4 w-4" />
                                  )}
                                  Confirm Paper Trade
                                </Button>
                              )}
                          </div>
                        )}
                        <div className="mt-2 text-xs text-slate-500">
                          Queued {formatDate(run.createdAt)}
                        </div>
                      </div>
                    ))}
                    {!payload.analysisRuns.length && (
                      <p className="rounded-md border border-dashed border-slate-200 bg-white/60 px-3 py-4 text-sm text-muted-foreground">
                        Select watchlist stocks and queue AI analysis.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-lg border-slate-200 py-5 shadow-sm">
                <CardHeader className="px-5">
                  <CardTitle className="text-base">Trade Log</CardTitle>
                </CardHeader>
                <CardContent className="px-5">
                  <div className="max-h-[640px] space-y-3 overflow-auto pr-1">
                    {payload.trades.map((trade) => (
                    <div
                      key={trade.id}
                      className="rounded-md border border-slate-200 bg-white px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-950">
                              {trade.ticker}
                            </span>
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-xs font-medium',
                                trade.side === 'buy'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-blue-50 text-blue-700'
                              )}
                            >
                              {trade.side}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatDate(trade.createdAt)}
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="font-medium text-slate-950">
                            {trade.quantity} @ {formatMoney(trade.priceCents, currency)}
                          </div>
                          <div className="text-muted-foreground">
                            {formatMoney(trade.grossAmountCents, currency)}
                          </div>
                        </div>
                      </div>
                      {trade.note && (
                        <div className="mt-2 text-sm text-slate-600">
                          {trade.note}
                        </div>
                      )}
                      {trade.side === 'sell' && (
                        <div
                          className={cn(
                            'mt-2 text-sm',
                            trade.realizedPnlCents >= 0
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          )}
                        >
                          Realized {formatMoney(trade.realizedPnlCents, currency)}
                        </div>
                      )}
                    </div>
                    ))}
                    {!payload.trades.length && (
                      <p className="rounded-md border border-dashed border-slate-200 bg-white/60 px-3 py-4 text-sm text-muted-foreground">
                        Trades will appear here after you buy or sell.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </section>
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

function normalizePayload(data: Partial<PaperPayload> | null): PaperPayload {
  return {
    credits: typeof data?.credits === 'number' ? data.credits : 0,
    pricing: data?.pricing,
    defaultModel: data?.defaultModel ?? null,
    portfolio: data?.portfolio ?? null,
    watchlist: Array.isArray(data?.watchlist) ? data.watchlist : [],
    positions: Array.isArray(data?.positions) ? data.positions : [],
    trades: Array.isArray(data?.trades) ? data.trades : [],
    analysisRuns: Array.isArray(data?.analysisRuns) ? data.analysisRuns : [],
    hasActiveAnalysisRuns: data?.hasActiveAnalysisRuns === true
  };
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

function MetricCard({
  title,
  value,
  valueClassName,
  icon
}: {
  title: string;
  value: string;
  valueClassName?: string;
  icon: ReactNode;
}) {
  return (
    <Card className="rounded-lg border-slate-200 py-5 shadow-sm">
      <CardContent className="px-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p
              className={cn(
                'mt-2 truncate text-2xl font-semibold text-slate-950',
                valueClassName
              )}
            >
              {value}
            </p>
          </div>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
