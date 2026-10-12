import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { paperTradeDecisions } from '@/lib/db/schema';
import { applyTrade, integerAmount, lockPortfolio, lockPositions, PaperTradeError, Portfolio, Position } from './trading';

type Decision = typeof paperTradeDecisions.$inferSelect;
export type PaperExecutionResult = { status: 'executed' | 'skipped'; message?: string };

// Legacy Worker input remains accepted; portfolio/position snapshots are identity hints
// only. The API uses executePaperDecisionForUser with the authenticated user ID.
export async function executePaperDecision({ decision: hint, portfolio, maxPositionBps = 2000, maxTradeBps = 1000, expectedUserId }: {
  decision: Decision;
  portfolio: Portfolio;
  positions: Position[];
  maxPositionBps?: number;
  maxTradeBps?: number;
  expectedUserId?: number;
}): Promise<PaperExecutionResult> {
  return executeLockedDecision({ decisionId: hint.id, portfolioId: portfolio.id,
    userId: expectedUserId ?? hint.userId, maxPositionBps, maxTradeBps });
}

export async function executePaperDecisionForUser(decisionId: number, userId: number): Promise<PaperExecutionResult> {
  return executeLockedDecision({ decisionId, userId, maxPositionBps: 2000, maxTradeBps: 1000 });
}

async function executeLockedDecision({ decisionId, portfolioId, userId, maxPositionBps, maxTradeBps }: {
  decisionId: number; portfolioId?: number; userId: number; maxPositionBps: number; maxTradeBps: number;
}): Promise<PaperExecutionResult> {
  integerAmount(decisionId, 'Decision ID', 1);
  for (const bps of [maxPositionBps, maxTradeBps]) {
    if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10000) throw new PaperTradeError('Invalid risk limit.');
  }
  return db.transaction(async tx => {
    // Discover only the lock target, never status/balance/position snapshots. Ownership
    // and the full decision are checked again after the portfolio lock is acquired.
    if (portfolioId === undefined) {
      const [target] = await tx.select({ portfolioId: paperTradeDecisions.portfolioId }).from(paperTradeDecisions)
        .where(and(eq(paperTradeDecisions.id, decisionId), eq(paperTradeDecisions.userId, userId))).limit(1);
      if (!target) throw new PaperTradeError('Decision not found.', 404);
      portfolioId = target.portfolioId;
    }
    const currentPortfolio = await lockPortfolio(tx, portfolioId, userId);
    const [decision] = await tx.select().from(paperTradeDecisions).where(and(
      eq(paperTradeDecisions.id, decisionId), eq(paperTradeDecisions.portfolioId, currentPortfolio.id), eq(paperTradeDecisions.userId, userId)
    )).for('update');
    if (!decision) throw new PaperTradeError('Decision not found.', 404);
    if (decision.status === 'executed') return { status: 'skipped', message: 'Decision has already been executed.' };
    if (!['proposed', 'skipped'].includes(decision.status)) throw new PaperTradeError(`Decision cannot be executed from status ${decision.status}.`);
    const skip = async (message: string): Promise<PaperExecutionResult> => {
      await tx.update(paperTradeDecisions).set({status:'skipped', errorMessage:message, executedAt:null}).where(eq(paperTradeDecisions.id,decision.id));
      return {status:'skipped',message};
    };
    if (decision.action === 'hold') return skip('Hold decision.');
    if (!['buy','sell'].includes(decision.action)) return skip(`Unsupported action: ${decision.action}`);
    const positions = await lockPositions(tx, currentPortfolio);
    const position = positions.find(p=>p.ticker===decision.ticker);
    integerAmount(decision.quantity, 'Decision quantity'); integerAmount(decision.priceCents, 'Decision price');
    if (!Number.isSafeInteger(decision.targetWeightBps) || decision.targetWeightBps<0 || decision.targetWeightBps>10000) throw new PaperTradeError('Invalid target weight.');
    const priceCents = decision.priceCents || position?.lastPriceCents || 0;
    if (!priceCents) return skip('No usable price for simulated execution.');
    // Exact arithmetic for valuation and percentage floors; no unsafe products in Number.
    const total = BigInt(currentPortfolio.cashCents) + positions.reduce((sum,p)=>sum+BigInt(p.quantity)*BigInt(p.lastPriceCents),0n);
    const current = position ? BigInt(position.quantity)*BigInt(position.lastPriceCents) : 0n;
    const target = total*BigInt(Math.min(decision.targetWeightBps,maxPositionBps))/10000n;
    const maxTrade = total*BigInt(maxTradeBps)/10000n;
    const min = (...values: bigint[])=>values.reduce((a,b)=>a<b?a:b);
    const modelQuantity = BigInt(decision.quantity || 2_147_483_647);
    let quantity: number;
    if (decision.action==='buy') {
      const desired = target>current ? target-current : 0n;
      const spend = min(desired,maxTrade,BigInt(currentPortfolio.cashCents));
      quantity=Number(min(modelQuantity,spend/BigInt(priceCents)));
      if (!quantity) return skip('Risk checks reduced buy quantity to zero.');
    } else {
      if (!position || !position.quantity) return skip('No shares available to sell.');
      const desired = current>target ? current-target : 0n;
      quantity=Number(min(modelQuantity,min(desired,maxTrade)/BigInt(priceCents),BigInt(position.quantity)));
      if (!quantity) return skip('Risk checks reduced sell quantity to zero.');
    }
    await applyTrade(tx,currentPortfolio,position,{
      ticker:decision.ticker,side:decision.action as 'buy'|'sell',quantity,priceCents,
      note:`Paper trade from decision #${decision.id}`,decisionId:decision.id
    });
    await tx.update(paperTradeDecisions).set({status:'executed',quantity,priceCents,executedAt:new Date(),errorMessage:null}).where(eq(paperTradeDecisions.id,decision.id));
    return {status:'executed'};
  });
}
