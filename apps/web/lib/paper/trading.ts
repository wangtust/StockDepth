import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { safeCents, centsFromDecimal } from './amount';
import { db } from '@/lib/db/drizzle';
import { users, paperPortfolios, paperPositions, paperTrades, paperTradeRequests } from '@/lib/db/schema';
import { ensureInstrument } from '../market/catalogue';
import { normalizeTicker } from '@/lib/market/tickers';

export class PaperTradeError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
export type PaperTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Portfolio = typeof paperPortfolios.$inferSelect;
export type Position = typeof paperPositions.$inferSelect;
const INT_MAX = 2_147_483_647;
const MIN_CENTS = -Number.MAX_SAFE_INTEGER;
export function integerAmount(value: number, label: string, min = 0): number {
  if (!Number.isSafeInteger(value) || value < min || value > Number.MAX_SAFE_INTEGER) {
    throw new PaperTradeError(`${label} is outside the supported integer range.`);
  }
  return value;
}
function signedAmount(value: number, label: string) { return integerAmount(value, label, MIN_CENTS); }
function exactAmount(value: bigint, label: string, min = 0) {
  try { return integerAmount(safeCents(value, label), label, min); }
  catch (error) { throw new PaperTradeError(error instanceof Error ? error.message : 'Unsafe amount.'); }
}
function quantityAmount(value: number, label: string, min = 0) {
  integerAmount(value,label,min);
  if (value > INT_MAX) throw new PaperTradeError(`${label} is outside the supported integer range.`);
  return value;
}

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
  quantityAmount(portfolioId, 'Portfolio ID', 1); quantityAmount(userId, 'User ID', 1);
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
    quantityAmount(p.quantity, 'Position quantity'); integerAmount(p.avgCostCents, 'Average cost');
    integerAmount(p.lastPriceCents, 'Position price'); signedAmount(p.realizedPnlCents, 'Realized PnL');
  }
  return positions;
}

export async function applyTrade(tx: PaperTx, portfolio: Portfolio, position: Position | undefined, input: {
  ticker: string; side: 'buy' | 'sell'; quantity: number; priceCents: number; note: string | null; decisionId?: number; instrumentId?: number; priceSnapshotId?: number; executionPrice?: string;
}) {
  const { quantity, priceCents } = input;
  quantityAmount(quantity, 'Quantity', 1); integerAmount(priceCents, 'Price', 1);
  // Exact intermediates; reject unsafe JSON-number results before any writes.
  const grossAmountCents = exactAmount(BigInt(quantity) * BigInt(priceCents), 'Trade amount', 1);
  const oldQuantity = position?.quantity ?? 0;
  if (input.side === 'buy' && portfolio.cashCents < grossAmountCents) throw new PaperTradeError('Not enough cash for this trade.');
  if (input.side === 'sell' && (!position || oldQuantity < quantity)) throw new PaperTradeError('Not enough shares for this sale.');
  const newQuantity = quantityAmount(oldQuantity + (input.side === 'buy' ? quantity : -quantity), 'Position quantity');
  const newCash = exactAmount(BigInt(portfolio.cashCents) + (input.side === 'buy' ? -BigInt(grossAmountCents) : BigInt(grossAmountCents)), 'Portfolio cash');
  // The cost numerator can exceed safe JS integers even when the final safe integer value fits.
  const cost = BigInt(oldQuantity) * BigInt(position?.avgCostCents ?? 0) + BigInt(grossAmountCents);
  const avgCostCents = input.side === 'buy'
    ? exactAmount((2n * cost + BigInt(newQuantity)) / (2n * BigInt(newQuantity)), 'Average cost')
    : position!.avgCostCents;
  const realizedPnlCents = input.side === 'sell' ? exactAmount((BigInt(priceCents) - BigInt(position!.avgCostCents)) * BigInt(quantity), 'Trade PnL', MIN_CENTS) : 0;
  const totalPnl = exactAmount(BigInt(position?.realizedPnlCents ?? 0) + BigInt(realizedPnlCents), 'Position PnL', MIN_CENTS);
  const values = { ...(input.instrumentId ? {instrumentId:input.instrumentId}:{}), quantity: newQuantity, avgCostCents, lastPriceCents: priceCents, realizedPnlCents: totalPnl, updatedAt: new Date() };
  const [updatedPosition] = position
    ? await tx.update(paperPositions).set(values).where(eq(paperPositions.id, position.id)).returning()
    : await tx.insert(paperPositions).values({ ...values, portfolioId: portfolio.id, userId: portfolio.userId, ticker: input.ticker }).returning();
  await tx.update(paperPortfolios).set({ cashCents: newCash, updatedAt: new Date() }).where(eq(paperPortfolios.id, portfolio.id));
  const [trade] = await tx.insert(paperTrades).values({
    portfolioId: portfolio.id, userId: portfolio.userId, positionId: updatedPosition.id,
    instrumentId: input.instrumentId ?? position?.instrumentId, priceSnapshotId: input.priceSnapshotId, executionPrice: input.executionPrice,
    decisionId: input.decisionId, ticker: input.ticker, side: input.side, quantity, priceCents,
    grossAmountCents, realizedPnlCents, note: input.note
  }).returning();
  return { trade, position: updatedPosition };
}

export async function executeManualTrade(userId: number, raw: ManualTradeInput, key?: string) {
  const data = manualTradeSchema.parse(raw);
  const ticker = normalizeTicker(data.ticker);
  if (!ticker || ticker.length > 40) throw new PaperTradeError('Invalid ticker.');
  const priceCents = integerAmount(centsFromDecimal(String(data.price)), 'Price', 1);
  exactAmount(BigInt(data.quantity) * BigInt(priceCents), 'Trade amount', 1);
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
    const instrument = await ensureInstrument(ticker,tx);
    const result = await applyTrade(tx, portfolio, positions.find(p=>p.ticker===ticker), {
      instrumentId:instrument?.id, ticker, side: data.side, quantity: data.quantity, priceCents, note: data.note || null
    });
    // Store the exact JSON response atomically with the trade; replay needs no new writes.
    const response = JSON.parse(JSON.stringify(result));
    if (key) await tx.insert(paperTradeRequests).values({ userId, portfolioId: portfolio.id, key, request, result: response });
    return response;
  });
}
