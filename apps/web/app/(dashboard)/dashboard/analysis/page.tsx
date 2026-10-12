import { redirect } from 'next/navigation';
import { getUser } from '@/lib/db/queries';
import { getJobsPage } from '@/lib/analysis/jobs-page';
import AnalysisClient, { type JobsPayload } from './analysis-client';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage() {
  const user = await getUser();
  if (!user) redirect('/sign-in');
  const initialPayload = await getJobsPage(user.id);
  return <AnalysisClient initialPayload={initialPayload as unknown as JobsPayload} />;
}
