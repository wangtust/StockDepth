import type { paperPortfolios, paperPositions } from '../db/schema';
import { safeCents } from './amount';

// Analysis context keeps the existing JSON-number contract. Derived monetary
// values are checked before queueing jobs or debiting credits.
export function buildPortfolioContext({ portfolio, positions, targetTicker, watchlist }: {
  portfolio: typeof paperPortfolios.$inferSelect;
  positions: (typeof paperPositions.$inferSelect)[];
  targetTicker: string;
  watchlist: string[];
}) {
  const marks = positions.map(position => ({
    ticker: position.ticker,
    quantity: position.quantity,
    avgCostCents: position.avgCostCents,
    lastPriceCents: position.lastPriceCents,
    marketValueCents: safeCents(BigInt(position.quantity) * BigInt(position.lastPriceCents), 'Position valuation'),
    realizedPnlCents: position.realizedPnlCents,
  }));
  const totalValueCents = safeCents(BigInt(portfolio.cashCents) + marks.reduce(
    (sum, position) => sum + BigInt(position.marketValueCents), 0n
  ), 'Portfolio valuation');
  const target = marks.find(position => position.ticker === targetTicker);
  return JSON.stringify({
    targetTicker,
    portfolio: {
      id: portfolio.id, name: portfolio.name, currency: portfolio.currency,
      cashCents: portfolio.cashCents, initialCashCents: portfolio.initialCashCents, totalValueCents,
    },
    targetPosition: target ? { ...target, weight: totalValueCents > 0 ? target.marketValueCents / totalValueCents : 0 } : null,
    positions: marks,
    watchlist,
  });
}
