import 'server-only';

import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { analysisPricing } from '@/lib/db/schema';
import {
  DEPTH_CREDIT_COSTS,
  type AnalysisDepth,
  getDepthLabel,
  normalizePricingConfig
} from '@/lib/analysis/pricing';

export async function ensureAnalysisPricing() {
  await db
    .insert(analysisPricing)
    .values(
      ([1, 3, 5] as AnalysisDepth[]).map((depth) => ({
        depth,
        label: getDepthLabel(depth),
        creditCost: DEPTH_CREDIT_COSTS[depth]
      }))
    )
    .onConflictDoNothing();
}

export async function getAnalysisPricingRows() {
  const rows = await db
    .select({
      depth: analysisPricing.depth,
      label: analysisPricing.label,
      creditCost: analysisPricing.creditCost,
      updatedAt: analysisPricing.updatedAt
    })
    .from(analysisPricing)
    .orderBy(asc(analysisPricing.depth));
  if (rows.length === 3) return rows;
  await ensureAnalysisPricing();
  return db.select().from(analysisPricing).orderBy(asc(analysisPricing.depth));
}

export async function getAnalysisPricingConfig() {
  const rows = await getAnalysisPricingRows();

  return normalizePricingConfig(
    Object.fromEntries(rows.map((row) => [row.depth, row.creditCost]))
  );
}

export async function getDepthCreditCostFromDb(depth: number) {
  const [row] = await db
    .select({ creditCost: analysisPricing.creditCost })
    .from(analysisPricing)
    .where(eq(analysisPricing.depth, depth))
    .limit(1);

  if (!row) await ensureAnalysisPricing();
  return row?.creditCost ?? DEPTH_CREDIT_COSTS[depth as AnalysisDepth] ?? DEPTH_CREDIT_COSTS[1];
}
