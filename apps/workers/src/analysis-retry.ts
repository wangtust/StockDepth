import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { resumeAnalysisJobInTransaction } from '@/lib/analysis/resume-job';

const intervalMs = 8 * 60 * 60 * 1000;
export const nextRetryTime = (now: Date) => new Date((Math.floor(now.getTime() / intervalMs) + 1) * intervalMs);

// One atomic sweep: competing workers/restarts cannot publish the same batch.
// PostgreSQL is the clock; no host timezone or process-local schedule state.
export async function retryRecentFailedAnalysisJobs() {
  return db.transaction(async tx => {
    const [lock] = await tx.execute(sql`select pg_try_advisory_xact_lock(739421, 4) as acquired`);
    if (!lock.acquired) return null;
    const [clock] = await tx.execute(sql`select now() as time`);
    const now = new Date(String(clock.time));
    await tx.execute(sql`insert into analysis_retry_schedule(key, next_run_at)
      values ('failed_analysis', ${nextRetryTime(now).toISOString()}) on conflict do nothing`);
    const [schedule] = await tx.execute(sql`select next_run_at from analysis_retry_schedule
      where key = 'failed_analysis' for update`);
    if (new Date(String(schedule.next_run_at)) > now) return null;

    // completed_at is the failure time; updated_at supports older failed rows.
    const candidates = await tx.execute<{id:number; user_id:number}>(sql`
      select j.id, j.user_id from analysis_jobs j join users u on u.id = j.user_id
      where j.status = 'failed' and j.hidden_at is null
        and coalesce(j.completed_at, j.updated_at) >= ${now.toISOString()}::timestamptz at time zone 'UTC' - interval '24 hours'
        and coalesce(j.completed_at, j.updated_at) <= ${now.toISOString()}::timestamptz at time zone 'UTC'
        and u.status = 'active' and u.deleted_at is null
      order by j.id for update of j`);
    let queued = 0, skipped = 0;
    for (const job of candidates) {
      const result = await resumeAnalysisJobInTransaction(tx, job.user_id, job.id, undefined, undefined, true);
      if (result.status === 200) queued++;
      else skipped++;
    }
    await tx.execute(sql`update analysis_retry_schedule set next_run_at = ${nextRetryTime(now).toISOString()}
      where key = 'failed_analysis'`);
    return { event: 'scheduled_analysis_retry', candidates: candidates.length, queued, skipped,
      nextRunAt: nextRetryTime(now).toISOString() };
  });
}
