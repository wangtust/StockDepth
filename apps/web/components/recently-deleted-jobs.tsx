'use client';

import { ErrorPresentation } from '@/components/error-presentation';
import { useRef, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type DeletedJob = { id: number; ticker: string; tradeDate: string; status: string; hiddenAt: string };

async function fetcher(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load recently deleted jobs.');
  return data as { jobs: DeletedJob[] };
}

export function RecentlyDeletedJobs() {
  const { data, error, isLoading, mutate } = useSWR('/api/analysis/jobs/deleted', fetcher, { refreshInterval: 10000 });
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const restoreLock = useRef(false);
  const [retrying, setRetrying] = useState(false);
  async function retryLoad() {
    if (retrying) return;
    setRetrying(true);
    try { await mutate(); } finally { setRetrying(false); }
  }

  async function restore(id: number) {
    if (restoreLock.current) return;
    restoreLock.current = true;
    setRestoringId(id);
    setActionError('');
    setNotice('');
    try {
      const response = await fetch(`/api/analysis/jobs/${id}/restore`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to restore this job.');
      await mutate();
      setNotice('Job restored. Find it in the Analysis jobs list.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      restoreLock.current = false;
      setRestoringId(null);
    }
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Recently deleted</CardTitle>
        <p className="text-sm text-muted-foreground">The 50 most recently deleted jobs. Restoring preserves their status and reports without running the analysis again.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {(error || actionError) && <ErrorPresentation error={actionError || error.message} context="request" compact onRetry={error ? retryLoad : undefined} retrying={retrying} />}
        {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        {isLoading && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !error && data?.jobs.length === 0 && <p className="text-sm text-muted-foreground">No deleted jobs.</p>}
        {data?.jobs.map(job => (
          <div key={job.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{job.ticker} · {job.tradeDate} · {job.status}</p>
              <p className="text-xs text-muted-foreground">Deleted: {new Date(job.hiddenAt).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })}</p>
            </div>
            <Button variant="outline" size="sm" disabled={restoringId !== null} onClick={() => restore(job.id)}>
              {restoringId === job.id ? 'Restoring…' : 'Restore'}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
