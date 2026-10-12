// The existing API exposes cents as JSON numbers. Reject before Number conversion;
// database bigint storage and intermediate arithmetic must never silently round.
export class AmountRangeError extends RangeError {}
export const MAX_CENTS = 9_007_199_254_740_991n;
export function safeCents(value: bigint, label = 'Amount'): number {
  if (value < -MAX_CENTS || value > MAX_CENTS) throw new AmountRangeError(`${label} is outside the supported safe integer range.`);
  return Number(value);
}
export function centsFromDecimal(value: string): number {
  const match = /^(\d{1,400})(?:\.(\d{1,400}))?(?:e([+-]?\d{1,3}))?$/i.exec(value);
  if (!match) throw new AmountRangeError('Invalid monetary decimal.');
  const [, whole, fraction = '', exponent = '0'] = match;
  const power = Number(exponent) + 2 - fraction.length;
  if (Math.abs(power) > 800) throw new AmountRangeError('Invalid monetary exponent.');
  const digits = BigInt(whole + fraction);
  if (power >= 0) return safeCents(digits * 10n ** BigInt(power));
  const divisor = 10n ** BigInt(-power);
  return safeCents((2n * digits + divisor) / (2n * divisor));
}
