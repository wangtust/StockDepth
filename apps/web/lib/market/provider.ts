import { execFile } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { MARKETS } from './policy';
const price=z.string().regex(/^\d{1,16}(\.\d{1,8})?$/).refine(v=>!/^0+(\.0+)?$/.test(v));
const timestamp=z.string().datetime({offset:true});
const identity=z.object({symbol:z.string().min(1).max(40),exchange:z.string(),currency:z.string(),timezone:z.string(),name:z.string().max(160),vendorSymbol:z.string().max(40),status:z.literal('verified')});
const quote=z.object({price,currency:z.string(),quotedAt:timestamp,priceType:z.literal('regular_unadjusted'),session:z.literal('regular')});
const daily=z.object({tradingDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),open:price,high:price,low:price,close:price,volume:z.string().regex(/^\d{1,18}$/),adjusted:z.literal(false)});
export const providerSchema=z.object({identity,fetchedAt:timestamp,source:z.literal('yahoo'),quote:quote.optional(),daily:z.array(daily).max(370).optional(),errors:z.partialRecord(z.enum(['identity','quote','daily']),z.string().max(80)).default({})});
export type ProviderResult=z.infer<typeof providerSchema>;
export type MarketProvider=(symbol:string,categories:string[],start?:string)=>Promise<ProviderResult>;
export function validateProvider(raw:unknown,symbol:string,now=new Date()) {
  const data=providerSchema.parse(raw),i=data.identity,market=MARKETS[i.exchange];
  if (!market || i.currency!==market.currency || i.timezone!==market.timezone || i.symbol!==symbol || i.vendorSymbol!==symbol) throw new Error('identity_mismatch');
  const fetched=Date.parse(data.fetchedAt);
  if (fetched>now.getTime() || fetched<now.getTime()-5*60_000) throw new Error('invalid_fetch_time');
  if (data.quote && (data.quote.currency!==i.currency || Date.parse(data.quote.quotedAt)>Math.min(now.getTime(),fetched) || Date.parse(data.quote.quotedAt)<0)) throw new Error('invalid_quote');
  for (const row of data.daily??[]) {
    if (new Date(row.tradingDate).toISOString().slice(0,10)!==row.tradingDate || row.tradingDate>now.toISOString().slice(0,10) || BigInt(row.volume)>9223372036854775807n) throw new Error('invalid_daily');
    const exact=(v:string)=>{const [w,f='']=v.split('.');return BigInt(w)*100000000n+BigInt(f.padEnd(8,'0'));};
    const low=exact(row.low),high=exact(row.high);
    if (low>high || [row.open,row.close].some(v=>exact(v)<low||exact(v)>high)) throw new Error('invalid_ohlc');
  }
  return data;
}
export const yahooProvider:MarketProvider=async(symbol,categories,start)=> {
  const python=process.env.STOCKDEPTH_RUNTIME_BIN ? path.join(process.env.STOCKDEPTH_RUNTIME_BIN,'python'):'python3';
  // cwd is apps/workers under manage; also supports running from repository root.
  const script=path.resolve(process.cwd(),process.cwd().endsWith('/apps/workers')?'../api/stockdepth/data/market_adapter.py':'apps/api/stockdepth/data/market_adapter.py');
  const args=[script,'--symbol',symbol,'--categories',categories.join(','),...(start?['--start',start]:[])];
  const output=await new Promise<string>((resolve,reject)=>execFile(python,args,{timeout:40_000,maxBuffer:1_000_000},(error,stdout)=>error?reject(new Error('provider_timeout_or_failure')):resolve(stdout)));
  try { return validateProvider(JSON.parse(output),symbol); }
  catch { throw new Error('provider_invalid_or_unresolved'); }
};
