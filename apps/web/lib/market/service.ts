import { and, desc, eq, inArray, lt, or, ilike } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { instruments, instrumentSources, priceSnapshots, dailyPrices, marketSyncState } from '../db/schema';
import { normalizeTicker } from './tickers';
import { decimalCents, quoteFreshness, sessionOpen } from './policy';
import type { InstrumentDTO, QuoteDTO, ValuationStatus } from './contracts';
export type MarketReader = Pick<typeof db, 'select' | 'selectDistinctOn'>;
export function instrumentDTO(i: typeof instruments.$inferSelect): InstrumentDTO {
  return {id:i.id,symbol:i.symbol,exchange:i.exchange,name:i.name,currency:i.currency,timezone:i.timezone,status:i.status};
}
export function quoteDTO(i: typeof instruments.$inferSelect, q: typeof priceSnapshots.$inferSelect, now=new Date()): QuoteDTO {
  return {id:q.id,price:q.price,currency:q.currency,quotedAt:q.quotedAt.toISOString(),fetchedAt:q.fetchedAt.toISOString(),source:q.source,priceType:q.priceType,freshness:quoteFreshness(i,q,now)};
}
export async function listInstruments({q='',before,limit=30}:{q?:string;before?:number;limit?:number}) {
  const search=q.trim().slice(0,80).replace(/[\\%_]/g,'\\$&');
  const bounded=Math.max(1,Math.min(100,limit));
  const rows=await db.select().from(instruments).where(and(before ? lt(instruments.id,before):undefined,
    search ? or(ilike(instruments.symbol,`%${search}%`),ilike(instruments.name,`%${search}%`)):undefined))
    .orderBy(desc(instruments.id)).limit(bounded+1);
  return {instruments:rows.slice(0,bounded).map(instrumentDTO),nextCursor:rows.length>bounded ? String(rows[bounded-1].id):null};
}
export async function marketRecords(ids:number[], reader:MarketReader=db) {
  const unique=[...new Set(ids)].slice(0,1000);
  if (!unique.length) return new Map<number,{instrument:typeof instruments.$inferSelect;quote:typeof priceSnapshots.$inferSelect|null}>();
  const [items,quotes]=await Promise.all([
    reader.select().from(instruments).where(inArray(instruments.id,unique)),
    reader.selectDistinctOn([priceSnapshots.instrumentId]).from(priceSnapshots).where(inArray(priceSnapshots.instrumentId,unique))
      .orderBy(priceSnapshots.instrumentId,desc(priceSnapshots.quotedAt),desc(priceSnapshots.id))
  ]);
  return new Map(items.map(i=>[i.id,{instrument:i,quote:quotes.find(q=>q.instrumentId===i.id)??null}]));
}
export async function verifiedInstrumentForTicker(ticker:string,reader:MarketReader=db) {
  const [row]=await reader.select({instrument:instruments}).from(instrumentSources)
    .innerJoin(instruments,eq(instruments.id,instrumentSources.instrumentId)).where(and(
      eq(instrumentSources.vendor,'yahoo'),eq(instrumentSources.vendorSymbol,normalizeTicker(ticker)),
      eq(instrumentSources.status,'verified'),eq(instruments.status,'verified'))).limit(1);
  return row?.instrument??null;
}
export function valuationStatus(i:typeof instruments.$inferSelect|undefined,q:typeof priceSnapshots.$inferSelect|null|undefined,currency:string,now=new Date()):ValuationStatus {
  if (!i || i.status!=='verified') return 'unresolved';
  if (!q) return 'missing';
  if (q.quotedAt>q.fetchedAt) return 'stale';
  if (i.currency!==currency || q.currency!==currency) return 'currency_mismatch';
  return quoteFreshness(i,q,now)==='fresh'?'valid':'stale';
}
export async function enrichPositions<T extends {instrumentId:number|null;quantity:number}>(positions:T[],currency:string,reader:MarketReader=db) {
  const records=await marketRecords(positions.flatMap(p=>p.instrumentId?[p.instrumentId]:[]),reader);
  return positions.map(p=>{
    const record=p.instrumentId?records.get(p.instrumentId):undefined;
    const status=valuationStatus(record?.instrument,record?.quote,currency);
    // No zeros or partial sums are supplied for missing valuations.
    return {...p,quote:record?.quote ? quoteDTO(record.instrument,record.quote):null,valuationStatus:status};
  });
}
export async function executionQuote(ticker:string,currency:string,reader:MarketReader=db,now=new Date()) {
  const instrument=await verifiedInstrumentForTicker(ticker,reader);
  if (!instrument) return {error:'unresolved_identity'} as const;
  const record=(await marketRecords([instrument.id],reader)).get(instrument.id)!;
  if (record.quote && record.quote.quotedAt>now) return {error:'future_quote_time'} as const;
  const status=valuationStatus(instrument,record.quote,currency,now);
  if (status!=='valid') return {error:status} as const;
  if (!sessionOpen(instrument.exchange,instrument.timezone,now)) return {error:'market_closed_or_unconfirmed_session'} as const;
  try { return {instrument,quote:record.quote!,priceCents:decimalCents(record.quote!.price)}; }
  catch { return {error:'unsupported_price_range'} as const; }
}
export async function instrumentDetail(id:number,{before,limit=260}:{before?:string;limit?:number}={}) {
  const record=(await marketRecords([id])).get(id);
  if (!record) return null;
  const [daily,sync]=await Promise.all([
    db.select().from(dailyPrices).where(and(eq(dailyPrices.instrumentId,id),before?lt(dailyPrices.tradingDate,before):undefined))
      .orderBy(desc(dailyPrices.tradingDate)).limit(Math.max(1,Math.min(370,limit))),
    db.select({category:marketSyncState.category,lastSuccessAt:marketSyncState.lastSuccessAt,nextRunAt:marketSyncState.nextRunAt,attempts:marketSyncState.attempts,leaseUntil:marketSyncState.leaseUntil})
      .from(marketSyncState).where(eq(marketSyncState.instrumentId,id))
  ]);
  return {instrument:instrumentDTO(record.instrument),latestQuote:record.quote?quoteDTO(record.instrument,record.quote):null,
    dailyPrices:daily.map(p=>({tradingDate:p.tradingDate,open:p.open,high:p.high,low:p.low,close:p.close,volume:p.volume.toString(),source:p.source,adjusted:p.adjusted,fetchedAt:p.fetchedAt.toISOString()})),
    sync:sync.map(s=>({category:s.category,lastSuccessAt:s.lastSuccessAt?.toISOString()??null,nextRunAt:s.nextRunAt.toISOString(),status:s.leaseUntil && s.leaseUntil>new Date()?'syncing':s.attempts?'retrying':s.lastSuccessAt?'ready':'pending'}))};
}
