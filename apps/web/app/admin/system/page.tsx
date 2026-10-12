import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import net from 'net';
import os from 'os';
import { promisify } from 'util';
import { desc, eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import { getAnalysisConcurrencySettings } from '@/lib/analysis/concurrency-settings';
import { updateAnalysisConcurrencySettings } from '@/app/admin/actions';
import { db } from '@/lib/db/drizzle';
import { analysisJobs } from '@/lib/db/schema';
import {
  formatAdminDate,
  formatAdminDateTime,
  formatElapsed,
  StatusBadge
} from '@/app/admin/_components/admin-ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PageProps = {
  searchParams: Promise<{ saved?: string }>;
};

type MemInfo = Record<string, number>;
const execFileAsync = promisify(execFile);

async function readMemInfo(): Promise<MemInfo | null> {
  try {
    const content = await readFile('/proc/meminfo', 'utf8');
    return Object.fromEntries(
      content.split('\n').flatMap((line) => {
        const match = /^([^:]+):\s+(\d+)/.exec(line);
        return match ? [[match[1], Number(match[2])]] : [];
      })
    );
  } catch {
    return null;
  }
}

function formatBytesFromKb(value?: number) {
  if (!value) {
    return '0 B';
  }

  const bytes = value * 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function envValue(name: string, fallback = 'not set') {
  return process.env[name] || fallback;
}

function positiveIntegerEnvValue(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

async function updateAnalysisConcurrencyAction(formData: FormData) {
  'use server';

  await updateAnalysisConcurrencySettings(formData);
  redirect('/admin/system?saved=1');
}

async function systemdStatus(serviceName: string) {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', serviceName], {
      timeout: 2000
    });
    const status = stdout.trim();
    return status === 'active' ? 'healthy' : status || 'warning';
  } catch {
    return 'offline';
  }
}

async function tcpStatus(host: string, port: number) {
  return new Promise<'healthy' | 'offline'>((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 1200 });
    socket.once('connect', () => {
      socket.destroy();
      resolve('healthy');
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve('offline');
    });
    socket.once('error', () => resolve('offline'));
  });
}

