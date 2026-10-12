// Per-request measurements exposed in the browser Network > Timing panel.
export class RequestTiming {
  private started = performance.now();
  private durations: { name: string; duration: number }[] = [];

  async measure<T>(name: string, operation: () => PromiseLike<T>): Promise<T> {
    const start = performance.now();
    try { return await operation(); }
    finally { this.durations.push({ name, duration: performance.now() - start }); }
  }

  headers() {
    const entries = [...this.durations, { name: 'total', duration: performance.now() - this.started }];
    return {
      'Server-Timing': entries.map(item => `${item.name};dur=${item.duration.toFixed(1)}`).join(', '),
      'Cache-Control': 'private, no-store'
    };
  }
}
