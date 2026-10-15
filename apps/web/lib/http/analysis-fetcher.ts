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

export async function analysisFetcher(url: string) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let failure: AnalysisReadError;
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) {
        throw new AnalysisReadError(response.status,
          [408, 429, 500, 502, 503, 504].includes(response.status));
      }
      return await response.json();
    } catch (error) {
      failure = error instanceof AnalysisReadError ? error : new AnalysisReadError(0, true);
    } finally {
      clearTimeout(timer);
    }
    if (!failure.transient || attempt >= 2) throw failure;
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
}
