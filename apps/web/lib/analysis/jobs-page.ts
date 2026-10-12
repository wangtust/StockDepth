import 'server-only';
import { jobsPageQuery, JOB_PAGE_SIZE } from './jobs-page-query';
import { db } from '@/lib/db/drizzle';

// One round trip after authentication. Limit jobs before counting their reports.
// Explicit projections prevent credentials, report bodies and runner logs leaking.
export async function getJobsPage(userId: number, before?: number) {
  const [row] = await db.execute(jobsPageQuery(userId, before));
  const jobs = row.jobs as Array<{ id: number }>;
  const hasMore = jobs.length > JOB_PAGE_SIZE;
  const page = jobs.slice(0, JOB_PAGE_SIZE);
  return { credits: row.credits, pricing: row.pricing, models: row.models, jobs: page,
    nextCursor: hasMore ? page[page.length - 1].id : null };
}
