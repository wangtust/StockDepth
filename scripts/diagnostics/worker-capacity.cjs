// Real queue/report persistence against an ephemeral database; no paid calls.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const modules = root + '/apps/web/node_modules';
require(modules + '/dotenv').config({ path: root + '/.env' });
const postgres = require(modules + '/postgres');
const { drizzle } = require(modules + '/drizzle-orm/postgres-js');
const { migrate } = require(modules + '/drizzle-orm/postgres-js/migrator');
const admin = postgres(process.env.POSTGRES_URL, { max: 1 });
const name = 'stockdepth_capacity_' + randomUUID().replaceAll('-', '');
const results = [];
let test, created = false, worker;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function rssTree(pid) {
  const processes = new Map();
  for (const entry of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
    try {
      const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
      processes.set(Number(entry), { parent: Number(status.match(/PPid:\s+(\d+)/)?.[1]), rss: Number(status.match(/VmRSS:\s+(\d+)/)?.[1] || 0) });
    } catch {}
  }
  const ids = new Set([pid]);
  let changed = true;
  while (changed) { changed = false; for (const [id, p] of processes) if (ids.has(p.parent) && !ids.has(id)) { ids.add(id); changed = true; } }
  return [...ids].reduce((sum, id) => sum + (processes.get(id)?.rss || 0), 0);
}
async function stopWorker() {
  if (!worker) return;
  const child = worker; worker = null;
  if (child.exitCode !== null) return;
  process.kill(-child.pid, 'SIGTERM');
  await new Promise(resolve => child.once('close', resolve));
}
(async () => {
  try {
    await admin`create database ${admin(name)}`; created = true;
    const url = new URL(process.env.POSTGRES_URL); url.pathname = '/' + name;
    test = postgres(url.toString(), { max: 2, connection: { TimeZone: 'UTC' } });
    await migrate(drizzle(test), { migrationsFolder: root + '/apps/web/lib/db/migrations' });
    const [user] = await test`insert into users(email,password_hash) values('capacity@test.invalid','unused') returning id`;
    // Verify that all migrations can initialize an entirely new database.
    const tables = await test`select tablename from pg_tables where schemaname='public'`;
    if (!['analysis_jobs','analysis_model_calls','paper_analysis_runs','paper_model_calls'].every(name => tables.some(table => table.tablename === name))) throw Error('Fresh initialization failed');
    for (const concurrency of [1, 2, 4]) {
      const queued = Date.now();
      const values = Array.from({ length: 8 }, (_, i) => ({ user_id: user.id,
        run_id: `capacity-${concurrency}-${i}`, ticker: 'MOCK', trade_date: '2026-10-12',
        analysts: '[]', provider: `mock-${i % 4}`, base_url: 'mock://test' }));
      await test`insert into analysis_jobs ${test(values)}`;
      worker = spawn(process.env.STOCKDEPTH_RUNTIME_BIN + '/tsx', ['src/analysis-worker.ts'], {
        cwd: root + '/apps/workers', detached: true,
        env: { ...process.env, POSTGRES_URL: url.toString(), ANALYSIS_WORKER_MOCK: 'true',
          ANALYSIS_WORKER_MAX_CONCURRENCY: String(concurrency), ANALYSIS_WORKER_MOCK_DELAY_MS: '300', ANALYSIS_WORKER_POLL_MS: '200',
          PATH: process.env.STOCKDEPTH_RUNTIME_BIN + ':' + process.env.PATH },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      // Consume streams without logging contents, keys, or connection errors.
      worker.stdout.resume(); worker.stderr.resume();
      let maxRssKb = 0, peakRunning = 0;
      while (Date.now() - queued < 180000) {
        if (worker.exitCode !== null) throw Error('Mock worker exited');
        maxRssKb = Math.max(maxRssKb, rssTree(worker.pid));
        const [counts] = await test`select count(*) filter(where status='complete')::int as completed,
          count(*) filter(where status='running')::int as running,
          count(*) filter(where status='failed')::int as failed
          from analysis_jobs where run_id like ${'capacity-' + concurrency + '-%'}`;
        peakRunning = Math.max(peakRunning, counts.running);
        if (counts.failed) throw Error('Mock job failed');
        if (counts.completed === 8) break;
        await sleep(500);
      }
      const [result] = await test`select count(*) filter(where status='complete')::int as completed,
        max(extract(epoch from started_at-created_at))::float as max_wait_seconds,
        percentile_cont(0.95) within group(order by extract(epoch from completed_at-started_at)) as p95_run_seconds
        from analysis_jobs where run_id like ${'capacity-' + concurrency + '-%'}`;
      if (result.completed !== 8) throw Error('Mock capacity timeout');
      if (peakRunning > concurrency) throw Error('Worker exceeded local capacity');
      const sample = { concurrency, jobs: 8, ...result, elapsedMs: Date.now() - queued, peakRunning, maxRssKb };
      results.push(sample); console.log(JSON.stringify(sample));
      await stopWorker();
    }
    fs.mkdirSync(root + '/var/performance', { recursive: true });
    fs.writeFileSync(root + '/var/performance/worker-capacity.json', JSON.stringify({
      mode: 'mock: queue and database persistence only; excludes LLM/Python runner load', freshDatabaseTables: tables.length, results
    }, null, 2));
  } finally {
    await stopWorker();
    if (test) await test.end();
    if (created) await admin`drop database ${admin(name)}`;
    await admin.end();
  }
})().catch(e => { console.error('Worker capacity failed:', e.code || e.name); process.exitCode = 1; });
