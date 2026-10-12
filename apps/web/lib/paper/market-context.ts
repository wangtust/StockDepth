import { enrichPositions } from '../market/service';
import { decimalCents } from '../market/policy';
import type { paperPositions } from '../db/schema';
// Structured context only; never value assets from last simulated fill/model suggestion.
export async function paperMarketContext(positions:(typeof paperPositions.$inferSelect)[],currency:string,cashCents:number) {
  const priced=await enrichPositions(positions,currency);
  const marks=priced.map(p=> {
    let marketValueCents:string|null=p.quantity===0?'0':null;
    if (p.quantity>0 && p.valuationStatus==='valid' && p.quote) {
      try {marketValueCents=(BigInt(p.quantity)*BigInt(decimalCents(p.quote.price))).toString();}
      catch { /* Unsupported numeric range remains missing, never zero. */ }
    }
    return {ticker:p.ticker,instrumentId:p.instrumentId,quantity:p.quantity,avgCostCents:p.avgCostCents,
      realizedPnlCents:p.realizedPnlCents,quote:p.quote,valuationStatus:p.valuationStatus,marketValueCents};
  });
  const valuationComplete=marks.every(p=>p.marketValueCents!==null);
  return {currency,cashCents,valuationComplete,totalValueCents:valuationComplete?
    (BigInt(cashCents)+marks.reduce((sum,p)=>sum+BigInt(p.marketValueCents!),0n)).toString():null,positions:marks};
}
