import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { instruments, instrumentSources, marketSyncState } from '../db/schema';
import { normalizeTicker } from './tickers';
type CatalogueWriter = Pick<typeof db, 'execute' | 'select' | 'insert'>;
// Local identity queue only. No provider request, exchange guess or user data.
export async function ensureInstrument(ticker: string, writer?: CatalogueWriter) {
  const symbol = normalizeTicker(ticker);
  if (!/^[A-Z0-9^.-]{1,40}$/.test(symbol)) throw new Error('invalid_instrument_symbol');
  const ensure = async (tx: CatalogueWriter) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'market:yahoo:' + symbol},0))`);
    const [source] = await tx.select().from(instrumentSources).where(and(
      eq(instrumentSources.vendor, 'yahoo'), eq(instrumentSources.vendorSymbol, symbol)));
    let item;
    if (source) [item] = await tx.select().from(instruments).where(eq(instruments.id, source.instrumentId));
    else {
      [item] = await tx.insert(instruments).values({symbol, exchange: 'UNRESOLVED'})
        .onConflictDoUpdate({target: [instruments.exchange, instruments.symbol], set: {symbol}}).returning();
      await tx.insert(instrumentSources).values({instrumentId: item.id, vendor: 'yahoo', vendorSymbol: symbol});
    }
    if (!item) throw new Error('instrument_mapping_missing');
    for (const category of ['identity', 'quote', 'daily']) await tx.insert(marketSyncState)
      .values({instrumentId: item.id, category}).onConflictDoNothing();
    return item;
  };
  return writer ? ensure(writer) : db.transaction(ensure);
}
