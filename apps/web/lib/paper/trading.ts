import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { users, paperPortfolios, paperPositions, paperTrades, paperTradeRequests } from '@/lib/db/schema';
import { normalizeTicker } from '@/lib/market/tickers';

export class PaperTradeError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
export type PaperTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Portfolio = typeof paperPortfolios.$inferSelect;
export type Position = typeof paperPositions.$inferSelect;
const INT_MAX = 2_147_483_647;
const INT_MIN = -2_147_483_648;
export function integerAmount(value: number, label: string, min = 0): number {
  if (!Number.isSafeInteger(value) || value < min || value > INT_MAX) {
    throw new PaperTradeError(`${label} is outside the supported integer range.`);
  }
  return value;
}
function signedAmount(value: number, label: string) { return integerAmount(value, label, INT_MIN); }

export const manualTradeSchema = z.object({
  portfolioId: z.coerce.number().int().positive().max(INT_MAX),
  ticker: z.string().trim().min(1).max(40),
  side: z.enum(['buy', 'sell']),
  quantity: z.coerce.number().int().positive().max(10_000_000),
  price: z.coerce.number().finite().positive().max(10_000_000),
  note: z.string().trim().max(500).optional()
});
export type ManualTradeInput = z.infer<typeof manualTradeSchema>;
export function parseIdempotencyKey(key: string | null): string | undefined {
  if (key === null) return undefined;
  if (!z.string().uuid().safeParse(key).success) throw new PaperTradeError('Idempotency-Key must be a UUID.');
  return key.toLowerCase();
}

// All execution paths acquire user SHARE -> portfolio UPDATE -> decision UPDATE
// (AI only) -> positions UPDATE ordered by id. The portfolio is the serialization
// boundary, including absent positions and idempotency records. Never use caller snapshots.
export async function lockPortfolio(tx: PaperTx, portfolioId: number, userId: number): Promise<Portfolio> {
  integerAmount(portfolioId, 'Portfolio ID', 1); integerAmount(userId, 'User ID', 1);
  const [user] = await tx.select({ id: users.id, status: users.status, deletedAt: users.deletedAt })
    .from(users).where(eq(users.id, userId)).for('share');
  if (!user || user.status !== 'active' || user.deletedAt) throw new PaperTradeError('Unauthorized', 403);
  const [portfolio] = await tx.select().from(paperPortfolios)
    .where(and(eq(paperPortfolios.id, portfolioId), eq(paperPortfolios.userId, userId))).for('update');
  if (!portfolio || portfolio.status !== 'active') throw new PaperTradeError('Portfolio not found.', 404);
  integerAmount(portfolio.cashCents, 'Portfolio cash');
  return portfolio;
}
export async function lockPositions(tx: PaperTx, portfolio: Portfolio) {
  const positions = await tx.select().from(paperPositions)
    .where(eq(paperPositions.portfolioId, portfolio.id)).orderBy(asc(paperPositions.id)).for('update');
  for (const p of positions) {
    if (p.userId !== portfolio.userId) throw new PaperTradeError('Position ownership mismatch.');
    integerAmount(p.quantity, 'Position quantity'); integerAmount(p.avgCostCents, 'Average cost');
    integerAmount(p.lastPriceCents, 'Position price'); signedAmount(p.realizedPnlCents, 'Realized PnL');
  }
  return positions;
}

