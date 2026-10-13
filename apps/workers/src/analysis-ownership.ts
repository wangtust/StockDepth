import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { analysisJobs } from '@/lib/db/schema';

export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class LostOwnershipError extends Error {
  constructor() { super('Worker ownership expired or task changed'); }
}
const configuredLease = Number(process.env.ANALYSIS_WORKER_LEASE_MS || 90000);
export const analysisLeaseMs = Number.isFinite(configuredLease) && configuredLease >= 3000 ? Math.floor(configuredLease) : 90000;
export function ownedAnalysis(job: AnalysisJob) {
  return and(eq(analysisJobs.id, job.id), eq(analysisJobs.status, 'running'),
    eq(analysisJobs.workerOwner, job.workerOwner || ''), sql`${analysisJobs.workerLeaseUntil} > now()`);
}
export async function assertAnalysisOwner(tx: Transaction, job: AnalysisJob) {
  const [row] = await tx.select({ id: analysisJobs.id }).from(analysisJobs).where(ownedAnalysis(job)).for('update');
  if (!row) throw new LostOwnershipError();
}
export async function renewAnalysis(job: AnalysisJob) {
  const rows = await db.update(analysisJobs).set({ workerLeaseUntil: sql`now() + ${analysisLeaseMs} * interval '1 millisecond'` })
    .where(ownedAnalysis(job)).returning({ id: analysisJobs.id });
  if (!rows.length) throw new LostOwnershipError();
}

// Admission is serialized briefly, never across HTTP/model execution. This makes
// user/provider counts consistent even when two workers claim different rows.
// Shared endpoints honor capacities of active snapshots as well as the candidate.
// These are job reservations, not a limiter for parallel requests inside Python.
export async function claimAnalysis(settings: { systemConcurrency: number; userConcurrency: number }, providerLimit: number, recovering = false): Promise<AnalysisJob | null> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(739421, 2)`);
    const active = sql`r.status = 'running' and r.id <> analysis_jobs.id and (
      r.worker_lease_until > now() or r.external_status in ('running','started','already-running'))`;
    const monitor = recovering ? sql`(analysis_jobs.external_pid is not null or analysis_jobs.external_status in ('running','started','already-running'))` : sql`false`;
    const available = sql`(
      (select count(*) from analysis_jobs r where ${active}) < ${settings.systemConcurrency}
      and (${settings.userConcurrency} <= 0 or (select count(*) from analysis_jobs r where ${active} and r.user_id = analysis_jobs.user_id) < ${settings.userConcurrency})
      and not exists (
        select 1 from (values
          (coalesce(analysis_jobs.quick_config_snapshot::jsonb->>'provider', analysis_jobs.provider),
           coalesce(analysis_jobs.quick_config_snapshot::jsonb->>'baseUrl', analysis_jobs.base_url),
           coalesce((analysis_jobs.quick_config_snapshot::jsonb #>> '{modelOptions,request_concurrency}')::int, ${providerLimit})),
          (coalesce(analysis_jobs.deep_config_snapshot::jsonb->>'provider', analysis_jobs.provider),
           coalesce(analysis_jobs.deep_config_snapshot::jsonb->>'baseUrl', analysis_jobs.base_url),
           coalesce((analysis_jobs.deep_config_snapshot::jsonb #>> '{modelOptions,request_concurrency}')::int, ${providerLimit}))
        ) bucket(provider, endpoint, capacity)
        where (select count(*) from analysis_jobs r where ${active} and (
          (coalesce(r.quick_config_snapshot::jsonb->>'provider', r.provider) is not distinct from bucket.provider
            and rtrim(coalesce(r.quick_config_snapshot::jsonb->>'baseUrl', r.base_url), '/') is not distinct from rtrim(bucket.endpoint, '/'))
          or (coalesce(r.deep_config_snapshot::jsonb->>'provider', r.provider) is not distinct from bucket.provider
            and rtrim(coalesce(r.deep_config_snapshot::jsonb->>'baseUrl', r.base_url), '/') is not distinct from rtrim(bucket.endpoint, '/'))
        )) >= greatest(1, least(${providerLimit}, bucket.capacity,
          coalesce((select min(existing.capacity) from analysis_jobs r
            cross join lateral (values
              (coalesce(r.quick_config_snapshot::jsonb->>'provider', r.provider),
               coalesce(r.quick_config_snapshot::jsonb->>'baseUrl', r.base_url),
               coalesce((r.quick_config_snapshot::jsonb #>> '{modelOptions,request_concurrency}')::int, ${providerLimit})),
              (coalesce(r.deep_config_snapshot::jsonb->>'provider', r.provider),
               coalesce(r.deep_config_snapshot::jsonb->>'baseUrl', r.base_url),
               coalesce((r.deep_config_snapshot::jsonb #>> '{modelOptions,request_concurrency}')::int, ${providerLimit}))
              ) existing(provider, endpoint, capacity)
            where ${active}
              and existing.provider is not distinct from bucket.provider
              and rtrim(existing.endpoint, '/') is not distinct from rtrim(bucket.endpoint, '/')),
            ${providerLimit})))
      )
    )`;
    const [job] = await tx.update(analysisJobs).set({ status: 'running', workerOwner: randomUUID(),
      workerLeaseUntil: sql`now() + ${analysisLeaseMs} * interval '1 millisecond'`,
      startedAt: sql`coalesce(${analysisJobs.startedAt}, now() AT TIME ZONE 'UTC')`, updatedAt: new Date() })
      .where(eq(analysisJobs.id, sql<number>`(
        select id from analysis_jobs where status = ${recovering ? 'running' : 'queued'}
          and (worker_owner is null or worker_lease_until is null or worker_lease_until <= now())
          and (${monitor} or ${available})
        order by (external_status in ('running','started','already-running')) desc nulls last,
          (external_pid is not null) desc, created_at asc for update skip locked limit 1
      )`)).returning();
    return job ?? null;
  });
}
