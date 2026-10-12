export async function fetchWithBackoff(url: string, init: RequestInit = {}) {
  // The start API only deduplicates while a run is alive. Never replay a mutation
  // after an ambiguous response: the first run could already have completed.
  const attempts = (init.method || 'GET').toUpperCase() === 'GET' ? 4 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await delay(attempt);
      continue;
    }
    if (![408, 429, 502, 503, 504].includes(response.status) || attempt === attempts - 1) return response;
    const retryAfter = response.headers.get('retry-after');
    const retryMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000
      : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
    await response.body?.cancel();
    await delay(attempt, retryMs);
  }
  throw new Error('Retry limit reached');
}

function delay(attempt: number, retryMs = 0) {
  return new Promise(resolve => setTimeout(resolve,
    Math.min(15000, Math.max(500 * 2 ** attempt + Math.random() * 250, retryMs || 0))));
}
