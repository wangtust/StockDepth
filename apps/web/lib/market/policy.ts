// Conservative weekday/session policy. This is NOT a holiday/early-close calendar.
export const MARKETS: Record<string, { currency: string; timezone: string; sessions: [number, number][] }> = {
  XNAS: { currency: 'USD', timezone: 'America/New_York', sessions: [[570,960]] },
  XNYS: { currency: 'USD', timezone: 'America/New_York', sessions: [[570,960]] },
  XASE: { currency: 'USD', timezone: 'America/New_York', sessions: [[570,960]] },
  XSHG: { currency: 'CNY', timezone: 'Asia/Shanghai', sessions: [[570,690],[780,900]] },
  XSHE: { currency: 'CNY', timezone: 'Asia/Shanghai', sessions: [[570,690],[780,900]] },
  XHKG: { currency: 'HKD', timezone: 'Asia/Hong_Kong', sessions: [[570,720],[780,960]] },
};
const clockFormatters=new Map<string,Intl.DateTimeFormat>();
export function localClock(now: Date, timezone: string) {
  const formatter=clockFormatters.get(timezone)??new Intl.DateTimeFormat('en-CA', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  if (clockFormatters.size<8) clockFormatters.set(timezone,formatter);
  const parts=formatter.formatToParts(now);
  const get=(type:string)=>parts.find(p=>p.type===type)!.value;
  return { date:`${get('year')}-${get('month')}-${get('day')}`, minute:Number(get('hour'))*60+Number(get('minute')), weekday:get('weekday') };
}
export function sessionOpen(exchange: string, timezone: string | null, now = new Date()) {
  const market=MARKETS[exchange];
  if (!market || timezone!==market.timezone) return false;
  const c=localClock(now,timezone);
  return !['Sat','Sun'].includes(c.weekday) && market.sessions.some(([start,end])=>c.minute>=start && c.minute<end);
}
export function quoteFreshness(instrument: {exchange:string;timezone:string|null}, quote: {quotedAt:Date;priceType:string}, now=new Date()): 'fresh'|'stale'|'unknown' {
  const market=MARKETS[instrument.exchange];
  const age=now.getTime()-quote.quotedAt.getTime();
  if (!market || instrument.timezone!==market.timezone || !Number.isFinite(age) || age<0 || quote.priceType!=='regular_unadjusted') return 'unknown';
  const c=localClock(now,market.timezone), q=localClock(quote.quotedAt,market.timezone);
  if (sessionOpen(instrument.exchange,instrument.timezone,now)) {
    const start=market.sessions.find(([s,e])=>c.minute>=s && c.minute<e)![0];
    return age<=35*60_000 && c.date===q.date && q.minute>=start ? 'fresh':'stale';
  }
  // Before open and recess, a recent last session quote is usable for display only.
  if (age<=35*60_000 && c.date===q.date) return 'fresh';
  // Closed display accepts only a completed recent weekday close; holidays degrade stale.
  const previous=new Date(now);
  let expected=c;
  if (['Sat','Sun'].includes(c.weekday) || c.minute<market.sessions[0][0]) {
    do { previous.setTime(previous.getTime()-86400_000); expected=localClock(previous,market.timezone); } while (['Sat','Sun'].includes(expected.weekday));
  }
  return q.date===expected.date && q.minute>=market.sessions.at(-1)![1]-35 && age<=4*86400_000 ? 'fresh':'stale';
}
// Evaluate small minute windows using Intl, avoiding hand-written UTC/DST conversion.
export function nextQuoteAt(exchange:string, timezone:string|null, priority:boolean, now=new Date()) {
  const market=MARKETS[exchange];
  if (!market || timezone!==market.timezone) return new Date(now.getTime()+86400_000);
  if (priority && sessionOpen(exchange,timezone,now)) return new Date(now.getTime()+30*60_000);
  for (let offset=1;offset<=8*24*60;offset++) {
    const candidate=new Date(now.getTime()+offset*60_000), c=localClock(candidate,market.timezone);
    if (['Sat','Sun'].includes(c.weekday)) continue;
    if (c.minute===market.sessions.at(-1)![1]+45 || (priority && market.sessions.some(([start])=>c.minute===start))) return candidate;
  }
  return new Date(now.getTime()+86400_000);
}
export function decimalCents(value:string): number {
  if (!/^\d{1,16}(\.\d{1,8})?$/.test(value)) throw new Error('invalid_price');
  const [whole,fraction='']=value.split('.');
  const digits=fraction.padEnd(8,'0');
  const cents=BigInt(whole)*100n+BigInt(digits.slice(0,2))+(digits[2]>='5'?1n:0n);
  if (cents<=0n || cents>9007199254740991n) throw new Error('unsupported_price_range');
  return Number(cents);
}

// Schedule after the regular market close plus a publication buffer. Intl keeps
// New York's DST transitions correct. Holidays simply retain the last published bar.
export function nextDailyCloseAt(exchange: string, timezone: string | null, now = new Date()) {
  return nextQuoteAt(exchange, timezone, false, now);
}
export function isUSMarket(exchange: string) {
  return ['XNYS', 'XNAS', 'XASE'].includes(exchange);
}
