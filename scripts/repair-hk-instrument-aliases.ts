import {config} from '../apps/web/node_modules/dotenv';
config({path:'.env'});
async function main() {
  const {db,client}=await import('../apps/web/lib/db/drizzle');
  const {instruments,instrumentSources,analysisJobs}=await import('../apps/web/lib/db/schema');
  const {normalizeTicker}=await import('../apps/web/lib/market/tickers');
  const {and,eq}=await import('../apps/web/node_modules/drizzle-orm');
  try {
    const aliases=await db.select().from(instruments).where(eq(instruments.status,'unresolved'));
    let repaired=0;
    for(const alias of aliases) {
      const symbol=normalizeTicker(alias.symbol);
      if(symbol===alias.symbol||!/^\d{4,5}\.HK$/.test(symbol))continue;
      await db.transaction(async tx=>{
        const [canonical]=await tx.select({id:instruments.id}).from(instruments).innerJoin(instrumentSources,eq(instrumentSources.instrumentId,instruments.id))
          .where(and(eq(instruments.symbol,symbol),eq(instruments.exchange,'XHKG'),eq(instruments.status,'verified'),eq(instrumentSources.vendor,'yahoo'),eq(instrumentSources.vendorSymbol,symbol),eq(instrumentSources.status,'verified'))).limit(1);
        if(!canonical)return;
        await tx.update(analysisJobs).set({instrumentId:canonical.id}).where(eq(analysisJobs.instrumentId,alias.id));
        await tx.update(instruments).set({syncEnabled:false}).where(and(eq(instruments.id,alias.id),eq(instruments.status,'unresolved')));
        repaired++;
      });
    }
    console.log(`Repaired ${repaired} verified HK aliases. Quotes, reports and portfolio monetary data preserved.`);
  }finally{await client.end();}
}
main().catch(()=>{console.error('HK alias repair failed');process.exitCode=1;});
