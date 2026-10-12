import { randomUUID } from 'node:crypto';
import { and, eq, sql, desc } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { instruments, instrumentSources, marketSyncState, marketSyncRuns, priceSnapshots, dailyPrices } from '../db/schema';
import { normalizeTicker } from './tickers';
import { ensureInstrument } from './catalogue';
import { nextQuoteAt, sessionOpen } from './policy';
import { validateProvider, yahooProvider, type MarketProvider } from './provider';
export type ClaimedInstrument={id:number;symbol:string;categories:string[];priority:boolean};
function bound(value:number,max:number) {return Number.isInteger(value)&&value>0?Math.min(value,max):Math.min(10,max);}
// Explicit bounded historical initialization; never called by the polling Worker.
export async function queueMarketScope(limit=100) {
  const scope=await db.execute<{ticker:string}>(sql`
    select distinct regexp_replace(upper(trim(refs.ticker)),'[.]SH$','.SS') as ticker
    from (select ticker from watchlist_items union select ticker from paper_positions
      union select ticker from analysis_jobs union select ticker from paper_trades) refs
    left join instrument_sources s on s.vendor='yahoo'
      and s.vendor_symbol=regexp_replace(upper(trim(refs.ticker)),'[.]SH$','.SS')
    where s.id is null and regexp_replace(upper(trim(refs.ticker)),'[.]SH$','.SS') ~ '^[A-Z0-9^.-]{1,40}$' order by ticker limit ${bound(limit,500)}`);
  for (const candidate of scope) {
    if (/^[A-Z0-9^.-]{1,40}$/.test(candidate.ticker)) await ensureInstrument(candidate.ticker);
  }
  return scope.length;
}
// Atomically claim every due category for a bounded number of instruments. An active
// lease in ANY category prevents duplicate provider requests by a second process.
export async function claimMarketBatch(owner:string,limit=10,leaseMs=90_000):Promise<ClaimedInstrument[]> {
  return db.transaction(async tx=> {
    const rows=await tx.execute<{id:number;symbol:string;priority:boolean}>(sql`
      select i.id,s.vendor_symbol as symbol,true as priority
      from instruments i join instrument_sources s on s.instrument_id=i.id and s.vendor='yahoo'
      where i.sync_enabled
      and exists(select 1 from market_sync_state m where m.instrument_id=i.id and m.next_run_at<=now())
      and not exists(select 1 from market_sync_state m where m.instrument_id=i.id and m.lease_until>now())
      order by (select min(next_run_at) from market_sync_state m where m.instrument_id=i.id),i.id limit ${bound(limit,100)} for update of i skip locked`);
    const result:ClaimedInstrument[]=[];
    for (const row of rows) {
      const claimed=await tx.update(marketSyncState).set({owner,leaseUntil:new Date(Date.now()+Math.max(1000,Math.min(leaseMs,300_000)))})
        .where(and(eq(marketSyncState.instrumentId,row.id),sql`${marketSyncState.nextRunAt} <= now()`)).returning({category:marketSyncState.category});
      result.push({...row,categories:claimed.map(s=>s.category)});
    }
    return result;
  });
}
// Verified-only, idempotent linking. No historical monetary fields are touched.
export async function linkVerifiedInstrument(id:number,symbol:string) {
  symbol=normalizeTicker(symbol);
  await db.transaction(async tx=> {
    const [item]=await tx.select().from(instruments).where(and(eq(instruments.id,id),eq(instruments.symbol,normalizeTicker(symbol)),eq(instruments.status,'verified'))).for('share');
    if (!item) return;
    for (const table of ['watchlist_items','paper_positions','analysis_jobs','paper_trades']) {
      await tx.execute(sql`update ${sql.identifier(table)} set instrument_id=${id} where id in (select id from ${sql.identifier(table)} where instrument_id is null and regexp_replace(upper(trim(ticker)),'[.]SH$','.SS')=${symbol} order by id limit 500)`);
    }
  });
}
export async function synchronizeClaim(claim:ClaimedInstrument,owner:string,provider:MarketProvider=yahooProvider) {
  const [latestDaily]=await db.select({date:dailyPrices.tradingDate}).from(dailyPrices).where(eq(dailyPrices.instrumentId,claim.id)).orderBy(desc(dailyPrices.tradingDate)).limit(1);
  const start=latestDaily?new Date(Date.parse(latestDaily.date)-7*86400_000).toISOString().slice(0,10):undefined;
  let data:ReturnType<typeof validateProvider>|undefined;
  try {data=validateProvider(await provider(claim.symbol,claim.categories,start),claim.symbol);}
  catch { /* Provider failure is classified below; never log its raw payload. */ }
  let newlyVerified=false;
  const outcome=await db.transaction(async tx=> {
    // Fence stale owners before any data write. A new owner may recover expired leases.
    const [current]=await tx.select().from(instruments).where(eq(instruments.id,claim.id)).for('update');
    const held=await tx.select().from(marketSyncState).where(and(eq(marketSyncState.instrumentId,claim.id),eq(marketSyncState.owner,owner))).for('update');
    const now=new Date(); // Check lease time after lock waits, never before them.
    if (held.length!==claim.categories.length || held.some(s=>!s.leaseUntil || s.leaseUntil<=now)) return {succeeded:0,failed:0,lostLease:true};
    if (!current.syncEnabled) {
      await tx.update(marketSyncState).set({owner:null,leaseUntil:null}).where(and(eq(marketSyncState.instrumentId,claim.id),eq(marketSyncState.owner,owner)));
      return {succeeded:0,failed:0,lostLease:true};
    }
    let valid=data;
    if (valid) {
      if (current.status==='verified' && (current.symbol!==valid.identity.symbol || current.exchange!==valid.identity.exchange || current.currency!==valid.identity.currency || current.timezone!==valid.identity.timezone)) valid=undefined;
      // A separate verified mapping conflict is unresolved, never merge unrelated IDs.
      const collision=await tx.select({id:instruments.id}).from(instruments).where(and(eq(instruments.exchange,valid?.identity.exchange??''),eq(instruments.symbol,claim.symbol)));
      if (collision.some(i=>i.id!==claim.id)) valid=undefined;
    }
    if (valid) {
      newlyVerified=current.status!=='verified';
      await tx.update(instruments).set({symbol:valid.identity.symbol,exchange:valid.identity.exchange,currency:valid.identity.currency,timezone:valid.identity.timezone,name:valid.identity.name,status:'verified',verifiedAt:now}).where(eq(instruments.id,claim.id));
      await tx.update(instrumentSources).set({status:'verified',verifiedAt:now}).where(and(eq(instrumentSources.instrumentId,claim.id),eq(instrumentSources.vendor,'yahoo')));
    }
    let succeeded=0,failed=0;
    for (const state of held) {
      const category=state.category;
      const ok=Boolean(valid && !valid.errors[category as keyof typeof valid.errors] && (category==='identity' || (category==='quote'?valid.quote:(valid.daily?.length))));
      if (ok && valid) {
        if (category==='quote') await tx.insert(priceSnapshots).values({instrumentId:claim.id,...valid.quote!,quotedAt:new Date(valid.quote!.quotedAt),source:valid.source,fetchedAt:new Date(valid.fetchedAt)}).onConflictDoNothing();
        if (category==='daily') {
          // One bounded SQL statement, not up to370 remote round trips. Last revision wins.
          const unique=[...new Map(valid.daily!.map(row=>[row.tradingDate,row])).values()];
          await tx.insert(dailyPrices).values(unique.map(row=>({instrumentId:claim.id,...row,volume:BigInt(row.volume),source:valid.source,fetchedAt:new Date(valid.fetchedAt)})))
            .onConflictDoUpdate({target:[dailyPrices.instrumentId,dailyPrices.tradingDate,dailyPrices.source,dailyPrices.adjusted],set:{open:sql`excluded.open`,high:sql`excluded.high`,low:sql`excluded.low`,close:sql`excluded.close`,volume:sql`excluded.volume`,fetchedAt:sql`excluded.fetched_at`}});
        }
        const next=category==='identity'?new Date(now.getTime()+7*86400_000):category==='daily'?new Date(now.getTime()+86400_000):nextQuoteAt(valid.identity.exchange,valid.identity.timezone,claim.priority,now);
        await tx.update(marketSyncState).set({lastSuccessAt:now,nextRunAt:next,attempts:0,errorSummary:null,owner:null,leaseUntil:null}).where(eq(marketSyncState.id,state.id));
        succeeded++;
      } else {
        const attempts=Math.min(state.attempts+1,20),delay=Math.min(86400_000,60_000*2**Math.min(attempts-1,11));
        await tx.update(marketSyncState).set({attempts,nextRunAt:category==='quote' && current.status==='verified' && !sessionOpen(current.exchange,current.timezone,now)?new Date(Math.max(now.getTime()+delay,nextQuoteAt(current.exchange,current.timezone,claim.priority,now).getTime())):new Date(now.getTime()+delay),errorSummary:'provider_unavailable_or_invalid',owner:null,leaseUntil:null}).where(eq(marketSyncState.id,state.id));
        failed++;
      }
    }
    return {succeeded,failed,lostLease:false};
  });
  if (newlyVerified && outcome.succeeded) await linkVerifiedInstrument(claim.id,claim.symbol);
  return outcome;
}
export async function runMarketBatch({limit=10,concurrency=2,provider=yahooProvider}:{limit?:number;concurrency?:number;provider?:MarketProvider}={}) {
  const owner=randomUUID();
  const claims=await claimMarketBatch(owner,limit);
  if (!claims.length) return {claimed:0,succeeded:0,failed:0};
  const [run]=await db.insert(marketSyncRuns).values({owner}).returning();
  await db.update(marketSyncRuns).set({claimed:claims.length}).where(eq(marketSyncRuns.id,run.id));
  let cursor=0,succeeded=0,failed=0;
  // Queued items also retain leases during a bounded batch; provider subprocesses
  // are individually timed out. A dead process cannot renew and is recoverable.
  const heartbeat=setInterval(()=> {
    void db.update(marketSyncState).set({leaseUntil:new Date(Date.now()+90_000)})
      .where(and(eq(marketSyncState.owner,owner),sql`${marketSyncState.leaseUntil} > now()`))
      .catch(()=>{});
  },25_000);
  try {
    await Promise.all(Array.from({length:Math.min(bound(concurrency,4),claims.length)},async()=> {
      while(cursor<claims.length) {
        const claim=claims[cursor++];
        try {const result=await synchronizeClaim(claim,owner,provider);succeeded+=result.succeeded;failed+=result.failed;}
        catch {failed+=claim.categories.length; /* lease expires safely; no secret exception logs */}
      }
    }));
  } finally {clearInterval(heartbeat);}
  await db.update(marketSyncRuns).set({endedAt:new Date(),succeeded,failed,errorSummary:failed?'one_or_more_sync_categories_failed':null}).where(eq(marketSyncRuns.id,run.id));
  return {claimed:claims.length,succeeded,failed};
}
