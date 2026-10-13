import { fetchWithBackoff } from './request';
export type Report = { key: string; title: string; relative_path?: string; mtime?: number; size?: number; content: string };
export type Run<T = unknown> = { status: string; reports?: Report[]; report_version?: string; runner_log?: string; usage?: T };
// Per monitored run; never share versions across jobs or API restarts.
export class RunPoller<T> {
  private legacy = false;
  private version: string | undefined;
  private reports: Report[] = [];
  constructor(private url: string, private headers: Record<string, string> = {}) {}
  private async read(path: string) {
    const response = await fetchWithBackoff(this.url.replace('/api/run?', path + '?'), { headers: this.headers });
    return response;
  }
  private async full(): Promise<Run<T>> {
    const response = await this.read('/api/run');
    const run = await response.json();
    if (!response.ok || run.error) throw new Error(run.error || `StockDepth run fetch failed: ${response.status}`);
    return run;
  }
  async poll(): Promise<Run<T> & { reportsConsistent: boolean }> {
    if (this.legacy) return { ...await this.full(), reportsConsistent: true };
    const response = await this.read('/api/run/status');
    if ([404, 405].includes(response.status)) {
      await response.body?.cancel(); this.legacy = true;
      return { ...await this.full(), reportsConsistent: true };
    }
    const status = await response.json();
    if (!response.ok || status.error) throw new Error(status.error || `StockDepth status fetch failed: ${response.status}`);
    if (typeof status.report_version !== 'string' || !Array.isArray(status.reports)) {
      this.legacy = true; return { ...await this.full(), reportsConsistent: true };
    }
    if (status.report_version !== this.version) {
      const body = await this.full();
      // Cache the body's version, not the earlier status version: atomic writes
      // may happen between these two requests. Missing version means retry.
      this.version = body.report_version;
      this.reports = body.reports || [];
      return { ...status, report_version: body.report_version, runner_log: body.runner_log || status.runner_log, reports: this.reports,
        reportsConsistent: this.version === status.report_version };
    }
    return { ...status, reports: this.reports, reportsConsistent: true };
  }
}

export function reportValues(report: Report) {
  return { reportKey: report.key, title: report.title, relativePath: report.relative_path || null, content: report.content || '' };
}
export function reportMatches(row: ReturnType<typeof reportValues>, report: Report) {
  const values = reportValues(report);
  return row.reportKey === values.reportKey && row.title === values.title && row.relativePath === values.relativePath && row.content === values.content;
}
