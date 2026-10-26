// Only analysis GETs use this policy. Never retry job creation or other writes.
export class AnalysisReadError extends Error {
  constructor(public readonly status: number, public readonly transient: boolean) {
    super(status ? `Request failed (HTTP ${status})` : 'ConnectionError: analysis refresh unavailable');
  }
}

export function shouldRetryAnalysisRead(error: unknown): boolean {
  return error instanceof AnalysisReadError && error.transient;
}

export function canRetainAnalysisData(error: unknown): boolean {
  return !error || error instanceof AnalysisReadError && error.transient;
}

// Bounded tab-local report reuse. The server still checks ownership/visibility
// on every request before accepting a validator; nothing is stored on disk.
const reportResponses = new Map<string, { etag: string; data: any; size: number }>();
const MAX_REPORT_CACHE_CHARS = 2_000_000;
let reportCacheChars = 0;

function forgetReport(url: string) {
  const previous = reportResponses.get(url);
  if (previous) reportCacheChars -= previous.size;
  reportResponses.delete(url);
}

export async function analysisFetcher(url: string) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let failure: AnalysisReadError;
    try {
      const cached = reportResponses.get(url);
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store',
        headers: cached ? { 'If-None-Match': cached.etag } : undefined });
      if (response.status === 304 && cached) return cached.data;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) forgetReport(url);
        throw new AnalysisReadError(response.status,
          [408, 429, 500, 502, 503, 504].includes(response.status));
      }
      const text = await response.text();
      const data = JSON.parse(text);
      const etag = response.headers.get('etag');
      if (url.includes('?report=') && etag) {
        forgetReport(url);
        if (text.length <= MAX_REPORT_CACHE_CHARS) {
          reportResponses.set(url, { etag, data, size: text.length });
          reportCacheChars += text.length;
          while (reportResponses.size > 16 || reportCacheChars > MAX_REPORT_CACHE_CHARS) {
            forgetReport(reportResponses.keys().next().value!);
          }
        }
      }
      return data;
    } catch (error) {
      failure = error instanceof AnalysisReadError ? error : new AnalysisReadError(0, true);
    } finally {
      clearTimeout(timer);
    }
    if (!failure.transient || attempt >= 2) throw failure;
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
}
