export type InstrumentDTO = {
  id: number; symbol: string; exchange: string; name: string | null;
  currency: string | null; timezone: string | null; status: string;
};
export type QuoteDTO = {
  id: number; price: string; currency: string; quotedAt: string; fetchedAt: string;
  source: string; priceType: string; freshness: 'fresh' | 'stale' | 'unknown';
};
export type ValuationStatus = 'valid' | 'stale' | 'missing' | 'currency_mismatch' | 'unresolved';
