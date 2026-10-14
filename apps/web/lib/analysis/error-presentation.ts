export type ErrorContext = 'analysis' | 'request';
export type PresentedError = {
  kind: 'unknown' | 'provider' | 'timeout' | 'connection' | 'rate-limit';
  title: string;
  description: string;
  nextStep: string;
};

// Raw evidence is inspected only, never interpolated into UI copy.
export function presentError(error: unknown, context: ErrorContext = 'analysis'): PresentedError {
  const evidence = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  const nextStep = context === 'analysis'
    ? 'Previously saved reports remain available. Use the available task controls to decide your next step.'
    : 'Try the request again later.';
  const result = (kind: PresentedError['kind'], title: string, description: string): PresentedError => ({ kind, title, description, nextStep });
  if (/\bRateLimitError\b|\bHTTP(?:\s+status)?\s*[:=]?\s*429\b|\bstatus(?:_code| code)?\s*[:=]\s*429\b/i.test(evidence))
    return result('rate-limit', 'Rate Limit Reached', 'The request received a rate limit response.');
  if (/\b(?:APITimeoutError|TimeoutError|ETIMEDOUT)\b/.test(evidence))
    return result('timeout', 'Connection Timeout', 'The request timed out before it could complete.');
  if (/\b(?:APIConnectionError|ConnectionError|ECONNREFUSED|ENOTFOUND)\b/.test(evidence))
    return result('connection', 'Connection Failed', 'A connection could not be established.');
  if (/\b(?:openai|anthropic)\.(?:APIStatusError|BadRequestError|AuthenticationError|InternalServerError)\b/.test(evidence))
    return result('provider', 'Provider Request Failed', 'The model provider returned an error response.');
  return result('unknown', context === 'analysis' ? 'Analysis Failed' : 'Unable to Complete Request',
    context === 'analysis' ? 'The analysis could not be completed.' : 'The request could not be completed.');
}
