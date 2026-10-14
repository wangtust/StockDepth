'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/http/json-fetcher';
import { pollingDefaults } from '@/lib/http/polling';
import { Button } from '@/components/ui/button';
import { ErrorPresentation } from '@/components/error-presentation';
import { Input } from '@/components/ui/input';
import { Instrument, Quote, QuoteDisplay, marketTime } from './market-display';

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
    <h1 className="text-2xl font-semibold">Shared Stocks</h1>
    <p>Shared read-only identities and stored market data. Portfolio holdings remain private.</p>
    <label htmlFor="stock-search">Search symbol or name</label>
    <Input id="stock-search" maxLength={80} value={input} onChange={event => setInput(event.target.value)} />
    {(isLoading || changing) && <p role="status">Loading stocks…</p>}
    {error && <ErrorPresentation error={error} context="request" onRetry={refresh} retrying={refreshing} />}
    <Button variant="outline" disabled={refreshing} aria-busy={refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh stocks'}</Button>
    {!changing && data && <>
      {!data.instruments.length && <p>No matching stocks.</p>}
      <ul className="divide-y rounded border bg-white">{data.instruments.slice(0, 25).map(item => <li key={item.id} className="p-4">
        <Link className="font-semibold underline" href={`/dashboard/stocks/${item.id}`}>{item.symbol} · {item.exchange}</Link>
        <p>{item.name || 'Name unavailable'} · {item.currency || 'Currency unknown'} · {item.timezone || 'Timezone unknown'} · {item.status}</p>
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
  return <section className="min-w-0 space-y-5 p-4 text-sm leading-6 [overflow-wrap:anywhere] sm:p-6 lg:p-8">
    <Link className="underline" href="/dashboard/stocks">Back to Shared Stocks</Link>
    <h1 className="text-2xl font-semibold">Stock details</h1>
    {!validId && <p role="alert">Invalid instrument ID.</p>}
    {isLoading && <p role="status">Loading stock details…</p>}
    {error && <ErrorPresentation error={error} context="request" onRetry={refresh} retrying={refreshing} />}
    {validId && <Button variant="outline" disabled={refreshing} aria-busy={refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh details'}</Button>}
    {data && <>
      <h2 className="text-xl">{data.instrument.symbol} · {data.instrument.exchange} · {data.instrument.name || 'Name unavailable'}</h2>
      <p>{data.instrument.currency || 'Currency unknown'} · {data.instrument.timezone || 'Timezone unknown'} · {data.instrument.status}</p>
      <QuoteDisplay quote={data.latestQuote} timezone={data.instrument.timezone || 'UTC'} />
      <p>Freshness is supplied by the market service; stored quotes are not a live price stream.</p>
      <h2 className="text-lg font-semibold">Recent daily prices (up to 30)</h2>
      {!data.dailyPrices.length ? <p>No daily prices available.</p> : <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[960px] text-left [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_tr]:border-b [&_tr]:border-slate-100"><thead><tr>{['Trading date', 'Open', 'High', 'Low', 'Close', 'Volume', 'Source / adjustment', 'Fetched (UTC)'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.dailyPrices.slice(0, 30).map((day, index) => <tr key={index}><td>{day.tradingDate || day.date || 'Unknown'}</td><td>{day.open}</td><td>{day.high}</td><td>{day.low}</td><td>{day.close}</td><td>{day.volume ?? 'Unknown'}</td><td>{day.source || 'Unknown'} / {day.adjusted === true ? 'Adjusted' : day.adjusted === false ? 'Unadjusted' : 'Unknown'}</td><td>{marketTime(day.fetchedAt)}</td></tr>)}</tbody></table></div>}
      <p>Daily OHLC uses {data.instrument.currency || 'unknown currency'}; trading dates follow {data.instrument.timezone || 'unknown market timezone'}. Adjustment series must not be mixed.</p>
      <h2 className="text-lg font-semibold">Sync</h2>
      {!data.sync || (Array.isArray(data.sync) && !data.sync.length) ? <p>Sync status unavailable.</p> : (Array.isArray(data.sync) ? data.sync : [data.sync]).map((sync, index) => <p key={index}>{sync.category || 'Unknown category'} · {sync.status || 'Unknown'} · Last success: {marketTime(sync.lastSuccessAt)} · Next: {marketTime(sync.nextRunAt)}</p>)}
    </>}
  </section>;
}
