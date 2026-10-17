import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { analysisJobs, paperAnalysisRuns, paperModelCalls, paperTradeDecisions } from '@/lib/db/schema';
import { LostOwnershipError, type Transaction } from './analysis-ownership';

export type PaperRun = typeof paperAnalysisRuns.$inferSelect;
const configuredLease = Number(process.env.PAPER_TRADER_LEASE_MS || 90000);
export const paperLeaseMs = Number.isFinite(configuredLease) && configuredLease >= 3000 ? Math.floor(configuredLease) : 90000;
export function ownedPaper(run: PaperRun) {
  return and(eq(paperAnalysisRuns.id, run.id), eq(paperAnalysisRuns.workerOwner, run.workerOwner || ''),
    sql`${paperAnalysisRuns.processingState} in ('claimed','submitted')`, sql`${paperAnalysisRuns.workerLeaseUntil} > now()`);
}
export async function assertPaperOwner(tx: Transaction, run: PaperRun) {
  const [row] = await tx.select({ id: paperAnalysisRuns.id }).from(paperAnalysisRuns).where(ownedPaper(run)).for('update');
  if (!row) throw new LostOwnershipError();
}
export async function renewPaper(run: PaperRun) {
  const rows = await db.update(paperAnalysisRuns).set({ workerLeaseUntil: sql`now() + ${paperLeaseMs} * interval '1 millisecond'` })
    .where(ownedPaper(run)).returning({ id: paperAnalysisRuns.id });
  if (!rows.length) throw new LostOwnershipError();
}
export async function expireSubmittedRuns() {
  // A submitted request may already have incurred fees. Never requeue it on lease
  // expiry; the old owner is fenced and the incomplete call remains traceable.
  return db.transaction(async tx => {
    const expired = await tx.update(paperAnalysisRuns).set({ processingState: 'unknown', workerOwner: null })
      .where(sql`processing_state = 'submitted' and worker_lease_until <= now()`)
      .returning();
    for (const run of expired) {
      await tx.update(paperModelCalls).set({ status: 'interrupted', endedAt: new Date(), costComplete: false })
        .where(and(eq(paperModelCalls.paperRunId, run.id), eq(paperModelCalls.callId, run.modelCallId || ''), eq(paperModelCalls.status, 'running')));
      await tx.insert(paperTradeDecisions).values({ portfolioId: run.portfolioId, userId: run.userId,
        paperAnalysisRunId: run.id, analysisJobId: run.analysisJobId, ticker: run.ticker,
        action: 'hold', status: 'failed',
        errorMessage: 'The model request was submitted, but the worker was interrupted and its outcome is unknown. Automatic retry was skipped to avoid duplicate charges.',
      }).onConflictDoNothing();
    }
    return expired.length;
  });
}
export async function claimPaperRun() {
  return db.transaction(async tx => {
    const [run] = await tx.update(paperAnalysisRuns).set({ processingState: 'claimed', workerOwner: randomUUID(),
      workerLeaseUntil: sql`now() + ${paperLeaseMs} * interval '1 millisecond'` })
      .where(eq(paperAnalysisRuns.id, sql<number>`(
        select p.id from paper_analysis_runs p join analysis_jobs j on j.id = p.analysis_job_id
        where (p.processing_state = 'queued' or (p.processing_state = 'claimed' and p.worker_lease_until <= now() and p.model_submitted_at is null))
          and not exists(select 1 from paper_trade_decisions d where d.paper_analysis_run_id = p.id)
          and (j.status = 'complete' or (j.status = 'failed' and j.external_status = 'timeout'
            and exists(select 1 from analysis_reports r where r.job_id = j.id and r.report_key in ('trader','complete'))))
        order by p.created_at, p.id for update of p skip locked limit 1
      )`)).returning();
    if (!run) return null;
    const [analysisJob] = await tx.select().from(analysisJobs).where(eq(analysisJobs.id, run.analysisJobId));
    return { ...run, analysisJob };
  });
}
