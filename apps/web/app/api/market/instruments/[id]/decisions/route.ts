import { NextResponse } from 'next/server';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { analysisDecisions, analysisJobs, dailyPrices, instruments } from '@/lib/db/schema';

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export async function GET(request: Request, { params }: { params: Promise<{id: string}> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({error:'Unauthorized'}, {status:401});
  const {id} = await params;
  const query = new URL(request.url).searchParams;
  const basis = query.get('basis') || 'analysis';
  if (!['analysis','generated'].includes(basis)) return NextResponse.json({error:'Invalid date basis'}, {status:400});
  const to = query.get('to') || new Date().toISOString().slice(0,10);
  const from = query.get('from') || new Date(Date.now()-365*86400000).toISOString().slice(0,10);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id)<1 || Number(id)>2147483647 || !validDate(from) || !validDate(to) || from>to || Date.parse(to)-Date.parse(from)>3660*86400000) return NextResponse.json({error:'Invalid range (maximum 10 years)'},{status:400});
  const [instrument] = await db.select().from(instruments).where(eq(instruments.id,Number(id))).limit(1);
  if (!instrument) return NextResponse.json({error:'Not found'},{status:404});
  // Use one unadjusted source throughout the chart, never combine vendor series.
  const [sourceRow] = await db.select({source:dailyPrices.source}).from(dailyPrices)
    .where(and(eq(dailyPrices.instrumentId,instrument.id),eq(dailyPrices.adjusted,false),gte(dailyPrices.tradingDate,from),lte(dailyPrices.tradingDate,to)))
    .orderBy(desc(dailyPrices.tradingDate),desc(dailyPrices.fetchedAt),asc(dailyPrices.source)).limit(1);
  const decisionDate = basis === 'generated' ? sql<string>`to_char((${analysisJobs.completedAt} at time zone 'UTC') at time zone ${instrument.timezone || 'UTC'}, 'YYYY-MM-DD')` : sql<string>`${analysisJobs.tradeDate}`;
  const [prices, decisions] = await Promise.all([
    sourceRow ? db.select({date:dailyPrices.tradingDate,close:dailyPrices.close}).from(dailyPrices)
      .where(and(eq(dailyPrices.instrumentId,instrument.id),eq(dailyPrices.source,sourceRow.source),eq(dailyPrices.adjusted,false),gte(dailyPrices.tradingDate,from),lte(dailyPrices.tradingDate,to)))
      .orderBy(asc(dailyPrices.tradingDate)) : Promise.resolve([]),
    db.select({jobId:analysisJobs.id,date:decisionDate,analysisDate:analysisJobs.tradeDate,completedAt:analysisJobs.completedAt,model:analysisJobs.deepModel,action:analysisDecisions.action,summary:analysisDecisions.summary,extractionStatus:analysisDecisions.extractionStatus})
      .from(analysisJobs).leftJoin(analysisDecisions,eq(analysisDecisions.jobId,analysisJobs.id))
      .where(and(eq(analysisJobs.userId,user.id),eq(analysisJobs.instrumentId,instrument.id),eq(analysisJobs.status,'complete'),isNull(analysisJobs.hiddenAt),gte(decisionDate,from),lte(decisionDate,to)))
      .orderBy(asc(decisionDate),asc(analysisJobs.id))
  ]);
  return NextResponse.json({prices,decisions,source:sourceRow?.source??null,adjusted:false,currency:instrument.currency,timezone:instrument.timezone,from,to}, {headers:{'Cache-Control':'private, no-store'}});
}