export default async function AdminSystemPage({ searchParams }: PageProps) {
  await requirePlatformAdmin();
  const { saved } = await searchParams;

  const [memInfo, jobStatusRows, recentRunningJobs, serviceStatuses, concurrencySettings] =
    await Promise.all([
    readMemInfo(),
    db
      .select({
        status: analysisJobs.status,
        count: sql<number>`count(*)::int`
      })
      .from(analysisJobs)
      .groupBy(analysisJobs.status)
      .orderBy(analysisJobs.status),
    db
      .select({
        id: analysisJobs.id,
        ticker: analysisJobs.ticker,
        status: analysisJobs.status,
        externalStatus: analysisJobs.externalStatus,
        externalPid: analysisJobs.externalPid,
        startedAt: analysisJobs.startedAt,
        updatedAt: analysisJobs.updatedAt
      })
      .from(analysisJobs)
      .where(eq(analysisJobs.status, 'running'))
      .orderBy(desc(analysisJobs.updatedAt))
      .limit(10)
    ,
    Promise.all([
      systemdStatus('saas-starter.service'),
      systemdStatus('saas-analysis-worker.service'),
      tcpStatus('127.0.0.1', 8008)
    ]),
    getAnalysisConcurrencySettings()
  ]);

  const loadAverage = os.loadavg();
  const memoryTotal = memInfo?.MemTotal;
  const memoryAvailable = memInfo?.MemAvailable;
  const memoryUsed =
    memoryTotal && memoryAvailable ? memoryTotal - memoryAvailable : undefined;
  const swapTotal = memInfo?.SwapTotal;
  const swapFree = memInfo?.SwapFree;
  const swapUsed = swapTotal && swapFree ? swapTotal - swapFree : undefined;
  const jobCounts = Object.fromEntries(
    jobStatusRows.map((row) => [row.status, row.count])
  );

  const resourceCards = [
    {
      label: 'App Uptime',
      value: formatDuration(Math.floor(process.uptime())),
      detail: `Node ${process.version}`
    },
    {
      label: 'CPU',
      value: `${os.cpus().length} cores`,
      detail: `load ${loadAverage.map((value) => value.toFixed(2)).join(' / ')}`
    },
    {
      label: 'Memory',
      value: memoryTotal ? formatBytesFromKb(memoryUsed) : 'Unavailable',
      detail: memoryTotal
        ? `${formatBytesFromKb(memoryAvailable)} available of ${formatBytesFromKb(memoryTotal)}`
        : 'Linux /proc/meminfo not readable'
    },
    {
      label: 'Swap',
      value: swapTotal ? formatBytesFromKb(swapUsed) : 'Unavailable',
      detail: swapTotal
        ? `${formatBytesFromKb(swapFree)} free of ${formatBytesFromKb(swapTotal)}`
        : 'No swap metrics available'
    }
  ];

  const runtimeConcurrencyCeiling = positiveIntegerEnvValue(
    'ANALYSIS_WORKER_MAX_CONCURRENCY',
    4
  );
  const effectiveWorkerConcurrency = Math.min(
    concurrencySettings.systemConcurrency,
    runtimeConcurrencyCeiling
  );

  const workerConfig = [
    ['Configured global concurrency', String(concurrencySettings.systemConcurrency)],
    ['Effective worker concurrency', String(effectiveWorkerConcurrency)],
    ['Runtime ceiling', String(runtimeConcurrencyCeiling)],
    ['Per-user concurrency', String(concurrencySettings.userConcurrency)],
    ['Poll interval', `${envValue('ANALYSIS_WORKER_POLL_MS', '5000')} ms`],
    ['Soft timeout', `${envValue('ANALYSIS_WORKER_RUN_TIMEOUT_MS', '2700000')} ms`],
    ['Stall timeout', `${envValue('ANALYSIS_WORKER_STALL_TIMEOUT_MS', '1200000')} ms`],
    ['Hard timeout', `${envValue('ANALYSIS_WORKER_HARD_TIMEOUT_MS', '10800000')} ms`],
    ['Mock mode', envValue('ANALYSIS_WORKER_MOCK', 'false')],
    ['Analysis API', envValue('STOCKDEPTH_API_URL', 'http://127.0.0.1:8008')]
  ];

  const queueCards = [
    { label: 'Queued', value: jobCounts.queued ?? 0 },
    { label: 'Running', value: jobCounts.running ?? 0 },
    { label: 'Complete', value: jobCounts.complete ?? 0 },
    { label: 'Failed', value: jobCounts.failed ?? 0 }
  ];
  const serviceCards = [
    {
      label: 'StockDepth Web',
      status: serviceStatuses[0],
      detail: 'systemd: saas-starter.service'
    },
    {
      label: 'Analysis Worker',
      status: serviceStatuses[1],
      detail: 'systemd: saas-analysis-worker.service'
    },
    {
      label: 'Analysis API',
      status: serviceStatuses[2],
      detail: 'tcp: 127.0.0.1:8008'
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">System</h1>
        <p className="mt-1 text-sm text-slate-600">
          Runtime resources, worker configuration, and current queue pressure.
        </p>
      </div>

      {saved === '1' && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Concurrency settings saved successfully.
        </div>
      )}

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Concurrency Limits</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateAnalysisConcurrencyAction} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="systemConcurrency"
                  className="block text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  System max concurrent analyses
                </label>
                <Input
                  id="systemConcurrency"
                  name="systemConcurrency"
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  defaultValue={concurrencySettings.systemConcurrency}
                  className="mt-2"
                  required
                />
                <p className="mt-2 text-xs text-slate-500">
                  Worker concurrency is capped by the runtime ceiling in the environment.
                </p>
              </div>

              <div>
                <label
                  htmlFor="userConcurrency"
                  className="block text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  Per-user concurrent analyses
                </label>
                <Input
                  id="userConcurrency"
                  name="userConcurrency"
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  defaultValue={concurrencySettings.userConcurrency}
                  className="mt-2"
                  required
                />
                <p className="mt-2 text-xs text-slate-500">
                  Limits how many jobs one user can have running at the same time.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-500">
                Last updated {formatAdminDateTime(concurrencySettings.updatedAt)}
              </div>
              <Button type="submit">Save Limits</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {resourceCards.map((item) => (
          <Card key={item.label} className="rounded-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-slate-950">{item.value}</div>
              <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Service Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {serviceCards.map((service) => (
              <div
                key={service.label}
                className="rounded-md border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-950">{service.label}</div>
                  <StatusBadge status={service.status} />
                </div>
                <div className="mt-2 text-xs text-slate-500">{service.detail}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="rounded-md">
          <CardHeader>
            <CardTitle>Worker Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100">
              {workerConfig.map(([label, value]) => (
                <div
                  key={label}
                  className="grid gap-2 py-3 text-sm sm:grid-cols-[220px_1fr]"
                >
                  <div className="font-medium text-slate-600">{label}</div>
                  <div className="break-all text-slate-950">{value}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-md">
          <CardHeader>
            <CardTitle>Queue Snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {queueCards.map((item) => (
                <div key={item.label} className="rounded-md border border-slate-200 p-3">
                  <div className="text-xs uppercase text-slate-500">{item.label}</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Running Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {recentRunningJobs.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-3 pr-4">Job</th>
                    <th className="py-3 pr-4">External</th>
                    <th className="py-3 pr-4">Started</th>
                    <th className="py-3 pr-4">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentRunningJobs.map((job) => (
                    <tr key={job.id}>
                      <td className="py-3 pr-4">
                        <div className="font-medium text-slate-950">
                          #{job.id} {job.ticker}
                        </div>
                        <div className="mt-1"><StatusBadge status={job.status} /></div>
                      </td>
                      <td className="py-3 pr-4">
                        <div>{job.externalStatus || 'no external status'}</div>
                        <div className="text-xs text-slate-500">
                          {job.externalPid ? `pid ${job.externalPid}` : 'no pid'}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {formatAdminDate(job.startedAt)}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        <div>{formatAdminDate(job.updatedAt)}</div>
                        <div className="text-xs text-slate-500">
                          {formatElapsed(job.startedAt || job.updatedAt)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No running jobs.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
