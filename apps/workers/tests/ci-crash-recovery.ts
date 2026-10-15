// Kill a real worker process mid-fixture, then recover through its expired lease.
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {eq, sql} from 'drizzle-orm';
import {db, client} from '@/lib/db/drizzle';
import {analysisJobs, analysisReports, analysisModelCalls, users} from '@/lib/db/schema';
const children: ChildProcess[] = [];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  process.kill(-child.pid!, signal);
  await closed;
}
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await read(); if (ready(value)) return value; await pause(50); }
  throw new Error('Worker recovery condition timed out');
}
function launch(delay: number) {
  const child = spawn(process.env.STOCKDEPTH_RUNTIME_BIN + '/tsx', ['src/analysis-worker.ts'], {
    cwd: process.cwd(), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, ANALYSIS_WORKER_MOCK: 'true', ANALYSIS_WORKER_MOCK_DELAY_MS: String(delay),
      ANALYSIS_WORKER_LEASE_MS: '3000', ANALYSIS_WORKER_POLL_MS: '50', ANALYSIS_WORKER_MIN_AVAILABLE_MEMORY_MB: '1'},
  });
  child.stdout!.resume(); child.stderr!.resume(); children.push(child); return child;
}
async function main() {
  const [identity] = await db.execute(sql`select current_database() name`);
  assert(String(identity.name).startsWith('stockdepth_ci_crash_'));
  const [user] = await db.insert(users).values({email: 'crash@example.test', passwordHash: 'fixture', analysisCredits: 100}).returning();
  const [job] = await db.insert(analysisJobs).values({userId: user.id, runId: randomUUID(), ticker: 'MOCK', tradeDate: '2026-10-15', analysts: '[]', provider: 'mock'}).returning();
  const read = async () => (await db.select().from(analysisJobs).where(eq(analysisJobs.id, job.id)))[0];
  const first = launch(30000);
  const claimed = await until(read, value => value.status === 'running' && !!value.workerOwner);
  assert.equal((await db.select().from(analysisReports)).length, 0);
  await stop(first, 'SIGKILL');
  assert.equal(first.signalCode, 'SIGKILL');
  await until(read, value => !!value.workerLeaseUntil && value.workerLeaseUntil.getTime() <= Date.now());
  const recovered = launch(10);
  const complete = await until(read, value => value.status === 'complete');
  assert.equal(complete.workerOwner, null);
  assert.equal(complete.startedAt!.getTime(), claimed.startedAt!.getTime());
  assert.equal(complete.tokenUsageComplete, true);
  const reports = await db.select().from(analysisReports).where(eq(analysisReports.jobId, job.id));
  assert.deepEqual(reports.map(report => report.reportKey).sort(), ['decision', 'market', 'news']);
  assert.equal((await db.select().from(analysisModelCalls)).length, 0);
  assert.equal((await db.select().from(users).where(eq(users.id, user.id)))[0].analysisCredits, 100);
  await pause(200);
  assert.equal((await db.select().from(analysisReports)).length, 3);
  await stop(recovered);
  console.log('PASS actual worker SIGKILL during mock execution, real lease expiry, process restart, unique reports, unchanged credits and zero model calls');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.all(children.map(child => stop(child, 'SIGKILL'))); await client.end();
});
