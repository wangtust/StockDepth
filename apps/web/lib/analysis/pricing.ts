export const DEPTH_CREDIT_COSTS = {
  1: 1,
  3: 3,
  5: 5
} as const;

export type AnalysisDepth = keyof typeof DEPTH_CREDIT_COSTS;
export type AnalysisPricingConfig = Record<AnalysisDepth, number>;

export function getDepthCreditCost(depth: number) {
  return DEPTH_CREDIT_COSTS[depth as AnalysisDepth] ?? DEPTH_CREDIT_COSTS[1];
}

export function normalizePricingConfig(
  pricing?: Partial<Record<number, number>>
): AnalysisPricingConfig {
  return {
    1: pricing?.[1] ?? DEPTH_CREDIT_COSTS[1],
    3: pricing?.[3] ?? DEPTH_CREDIT_COSTS[3],
    5: pricing?.[5] ?? DEPTH_CREDIT_COSTS[5]
  };
}

export function getDepthCreditCostFromConfig(
  depth: number,
  pricing: AnalysisPricingConfig
) {
  return pricing[depth as AnalysisDepth] ?? pricing[1];
}

export function getDepthLabel(depth: number) {
  if (depth === 5) {
    return 'Deep';
  }

  if (depth === 3) {
    return 'Medium';
  }

  return 'Shallow';
}
