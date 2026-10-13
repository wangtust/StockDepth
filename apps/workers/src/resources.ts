import { readFile, readdir } from 'node:fs/promises';

type Runner = { pid: number; start: string };
// Full discovery is bounded independently of job completions and metric logs.
export class ResourceMonitor {
  private discoveredAt = -Infinity;
  private runners: Runner[] = [];
  scans = 0;
  constructor(private intervalMs = 30000) {}
  async track(pid: number) {
    try {
      const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
      if (!args.some(arg => arg.endsWith('/analysis_runner.py'))) return;
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
      this.runners = this.runners.filter(runner => runner.pid !== pid);
      this.runners.push({ pid, start });
    } catch { /* Runner exited before the sample. */ }
  }
  async snapshot() {
    const memory = await readFile('/proc/meminfo', 'utf8');
    if (performance.now() - this.discoveredAt >= this.intervalMs) {
      const found: Runner[] = [];
      for (const pid of (await readdir('/proc')).filter(value => /^\d+$/.test(value))) {
        try {
          const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
          if (!args.some(arg => arg.endsWith('/analysis_runner.py'))) continue;
          const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
          found.push({ pid: Number(pid), start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] });
        } catch { /* Process exited. */ }
      }
      this.runners = found; this.discoveredAt = performance.now(); this.scans++;
    }
    let runnerRssMb = 0;
    for (const runner of this.runners) {
      try {
        const stat = await readFile(`/proc/${runner.pid}/stat`, 'utf8');
        if (stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] !== runner.start) continue;
        const status = await readFile(`/proc/${runner.pid}/status`, 'utf8');
        runnerRssMb += Number(status.match(/VmRSS:\s+(\d+)/)?.[1] || 0) / 1024;
      } catch { /* No stale PID reuse. */ }
    }
    return { availableMb: Math.round(Number(memory.match(/MemAvailable:\s+(\d+)/)?.[1] || 0) / 1024),
      runnerRssMb: Math.round(runnerRssMb), workerRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      runnerSampleAgeMs: Math.round(performance.now() - this.discoveredAt), discoveryScans: this.scans };
  }
}