export async function applyTrade(tx: PaperTx, portfolio: Portfolio, position: Position | undefined, input: {
  ticker: string; side: 'buy' | 'sell'; quantity: number; priceCents: number; note: string | null; decisionId?: number;
}) {
  const { quantity, priceCents } = input;
  integerAmount(quantity, 'Quantity', 1); integerAmount(priceCents, 'Price', 1);
  // Reject overflow before computing any writes. All persisted amounts are PostgreSQL int4.
  const grossAmountCents = integerAmount(quantity * priceCents, 'Trade amount', 1);
  const oldQuantity = position?.quantity ?? 0;
  if (input.side === 'buy' && portfolio.cashCents < grossAmountCents) throw new PaperTradeError('Not enough cash for this trade.');
  if (input.side === 'sell' && (!position || oldQuantity < quantity)) throw new PaperTradeError('Not enough shares for this sale.');
  const newQuantity = integerAmount(oldQuantity + (input.side === 'buy' ? quantity : -quantity), 'Position quantity');
  const newCash = integerAmount(portfolio.cashCents + (input.side === 'buy' ? -grossAmountCents : grossAmountCents), 'Portfolio cash');
  // The cost numerator can exceed safe JS integers even when the final int4 value fits.
  const cost = BigInt(oldQuantity) * BigInt(position?.avgCostCents ?? 0) + BigInt(grossAmountCents);
  const avgCostCents = input.side === 'buy'
    ? integerAmount(Number((2n * cost + BigInt(newQuantity)) / (2n * BigInt(newQuantity))), 'Average cost')
    : position!.avgCostCents;
  const realizedPnlCents = input.side === 'sell' ? signedAmount((priceCents - position!.avgCostCents) * quantity, 'Trade PnL') : 0;
  const totalPnl = signedAmount((position?.realizedPnlCents ?? 0) + realizedPnlCents, 'Position PnL');
  const values = { quantity: newQuantity, avgCostCents, lastPriceCents: priceCents, realizedPnlCents: totalPnl, updatedAt: new Date() };
  const [updatedPosition] = position
    ? await tx.update(paperPositions).set(values).where(eq(paperPositions.id, position.id)).returning()
    : await tx.insert(paperPositions).values({ ...values, portfolioId: portfolio.id, userId: portfolio.userId, ticker: input.ticker }).returning();
  await tx.update(paperPortfolios).set({ cashCents: newCash, updatedAt: new Date() }).where(eq(paperPortfolios.id, portfolio.id));
  const [trade] = await tx.insert(paperTrades).values({
    portfolioId: portfolio.id, userId: portfolio.userId, positionId: updatedPosition.id,
    decisionId: input.decisionId, ticker: input.ticker, side: input.side, quantity, priceCents,
    grossAmountCents, realizedPnlCents, note: input.note
  }).returning();
  return { trade, position: updatedPosition };
}

export async function executeManualTrade(userId: number, raw: ManualTradeInput, key?: string) {
  const data = manualTradeSchema.parse(raw);
  const ticker = normalizeTicker(data.ticker);
  if (!ticker || ticker.length > 40) throw new PaperTradeError('Invalid ticker.');
  const priceCents = integerAmount(Math.round(data.price * 100), 'Price', 1);
  integerAmount(data.quantity * priceCents, 'Trade amount', 1);
  if (key !== undefined) key = parseIdempotencyKey(key);
  // Canonical request identity is stable under JSON property order, but includes the
  // submitted price (not only rounded cents), so changing price cannot reuse a key.
  const request = JSON.stringify({ ticker, side: data.side, quantity: data.quantity, price: data.price, note: data.note || null });
  return db.transaction(async tx => {
    const portfolio = await lockPortfolio(tx, data.portfolioId, userId);
    if (key) {
      const [saved] = await tx.select().from(paperTradeRequests).where(and(
        eq(paperTradeRequests.userId, userId), eq(paperTradeRequests.portfolioId, portfolio.id), eq(paperTradeRequests.key, key)
      ));
      if (saved) {
        if (saved.request !== request) throw new PaperTradeError('Idempotency-Key was already used for a different trade.', 409);
        return saved.result;
      }
    }
    const positions = await lockPositions(tx, portfolio);
    const result = await applyTrade(tx, portfolio, positions.find(p=>p.ticker===ticker), {
      ticker, side: data.side, quantity: data.quantity, priceCents, note: data.note || null
    });
    // Store the exact JSON response atomically with the trade; replay needs no new writes.
    const response = JSON.parse(JSON.stringify(result));
    if (key) await tx.insert(paperTradeRequests).values({ userId, portfolioId: portfolio.id, key, request, result: response });
    return response;
  });
}
