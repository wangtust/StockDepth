// Client-only operation identity; never automatically retries a write.
export type ManualTradeBody = {
  portfolioId: number; ticker: string; side: 'buy' | 'sell';
  quantity: number; price: number; note: string;
};
export type ManualTradeOperation = { key: string; body: ManualTradeBody };
export function createManualTradeOperation(body: ManualTradeBody): ManualTradeOperation {
  if (typeof crypto.randomUUID === 'function') return { key: crypto.randomUUID(), body };
  // getRandomValues is available on the supported HTTP deployment as well.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const key = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { key, body };
}
// Only structured, definitive client/business rejections retire an operation.
// Timeouts, conflicts and server errors remain uncertain and reuse the key.
export function isDefinitiveTradeRejection(status: number, data: unknown) {
  return [400, 401, 403, 404, 422].includes(status) &&
    typeof data === 'object' && data !== null && 'error' in data &&
    typeof data.error === 'string' && data.error.length > 0;
}
