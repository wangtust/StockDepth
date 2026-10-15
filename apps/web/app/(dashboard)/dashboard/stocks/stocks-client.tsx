'use client';
import { StockDecisionHistory } from '@/components/stock-decision-history';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/http/json-fetcher';
import { pollingDefaults } from '@/lib/http/polling';
import { Button } from '@/components/ui/button';
import { ErrorPresentation } from '@/components/error-presentation';
import { Input } from '@/components/ui/input';
import { Instrument, Quote, marketTime } from './market-display';

const readOptions = { ...pollingDefaults, shouldRetryOnError: false };
export function StocksClient() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(input.trim().slice(0, 80)); setCursors([]); }, 300);
    return () => clearTimeout(timer);
  }, [input]);
  const params = new URLSearchParams({ q: query, limit: '25' });
  const cursor = cursors.at(-1);
  if (cursor) params.set('before', cursor);
  const { data, error, isLoading, mutate } = useSWR<{ instruments: Instrument[]; nextCursor: string | null }>(`/api/market/instruments?${params}`, jsonFetcher, readOptions);
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  async function refresh() { if (refreshLock.current) return; refreshLock.current = true; setRefreshing(true); try { await mutate(); } finally { refreshLock.current = false; setRefreshing(false); } }
  const changing = input.trim().slice(0, 80) !== query;
  return <section className="min-w-0 space-y-5 p-4 text-sm leading-6 [overflow-wrap:anywhere] sm:p-6 lg:p-8">
    <h1 className="text-2xl font-semibold">Stock</h1>
    <p>Browse stocks and review historical analysis decisions.</p>
    <label htmlFor="stock-search">Search symbol or name</label>
    <Input id="stock-search" maxLength={80} value={input} onChange={event => setInput(event.target.value)} />
    {(isLoading || changing) && <p role="status">Loading stocks…</p>}
    {error && <ErrorPresentation error={error} context="request" onRetry={refresh} retrying={refreshing} />}
    <Button variant="outline" disabled={refreshing} aria-busy={refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh stocks'}</Button>
    {!changing && data && <>
      {!data.instruments.length && <p>No matching stocks.</p>}
      <ul className="divide-y rounded border bg-white">{data.instruments.slice(0, 25).map(item => <li key={item.id} className="p-4">
        <Link className="font-semibold underline" href={`/dashboard/stocks/${item.id}`}>{item.symbol} · {item.exchange}</Link>
        <p>{item.name || 'Name unavailable'} · {item.currency || 'Currency unknown'}</p>
      </li>)}</ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!cursors.length || isLoading} onClick={() => setCursors(current => current.slice(0, -1))}>Previous stocks</Button>
        <Button disabled={!data.nextCursor || isLoading || cursors.length >= 99 || data.nextCursor === cursor} onClick={() => { if (data.nextCursor) setCursors(current => [...current, data.nextCursor!]); }}>Next stocks</Button>
        <span>Page {cursors.length + 1} / max 100</span>
      </div>
    </>}
  </section>;
}

type DailyPrice = { tradingDate?: string; date?: string; open: string; high: string; low: string; close: string; volume?: string | number | null; source?: string; adjusted?: boolean; fetchedAt?: string };
type Sync = { category?: string; status?: string; lastSuccessAt?: string | null; nextRunAt?: string | null };
export function StockDetailClient({ id }: { id: string }) {
  const validId = /^\d{1,10}$/.test(id) && Number(id) >= 1 && Number(id) <= 2147483647;
  const { data, error, isLoading, mutate } = useSWR<{ instrument: Instrument; latestQuote: Quote | null; dailyPrices: DailyPrice[]; sync: Sync | Sync[] | null }>(validId ? `/api/market/instruments/${id}?limit=30` : null, jsonFetcher, { ...readOptions, refreshInterval: 30000 });
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  async function refresh() { if (refreshLock.current) return; refreshLock.current = true; setRefreshing(true); try { await mutate(); } finally { refreshLock.current = false; setRefreshing(false); } }
  const close = data?.dailyPrices[0];
  const dailySync = data?.sync ? (Array.isArray(data.sync) ? data.sync : [data.sync]).find(s => s.category === 'daily') : null;
  return <section className="min-w-0 space-y-5 p-4 text-sm leading-6 [overflow-wrap:anywhere] sm:p-6 lg:p-8">
    <Link className="underline" href="/dashboard/stocks">Back to Stock</Link>
    <h1 className="text-2xl font-semibold">Stock details</h1>
    {!validId && <p role="alert">Invalid instrument ID.</p>}
    {isLoading && <p role="status">Loading stock details…</p>}
    {error && <ErrorPresentation error={error} context="request" onRetry={refresh} retrying={refreshing} />}
    {validId && <Button variant="outline" disabled={refreshing} aria-busy={refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh details'}</Button>}
    {data && <>
      <h2 className="text-xl">{data.instrument.symbol} · {data.instrument.exchange} · {data.instrument.name || 'Name unavailable'}</h2>
      <div className="rounded-xl border bg-white p-4">
        <p className="text-sm text-slate-500">Latest daily close</p>
        {close ? <>
          <p className="mt-1 text-3xl font-semibold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: data.instrument.currency || 'USD' }).format(Number(close.close))}</p>
          <p className="mt-2 text-sm text-slate-600">Trading date: {close.tradingDate || close.date} · Updated: {marketTime(close.fetchedAt, data.instrument.timezone || 'UTC')}</p>
        </> : <p>No closing price available yet.</p>}
        <p className="mt-2 text-sm text-slate-500">{data.instrument.exchange === 'XHKG' ? 'Hong Kong stocks sync after market close, at 4:45 PM Hong Kong time.' : ['XSHG','XSHE'].includes(data.instrument.exchange) ? 'China A-shares sync after market close, at 3:45 PM Shanghai time.' : 'US stocks sync after market close, at 4:45 PM New York time.'} Non-trading days retain the last available close.</p>
        {dailySync?.status === 'retrying' && <p role="status" className="mt-2 text-amber-700">Market data update delayed. Retrying automatically; the date above shows the available close.</p>}
      </div>
      <StockDecisionHistory id={String(data.instrument.id)} />

    </>}
  </section>;
}
