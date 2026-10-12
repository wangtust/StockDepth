'use client';

export type Quote = {
  id: number; price: string; currency: string; quotedAt: string | null;
  fetchedAt: string; source: string; priceType: string;
  freshness: 'fresh' | 'stale' | 'unknown';
};
export type Instrument = {
  id: number; symbol: string; exchange: string; name: string | null;
  currency: string | null; timezone: string | null; status: string;
};
export type ValuedPosition = {
  quantity: number; avgCostCents: number; instrumentId?: number | null;
  quote?: Quote | null;
  valuationStatus?: 'valid' | 'stale' | 'missing' | 'currency_mismatch' | 'unresolved';
};
// Twelve decimal places, exact multiplication and aggregation; display rounds only once.
const SCALE = 10n ** 12n;
export function decimalUnits(value: string): bigint | null {
  if (typeof value !== 'string' || !/^\d{1,30}(\.\d{1,12})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0'));
}
export function centsUnits(cents: number): bigint {
  return BigInt(cents) * (SCALE / 100n);
}
export function exactMoney(units: bigint, currency: string): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const cents = (magnitude + SCALE / 200n) / (SCALE / 100n);
  return `${negative ? '-' : ''}${currency} ${(cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(cents % 100n).toString().padStart(2, '0')}`;
}
export function quoteIssue(quote: Quote | null | undefined, now = Date.now()): string | null {
  if (!quote) return 'Missing quote';
  const price = decimalUnits(quote.price);
  if (price === null || price <= 0n) return 'Invalid decimal price';
  const quoted = quote.quotedAt ? Date.parse(quote.quotedAt) : NaN;
  const fetched = Date.parse(quote.fetchedAt);
  if (!Number.isFinite(quoted) || !Number.isFinite(fetched)) return 'Unknown quote time';
  if (quoted > now || fetched > now || quoted > fetched) return 'Invalid / future quote time';
  if (quote.freshness !== 'fresh') return quote.freshness === 'stale' ? 'Stale quote' : 'Unknown freshness';
  // Do not mix adjusted values or another price series into ordinary portfolio valuation.
  if (quote.priceType !== 'regular_unadjusted') return 'Unsupported price type';
  return null;
}
export function positionValue(position: ValuedPosition, currency: string, now = Date.now()) {
  const issue = !position.instrumentId ? 'Unresolved instrument' :
    position.quote && position.quote.currency !== currency ? 'Currency mismatch — no FX conversion' :
    quoteIssue(position.quote, now) || (position.valuationStatus !== 'valid' ? `Valuation ${position.valuationStatus || 'missing'}` : null);
  if (issue || !Number.isSafeInteger(position.quantity) || position.quantity < 0 || !Number.isSafeInteger(position.avgCostCents)) {
    return { issue: issue || 'Invalid quantity / cost', value: null, unrealized: null };
  }
  const value = decimalUnits(position.quote!.price)! * BigInt(position.quantity);
  return { issue: null, value, unrealized: value - centsUnits(position.avgCostCents) * BigInt(position.quantity) };
}
export function marketTime(value: string | null | undefined, timezone = 'UTC'): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unknown';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'long', timeZone: timezone }).format(new Date(value)) + ` (${timezone})`;
  } catch { return marketTime(value, 'UTC'); }
}
export function QuoteDisplay({ quote, timezone = 'UTC' }: { quote?: Quote | null; timezone?: string }) {
  if (!quote) return <p>Missing quote — valuation unavailable</p>;
  return <div className="space-y-1 text-sm">
    <p>{quote.currency} {quote.price} · {quoteIssue(quote) || 'Fresh quote'} · {quote.priceType}</p>
    <p>Source: {quote.source}</p>
    <p>Quoted: {marketTime(quote.quotedAt, timezone)}</p>
    <p>Fetched: {marketTime(quote.fetchedAt, timezone)}</p>
  </div>;
}
