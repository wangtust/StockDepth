export const CREDIT_PACKS = [
  {
    id: 'credits_10',
    credits: 10,
    amountUsd: 10,
    name: 'Starter Pack',
    description: 'Good for trying a few shallow or medium reports.',
    discountLabel: 'No discount'
  },
  {
    id: 'credits_30',
    credits: 30,
    amountUsd: 27,
    name: 'Research Pack',
    description: 'A better rate for regular watchlist research.',
    discountLabel: '10% off'
  },
  {
    id: 'credits_50',
    credits: 50,
    amountUsd: 40,
    name: 'Desk Pack',
    description: 'Best value for repeated deep reports and active research workflows.',
    discountLabel: '20% off'
  }
] as const;

export type CreditPackId = (typeof CREDIT_PACKS)[number]['id'];

export function getCreditPack(packId: string) {
  return CREDIT_PACKS.find((pack) => pack.id === packId) ?? null;
}
